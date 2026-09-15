#!/usr/bin/env python3
"""
MR20 AI pendant - BLE protocol client.

Implements the manufacturer's GATT protocol from MR20通信协议20260702.xlsx.

Dialect note: that spec writes commands as "XS_BLE&FW" and replies as
"XS_DEV&FW&...", but the firmware we have (V1.2) uses "BLE&FW" / "DEV&FW&..."
with no XS_ prefix. Commands here are written as bare verbs and the prefix is
detected on connect, so the client works with either build.

Commands that erase data, break pairing, or begin a firmware write are refused
unless --allow-dangerous is passed.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

from bleak import BleakClient, BleakScanner

SVC_UUID = "001120a0-2233-4455-6677-88995a5b5c5d"
AUDIO_UUID = "001120a1-2233-4455-6677-88995a5b5c5d"  # notify: live MP3 + bulk file data
WRITE_UUID = "001120a2-2233-4455-6677-88995a5b5c5d"  # write:  app -> device
CMD_UUID = "001120a3-2233-4455-6677-88995a5b5c5d"  # notify: device -> app

# (command prefix, reply prefix), most likely first.
DIALECTS = [("BLE&", "DEV&"), ("XS_BLE&", "XS_DEV&")]

# Verbs refused unless --allow-dangerous, with the reason shown to the user.
DANGEROUS = {
    "BLE&RESET": "formats the device's storage, erasing all recordings",
    "BLE&OFF": "drops the BLE link and resets the pairing key",
    "OTA": "puts the MCU into firmware-write mode",
    "WIFI&OTA": "puts the WiFi coprocessor into firmware-write mode",
    "OT&OVER": "commits a firmware write",
    "D&": "deletes a recording from the device",
    "WIFI&CH": "changes the device's WiFi credentials",
}

WIFI_STATES = {
    "0": "off",
    "1": "connected",
    "2": "on, no client",
    "3": "starting",
    "4": "changing password",
    "5": "OTA",
    "6": "password changed, resetting",
    "7": "auto-closed",
}


def classify(verb: str) -> str | None:
    """Return the reason a command verb is dangerous, or None if it is safe."""
    for prefix, reason in DANGEROUS.items():
        if verb.startswith(prefix):
            return reason
    return None


def decode(data: bytes) -> str:
    return data.decode("utf-8", errors="replace").replace("\x00", "").strip()


def align_mp3(data: bytes) -> bytes:
    """Trim to the first MP3 frame sync.

    The device streams continuously, so a capture almost always starts partway
    through a frame. Players reject the result until the leading fragment goes.
    """
    for i in range(len(data) - 1):
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
            return data[i:]
    return data


def field(msg: str | None, index: int) -> str | None:
    """Pull one &-separated field. Index 0 is the DEV tag, 1 the verb."""
    if not msg:
        return None
    parts = msg.split("&")
    return parts[index] if len(parts) > index else None


class MR20:
    def __init__(self, address: str, allow_dangerous: bool = False, verbose: bool = True):
        self.address = address
        self.allow_dangerous = allow_dangerous
        self.verbose = verbose
        self.client: BleakClient | None = None
        self.messages: asyncio.Queue[str] = asyncio.Queue()
        self.bulk: bytearray | None = None  # when set, audio notifications accumulate here
        self.audio_bytes = 0
        self.write_response = True
        self.cmd_prefix, self.reply_prefix = DIALECTS[0]
        # Hooks for long-running consumers that must react to unsolicited
        # events without stealing messages from the request/reply queue.
        self.on_event = None  # callable(str)
        self.on_audio_data = None  # callable(bytes)

    # -- connection ------------------------------------------------------

    async def __aenter__(self):
        self.client = BleakClient(self.address, timeout=25.0)
        await self.client.connect()
        print(f"connected to {self.address}")

        for service in self.client.services:
            for char in service.characteristics:
                if char.uuid.lower() == WRITE_UUID:
                    self.write_response = "write" in char.properties

        await self.client.start_notify(CMD_UUID, self._on_cmd)
        await self.client.start_notify(AUDIO_UUID, self._on_audio)
        await self.detect_dialect()
        return self

    async def __aexit__(self, *exc):
        if self.client and self.client.is_connected:
            for uuid in (CMD_UUID, AUDIO_UUID):
                try:
                    await self.client.stop_notify(uuid)
                except Exception:
                    pass
            await self.client.disconnect()
        return False

    async def detect_dialect(self):
        """Work out whether this build wants BLE&/DEV& or XS_BLE&/XS_DEV&."""
        for cmd_prefix, reply_prefix in DIALECTS:
            while not self.messages.empty():
                self.messages.get_nowait()
            try:
                await self.client.write_gatt_char(
                    WRITE_UUID, f"{cmd_prefix}FW".encode(), response=self.write_response
                )
                reply = await asyncio.wait_for(self.messages.get(), timeout=3.0)
            except (asyncio.TimeoutError, Exception):
                continue
            if reply.startswith(f"{reply_prefix}FW"):
                self.cmd_prefix, self.reply_prefix = cmd_prefix, reply_prefix
                if self.verbose:
                    print(f"protocol dialect: {cmd_prefix}... / {reply_prefix}...  "
                          f"(firmware {field(reply, 2)})")
                return
        print("warning: could not confirm the protocol dialect; "
              f"assuming {self.cmd_prefix}...")

    # -- notifications ---------------------------------------------------

    def _on_cmd(self, _, data: bytearray):
        msg = decode(bytes(data))
        if self.verbose:
            print(f"  <- {msg}")
        if self.on_event:
            try:
                self.on_event(msg)
            except Exception as e:
                print(f"  (event handler error: {e})")
        self.messages.put_nowait(msg)

    def _on_audio(self, _, data: bytearray):
        chunk = bytes(data)
        self.audio_bytes += len(chunk)
        if self.bulk is not None:
            self.bulk.extend(chunk)
        if self.on_audio_data:
            try:
                self.on_audio_data(chunk)
            except Exception as e:
                print(f"  (audio handler error: {e})")

    # -- protocol --------------------------------------------------------

    def tag(self, verb: str) -> str:
        """Reply prefix for a verb: 'FW' -> 'DEV&FW'."""
        return f"{self.reply_prefix}{verb}"

    async def send(self, verb: str):
        reason = classify(verb)
        if reason and not self.allow_dangerous:
            raise PermissionError(
                f"refusing to send {self.cmd_prefix}{verb!r}: it {reason}.\n"
                f"    Re-run with --allow-dangerous if you really mean to."
            )
        if reason:
            print(f"  !! sending dangerous command ({reason})")
        cmd = f"{self.cmd_prefix}{verb}"
        if self.verbose:
            print(f"  -> {cmd}")
        await self.client.write_gatt_char(
            WRITE_UUID, cmd.encode(), response=self.write_response
        )

    async def expect(self, *verbs: str, timeout: float = 6.0) -> str:
        """Wait for the first reply matching any verb. Others are skipped."""
        tags = tuple(self.tag(v) for v in verbs)
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise asyncio.TimeoutError(f"no reply matching {tags}")
            msg = await asyncio.wait_for(self.messages.get(), timeout=left)
            if not tags or any(msg.startswith(t) for t in tags):
                return msg

    async def ask(self, verb: str, *reply_verbs: str, timeout: float = 6.0) -> str | None:
        await self.send(verb)
        try:
            return await self.expect(*(reply_verbs or (verb,)), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    async def collect(self, item_verb: str, end_verb: str, timeout: float = 30.0):
        """Gather repeated items until the terminating message arrives."""
        item_tag, end_tag = self.tag(item_verb), self.tag(end_verb)
        items: list[str] = []
        end: str | None = None
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                break
            try:
                msg = await asyncio.wait_for(self.messages.get(), timeout=left)
            except asyncio.TimeoutError:
                break
            if msg.startswith(end_tag):  # checked first: DIRS_SUM also starts with DIRS
                end = msg
                break
            if msg.startswith(item_tag):
                items.append(msg)
        return items, end


# -- subcommands ---------------------------------------------------------


async def do_scan(args):
    print(f"scanning {args.seconds}s for BLE devices...\n")
    found = await BleakScanner.discover(timeout=args.seconds, return_adv=True)
    if not found:
        print("no BLE devices seen at all - is Bluetooth on and the pendant awake?")
        return
    matches = []
    print(f"{'ADDRESS':<40} {'RSSI':>5}  NAME")
    for addr, (dev, adv) in sorted(found.items(), key=lambda kv: -(kv[1][1].rssi or -999)):
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        is_match = SVC_UUID in uuids
        name = adv.local_name or dev.name or "(unnamed)"
        print(f"{addr:<40} {adv.rssi:>5}  {name}{'  <== MR20 service' if is_match else ''}")
        if is_match:
            matches.append((addr, name))
    print()
    if matches:
        print("Pendant found. Connect with:")
        for addr, name in matches:
            print(f"    mr20.py --address {addr} info")
    else:
        print("No device advertised the MR20 service UUID.")
        print("The pendant may not advertise it - our unit does not. Connect to a")
        print("likely address anyway and run 'probe' to read its GATT table.")


async def do_probe(args):
    """Dump the full GATT table - verifies the doc and exposes undocumented services."""
    async with MR20(args.address, args.allow_dangerous, verbose=False) as dev:
        print("\nGATT services and characteristics:\n")
        documented = {SVC_UUID, AUDIO_UUID, WRITE_UUID, CMD_UUID}
        for service in dev.client.services:
            known = "  (documented MR20 service)" if service.uuid.lower() == SVC_UUID else ""
            print(f"service {service.uuid}{known}")
            print(f"    {service.description}")
            for char in service.characteristics:
                u = char.uuid.lower()
                tag = {AUDIO_UUID: "  [audio/bulk notify]",
                       WRITE_UUID: "  [command write]",
                       CMD_UUID: "  [command notify]"}.get(u, "")
                if not tag and u not in documented:
                    tag = "  [UNDOCUMENTED]"
                print(f"    char {char.uuid}  ({','.join(char.properties)}){tag}")
            print()


async def do_info(args):
    async with MR20(args.address, args.allow_dangerous) as dev:
        if args.key:
            print("\n-- pairing --")
            print(f"   {await dev.ask(f'SK&{args.key}', 'SK', timeout=8.0) or 'no reply'}")

        print("\n-- device info --")
        fw = await dev.ask("FW")
        mac = await dev.ask("MAC")
        bat = await dev.ask("BAT")
        spa = await dev.ask("SPACE", "SPA")
        ste = await dev.ask("STE")
        gt = await dev.ask("GT", "CT")
        wf = await dev.ask("WF")
        wifis = await dev.ask("WIFIS")
        usb = await dev.ask("GET&USB", "USB")
        mode = await dev.ask("REC&SECEN", "REC")

        state = field(wifis, 2)
        print("\n-- summary --")
        print(f"   firmware      : {field(fw, 2) or '?'}")
        print(f"   wifi firmware : {field(wf, 2) or '?'}")
        print(f"   bt mac        : {field(mac, 2) or '?'}")
        print(f"   battery       : {field(bat, 2) or '?'}%")
        print(f"   storage       : {field(spa, 2) or '?'} MB free "
              f"of {field(spa, 3) or '?'} MB")
        print(f"   recording now : {'yes' if field(ste, 2) == '1' else 'no'}")
        print(f"   device time   : {field(gt, 2) or '?'}")
        print(f"   wifi state    : {WIFI_STATES.get(state, '?')} ({state})")
        print(f"   usb file mode : {field(usb, 2) or '?'}")
        print(f"   record mode   : {field(mode, 2) or '?'}")


async def do_dirs(args):
    async with MR20(args.address, args.allow_dangerous) as dev:
        await dev.send("LIST_DIRS")
        items, end = await dev.collect("DIRS&", "DIRS_SUM", timeout=20.0)
        print("\n-- recording folders --")
        for item in items:
            print(f"   {field(item, 2)}")
        print(f"   total: {field(end, 2) if end else len(items)}")


async def do_files(args):
    async with MR20(args.address, args.allow_dangerous) as dev:
        await dev.send(f"LIST&{args.dir}")
        items, end = await dev.collect("F&", "LIST&", timeout=40.0)
        print(f"\n-- files in {args.dir} --")
        print(f"   {'NAME':<32} {'SECS':>6} {'BYTES':>10}")
        for item in items:
            print(f"   {field(item, 3) or '?':<32} {field(item, 4) or '?':>6} "
                  f"{field(item, 5) or '?':>10}")
        print(f"   total: {field(end, 2) if end else len(items)}")


async def do_pull(args):
    async with MR20(args.address, args.allow_dangerous) as dev:
        dev.bulk = bytearray()
        await dev.send(f"U&{args.dir}&{args.file}")
        head = await dev.expect("U&", timeout=15.0)
        if "ERR" in head:
            print("device could not open that file")
            return
        expected = int(field(head, 2) or 0)
        print(f"\ndownloading {args.file}: {expected} bytes expected")

        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            if expected and len(dev.bulk) >= expected:
                break
            try:
                if (await asyncio.wait_for(dev.messages.get(), timeout=1.0)).startswith(
                    dev.tag("OFF")
                ):
                    break
            except asyncio.TimeoutError:
                pass
            print(f"   {len(dev.bulk)}/{expected} bytes", end="\r")

        out = Path(args.out or args.file)
        out.write_bytes(bytes(dev.bulk))
        print(f"\nsaved {len(dev.bulk)} bytes to {out}")
        if expected and len(dev.bulk) != expected:
            print(f"WARNING: expected {expected} bytes, transfer may be incomplete")


async def do_listen(args):
    """Capture the live MP3 stream the device emits while recording."""
    async with MR20(args.address, args.allow_dangerous) as dev:
        dev.bulk = bytearray()
        ste = await dev.ask("STE")
        if field(ste, 2) != "1":
            if not args.start:
                print("\nDevice is not recording, so no audio will stream.")
                print("Pass --start to have it begin recording.")
                return
            print("\nstarting recording...")
            await dev.ask("STA", timeout=10.0)

        print(f"\ncapturing live audio for {args.seconds}s...")
        start = time.monotonic()
        while time.monotonic() - start < args.seconds:
            await asyncio.sleep(1.0)
            print(f"   {len(dev.bulk)} bytes captured", end="\r")

        if args.stop:
            print("\nstopping recording...")
            await dev.ask("STO", timeout=10.0)

        raw = bytes(dev.bulk)
        aligned = align_mp3(raw)
        out = Path(args.out)
        out.write_bytes(aligned)
        print(f"\nsaved {len(aligned)} bytes of live audio to {out}"
              f"  ({len(raw) - len(aligned)} bytes of partial frame trimmed)")
        if not raw:
            print("no audio arrived - the device streams only while recording")


async def do_shake(args):
    async with MR20(args.address, args.allow_dangerous) as dev:
        print("\ntriggering haptic...")
        await dev.send("SHAKE")
        await asyncio.sleep(1.5)
        print("sent - did the pendant buzz?")


async def do_rec(args):
    async with MR20(args.address, args.allow_dangerous) as dev:
        if args.action == "start":
            reply = await dev.ask("STA", timeout=10.0)
            print(f"\nrecording started, file: {field(reply, 2) or '?'}")
        else:
            print(f"\nstopped: {await dev.ask('STO', timeout=10.0) or 'no reply'}")


async def do_raw(args):
    """Send a verb verbatim; the dialect prefix is added for you."""
    async with MR20(args.address, args.allow_dangerous) as dev:
        await dev.send(args.command)
        print("\nwaiting for replies...")
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            try:
                await asyncio.wait_for(dev.messages.get(), timeout=deadline - time.monotonic())
            except asyncio.TimeoutError:
                break
        if dev.audio_bytes:
            print(f"({dev.audio_bytes} bytes also arrived on the audio channel)")


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--address", help="BLE address of the pendant")
    p.add_argument("--key", help="16-character pairing key to send on connect")
    p.add_argument("--allow-dangerous", action="store_true",
                   help="permit commands that erase data, unpair, or write firmware")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scan", help="find nearby BLE devices")
    s.add_argument("--seconds", type=float, default=10.0)
    s.set_defaults(func=do_scan)

    sub.add_parser("probe", help="dump the GATT table").set_defaults(func=do_probe)
    sub.add_parser("info", help="battery, firmware, storage, wifi, time").set_defaults(func=do_info)
    sub.add_parser("dirs", help="list recording folders").set_defaults(func=do_dirs)

    s = sub.add_parser("files", help="list recordings in a folder")
    s.add_argument("dir")
    s.set_defaults(func=do_files)

    s = sub.add_parser("pull", help="download a recording over BLE")
    s.add_argument("dir")
    s.add_argument("file")
    s.add_argument("--out")
    s.add_argument("--timeout", type=float, default=300.0)
    s.set_defaults(func=do_pull)

    s = sub.add_parser("listen", help="capture the live MP3 stream")
    s.add_argument("--seconds", type=float, default=15.0)
    s.add_argument("--out", default="live.mp3")
    s.add_argument("--start", action="store_true", help="start recording if idle")
    s.add_argument("--stop", action="store_true", help="stop recording when done")
    s.set_defaults(func=do_listen)

    sub.add_parser("shake", help="trigger the haptic motor").set_defaults(func=do_shake)

    s = sub.add_parser("rec", help="start or stop recording")
    s.add_argument("action", choices=["start", "stop"])
    s.set_defaults(func=do_rec)

    s = sub.add_parser("raw", help="send a command verb, e.g. 'FW' or 'LIST&2026-08-19'")
    s.add_argument("command")
    s.add_argument("--timeout", type=float, default=8.0)
    s.set_defaults(func=do_raw)

    args = p.parse_args()
    if args.cmd != "scan" and not args.address:
        p.error("--address is required (it goes before the subcommand)")

    try:
        asyncio.run(args.func(args))
    except PermissionError as e:
        print(f"\n{e}", file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        print("\ninterrupted")


if __name__ == "__main__":
    main()
