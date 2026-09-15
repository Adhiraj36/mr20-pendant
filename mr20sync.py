#!/usr/bin/env python3
"""
MR20 pendant sync daemon (proof of concept).

Keeps the pendant recording, and pulls every recording into a local
library. Transfers prefer the device's WiFi AP (fast) and fall back to
BLE (slow but needs no network change).

    mr20sync.py --library ~/pendant           # run forever
    mr20sync.py --library ~/pendant --once    # one sync pass, then exit
    mr20sync.py --library ~/pendant --no-wifi # BLE transfers only
    mr20sync.py --library ~/pendant --passive # never start recording

Nothing here deletes device-side data or writes firmware.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from bleak import BleakScanner

from mr20 import MR20, SVC_UUID, align_mp3, field

WIFI_HOST = "192.168.200.1"
WIFI_PORT = 8475
WIFI_SENTINEL = bytes([0xBA, 0x5A, 0x02, 0x8F, 0x04])


def log(msg: str):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# -- local library -------------------------------------------------------


class Library:
    """Local storage plus a manifest of what has already been fetched."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.root / "manifest.json"
        self.manifest: dict[str, dict] = {}
        if self.manifest_path.exists():
            try:
                self.manifest = json.loads(self.manifest_path.read_text())
            except json.JSONDecodeError:
                log("manifest corrupt, starting a new one")

    @staticmethod
    def key(folder: str, name: str) -> str:
        return f"{folder}/{name}"

    def have(self, folder: str, name: str, size: int) -> bool:
        entry = self.manifest.get(self.key(folder, name))
        if not entry:
            return False
        path = self.root / entry["path"]
        # Trust the manifest only if the file is still there at the right size.
        return path.exists() and path.stat().st_size == entry.get("size", -1) == size

    def save(self, folder: str, name: str, data: bytes, via: str) -> Path:
        dest_dir = self.root / folder
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / name
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        tmp.rename(dest)
        self.manifest[self.key(folder, name)] = {
            "path": str(dest.relative_to(self.root)),
            "size": len(data),
            "via": via,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
        }
        self.manifest_path.write_text(json.dumps(self.manifest, indent=2))
        return dest


# -- macOS WiFi handling -------------------------------------------------


class MacWifi:
    """Join the pendant's access point, then put the Mac back where it was."""

    def __init__(self, restore_ssid: str | None = None, force: bool = False):
        self.interface = self._find_interface()
        self.restore_ssid = restore_ssid
        self.force = force
        self.previous: str | None = None

    @staticmethod
    def _find_interface() -> str | None:
        try:
            out = subprocess.run(
                ["networksetup", "-listallhardwareports"],
                capture_output=True, text=True, timeout=10,
            ).stdout
        except Exception:
            return None
        # "Hardware Port: Wi-Fi" is followed by "Device: enN"
        m = re.search(r"Hardware Port: Wi-Fi\s*\nDevice: (\w+)", out)
        return m.group(1) if m else None

    def current_network(self) -> str | None:
        """Best-effort current SSID.

        Recent macOS refuses to reveal the SSID to processes without Location
        Services permission, reporting "not associated" or "<redacted>", so
        this returns None more often than you would expect.
        """
        if not self.interface:
            return None

        try:
            out = subprocess.run(
                ["networksetup", "-getairportnetwork", self.interface],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
            if ":" in out and "not associated" not in out.lower():
                ssid = out.split(":", 1)[1].strip()
                if ssid and "redacted" not in ssid.lower():
                    return ssid
        except Exception:
            pass

        try:
            out = subprocess.run(
                ["ipconfig", "getsummary", self.interface],
                capture_output=True, text=True, timeout=10,
            ).stdout
            m = re.search(r"^\s*SSID\s*:\s*(.+)$", out, re.MULTILINE)
            if m:
                ssid = m.group(1).strip()
                if ssid and "redacted" not in ssid.lower():
                    return ssid
        except Exception:
            pass

        return None

    def on_pendant_network(self) -> bool:
        """Association check by IP subnet - unaffected by SSID privacy rules."""
        if not self.interface:
            return False
        try:
            out = subprocess.run(
                ["ifconfig", self.interface], capture_output=True, text=True, timeout=10
            ).stdout
        except Exception:
            return False
        prefix = WIFI_HOST.rsplit(".", 1)[0] + "."
        return any(
            line.strip().startswith("inet ") and line.split()[1].startswith(prefix)
            for line in out.splitlines()
        )

    def join(self, ssid: str, password: str) -> bool:
        if not self.interface:
            log("no Wi-Fi interface found; cannot use WiFi transfer")
            return False

        # Joining the pendant's AP takes this Mac off its current network, and
        # the pendant's AP has no internet. Refuse unless we know how to undo it.
        self.previous = self.restore_ssid or self.current_network()
        if not self.previous and not self.force:
            log("refusing to switch networks: macOS will not reveal the current")
            log("  Wi-Fi name, so this Mac could not be reconnected afterwards.")
            log("  Re-run with --restore-ssid 'YourNetwork' to allow WiFi transfer,")
            log("  or with --no-wifi to sync over BLE and leave the network alone.")
            return False

        log(f"joining pendant AP {ssid!r} - this Mac will be offline until sync ends")
        try:
            res = subprocess.run(
                ["networksetup", "-setairportnetwork", self.interface, ssid, password],
                capture_output=True, text=True, timeout=45,
            )
        except subprocess.TimeoutExpired:
            log("joining the AP timed out")
            return False
        note = (res.stdout + res.stderr).strip()
        if note:
            log(f"networksetup: {note}")
        # networksetup reports failure in stdout rather than via the exit code.
        if "could not find" in note.lower() or "failed" in note.lower():
            return False

        for _ in range(15):
            time.sleep(1.0)
            if self.on_pendant_network():
                log(f"joined {ssid}")
                return True
        log(f"did not associate with {ssid}")
        return False

    def restore(self):
        if not self.interface or not self.previous:
            return
        log(f"rejoining {self.previous!r}")
        try:
            subprocess.run(
                ["networksetup", "-setairportnetwork", self.interface, self.previous],
                capture_output=True, text=True, timeout=45,
            )
        except Exception as e:
            log(f"could not rejoin {self.previous!r}: {e} - reconnect manually")
        self.previous = None


def fetch_over_tcp(expected: int, timeout: float = 120.0) -> bytes | None:
    """Read one file from the pendant's socket, stripping the end sentinel."""
    buf = bytearray()
    deadline = time.monotonic() + timeout
    try:
        with socket.create_connection((WIFI_HOST, WIFI_PORT), timeout=15) as sock:
            sock.settimeout(10.0)
            while time.monotonic() < deadline:
                if expected and len(buf) >= expected + len(WIFI_SENTINEL):
                    break
                try:
                    chunk = sock.recv(65536)
                except socket.timeout:
                    if buf.endswith(WIFI_SENTINEL):
                        break
                    continue
                if not chunk:
                    break
                buf.extend(chunk)
                if buf.endswith(WIFI_SENTINEL):
                    break
                print(f"    {len(buf)}/{expected} bytes", end="\r", flush=True)
    except OSError as e:
        log(f"socket error: {e}")
        return None

    if buf.endswith(WIFI_SENTINEL):
        buf = buf[: -len(WIFI_SENTINEL)]
    return bytes(buf)


# -- daemon --------------------------------------------------------------


class SyncDaemon:
    def __init__(self, args):
        self.args = args
        self.library = Library(Path(args.library).expanduser())
        self.wifi = (
            None if args.no_wifi
            else MacWifi(restore_ssid=args.restore_ssid, force=args.force_network_switch)
        )
        self.wifi_joined = False
        self.disk_full = False
        self.live: object | None = None  # open file handle during live capture
        self.live_path: Path | None = None

    # -- discovery -------------------------------------------------------

    async def find_device(self) -> str | None:
        if self.args.address:
            return self.args.address
        log("scanning for the pendant...")
        found = await BleakScanner.discover(timeout=self.args.scan_seconds, return_adv=True)
        for addr, (dev, adv) in found.items():
            if SVC_UUID in [u.lower() for u in (adv.service_uuids or [])]:
                log(f"found pendant at {addr} (rssi {adv.rssi})")
                return addr
        log("pendant not advertising - is it unplugged from USB and powered on?")
        return None

    # -- events ----------------------------------------------------------

    @staticmethod
    def verb_of(msg: str) -> str:
        """Drop the DEV&/XS_DEV& prefix so matching works on either dialect."""
        return msg.split("&", 1)[1] if "&" in msg else msg

    def handle_event(self, msg: str):
        verb = self.verb_of(msg)
        if verb.startswith("DISK&ERR"):
            self.disk_full = True
            log("!! device storage is FULL - it cannot record until files are freed")
        elif verb.startswith("REC&ERR"):
            log("!! device reported a recording error")
        elif verb.startswith("STA&"):
            log(f"device started recording: {field(msg, 2)}")
        elif verb.startswith("STO"):
            log("device stopped recording")

    # -- transfers -------------------------------------------------------

    async def fetch_ble(self, dev: MR20, folder: str, name: str) -> bytes | None:
        dev.bulk = bytearray()
        try:
            await dev.send(f"U&{folder}&{name}")
            head = await dev.expect("U&", timeout=15.0)
        except asyncio.TimeoutError:
            log("    no reply to BLE transfer request")
            return None
        if "ERR" in head:
            log("    device could not open the file")
            return None
        expected = int(field(head, 2) or 0)
        log(f"    BLE transfer, {expected} bytes")

        deadline = time.monotonic() + self.args.transfer_timeout
        while time.monotonic() < deadline:
            if expected and len(dev.bulk) >= expected:
                break
            try:
                msg = await asyncio.wait_for(dev.messages.get(), timeout=2.0)
                if msg.startswith(dev.tag("OFF")):
                    break
            except asyncio.TimeoutError:
                pass
            print(f"    {len(dev.bulk)}/{expected} bytes", end="\r", flush=True)

        data = bytes(dev.bulk)
        dev.bulk = None
        if expected and len(data) < expected:
            log(f"    incomplete: {len(data)} of {expected} bytes")
            return None
        if expected and len(data) > expected:
            # Anything past the declared length is another stream bleeding in.
            log(f"    trimming {len(data) - expected} stray bytes "
                f"(live audio mixed into the transfer)")
            data = data[:expected]
        return data

    async def ensure_wifi(self, dev: MR20) -> bool:
        """Bring up the pendant AP and join it. Safe to call repeatedly."""
        if self.wifi_joined:
            return True
        if not self.wifi:
            return False

        log("  enabling device WiFi...")
        await dev.ask("WIFIO", timeout=15.0)

        creds = await dev.ask("WIFI", "WIFI&", timeout=15.0)
        ssid, password = field(creds, 2), field(creds, 3)
        if not ssid:
            log("  device did not report WiFi credentials")
            return False
        log(f"  device AP: ssid={ssid}")

        if not self.wifi.join(ssid, password or ""):
            return False
        self.wifi_joined = True
        return True

    async def fetch_wifi(self, dev: MR20, folder: str, name: str) -> bytes | None:
        try:
            await dev.send(f"W&{folder}&{name}")
            head = await dev.expect("W&", "U&ERR", timeout=20.0)
        except asyncio.TimeoutError:
            log("    no reply to WiFi transfer request")
            return None
        if "ERR" in head:
            log("    device could not open the file")
            return None
        expected = int(field(head, 2) or 0)
        log(f"    WiFi transfer, {expected} bytes")
        return await asyncio.to_thread(fetch_over_tcp, expected, self.args.transfer_timeout)

    async def fetch(self, dev: MR20, folder: str, name: str, size: int):
        if self.wifi and await self.ensure_wifi(dev):
            data = await self.fetch_wifi(dev, folder, name)
            if data:
                return data, "wifi"
            log("    WiFi transfer failed, falling back to BLE")
        data = await self.fetch_ble(dev, folder, name)
        return (data, "ble") if data else (None, None)

    # -- sync ------------------------------------------------------------

    async def sync(self, dev: MR20):
        await dev.send("LIST_DIRS")
        dirs, _ = await dev.collect("DIRS&", "DIRS_SUM", timeout=25.0)
        folders = [field(d, 2) for d in dirs if field(d, 2)]
        log(f"device has {len(folders)} recording folder(s): {', '.join(folders) or 'none'}")

        pending: list[tuple[str, str, int]] = []
        for folder in folders:
            await dev.send(f"LIST&{folder}")
            items, _ = await dev.collect("F&", "LIST&", timeout=40.0)
            for item in items:
                name = field(item, 3)
                size = int(field(item, 5) or 0)
                if not name:
                    continue
                # macOS writes AppleDouble sidecars when the device is mounted
                # over USB. They live on the device but it cannot open them.
                if name.startswith("._"):
                    continue
                if self.library.have(folder, name, size):
                    continue
                pending.append((folder, name, size))

        if not pending:
            log("library is already up to date")
            return

        total_mb = sum(s for _, _, s in pending) / 1e6
        log(f"{len(pending)} new recording(s) to fetch ({total_mb:.1f} MB)")

        # File data and the live stream share one notify channel, so a recording
        # in progress mixes itself into every download. Pause it while fetching.
        resume = await self.pause_recording(dev)
        try:
            for folder, name, size in pending:
                log(f"  fetching {folder}/{name} ({size} bytes)")
                data, via = await self.fetch(dev, folder, name, size)
                if not data:
                    log("    failed, will retry on the next pass")
                    continue
                path = self.library.save(folder, name, data, via)
                log(f"    saved {len(data)} bytes via {via} -> {path}")
                # The device drops transfer requests that arrive back-to-back.
                await asyncio.sleep(self.args.transfer_gap)
        finally:
            if resume:
                log("resuming recording")
                reply = await dev.ask("STA", timeout=15.0)
                if reply:
                    log(f"recording as {field(reply, 2)}")

    async def pause_recording(self, dev: MR20) -> bool:
        """Stop an in-progress recording so downloads arrive clean.

        Returns True if it was recording and should be restarted afterwards.
        """
        status = await dev.ask("STE", timeout=10.0)
        if field(status, 2) != "1":
            return False
        log("pausing recording so file transfers are not mixed with live audio")
        await dev.ask("STO", timeout=15.0)
        await asyncio.sleep(1.0)
        return True

    # -- recording keep-alive --------------------------------------------

    async def ensure_recording(self, dev: MR20):
        if self.args.passive:
            return
        if self.disk_full:
            log("not starting a recording: device storage is full")
            return
        status = await dev.ask("STE", timeout=10.0)
        if field(status, 2) == "1":
            log("device is already recording")
            return
        log("device idle - starting a recording")
        reply = await dev.ask("STA", timeout=15.0)
        if reply:
            log(f"recording as {field(reply, 2)}")
        else:
            log("no confirmation that recording started")

    # -- live capture ----------------------------------------------------

    def open_live(self):
        if not self.args.live:
            return
        live_dir = self.library.root / "live"
        live_dir.mkdir(parents=True, exist_ok=True)
        self.live_path = live_dir / f"{datetime.now():%Y-%m-%d_%H-%M-%S}.mp3"
        self.live = self.live_path.open("wb")
        log(f"live stream -> {self.live_path}")

    def close_live(self):
        if self.live:
            self.live.close()
            raw = self.live_path.read_bytes() if self.live_path else b""
            if not raw:
                self.live_path.unlink(missing_ok=True)
                log("no live audio arrived (device may not have been recording)")
            else:
                # Captures start mid-frame, which players reject until trimmed.
                aligned = align_mp3(raw)
                self.live_path.write_bytes(aligned)
                log(f"live capture saved {len(aligned)} bytes to {self.live_path}")
        self.live = self.live_path = None

    def on_audio(self, chunk: bytes):
        if self.live:
            self.live.write(chunk)

    # -- session ---------------------------------------------------------

    async def session(self, address: str):
        async with MR20(address, allow_dangerous=False, verbose=self.args.verbose) as dev:
            dev.on_event = self.handle_event

            if self.args.key:
                reply = await dev.ask(f"SK&{self.args.key}", "SK", timeout=15.0)
                log(f"pairing: {reply or 'no reply'}")
                if reply and "ERR" in reply:
                    log("pairing key rejected - other commands may fail")

            bat = await dev.ask("BAT", timeout=10.0)
            spa = await dev.ask("SPACE", "SPA", timeout=10.0)
            log(f"battery {field(bat, 2) or '?'}%, "
                f"storage {field(spa, 2) or '?'}/{field(spa, 3) or '?'} MB free")

            # Sync first: BLE-fallback transfers reuse the audio channel that
            # live capture would otherwise be consuming.
            await self.sync(dev)
            await self.ensure_recording(dev)

            if self.args.once:
                return

            dev.on_audio_data = self.on_audio
            self.open_live()
            try:
                log(f"watching. resyncing every {self.args.interval}s. Ctrl-C to stop.")
                last = time.monotonic()
                while dev.client.is_connected:
                    await asyncio.sleep(1.0)
                    if time.monotonic() - last >= self.args.interval:
                        last = time.monotonic()
                        self.close_live()
                        dev.on_audio_data = None
                        await self.sync(dev)
                        await self.ensure_recording(dev)
                        dev.on_audio_data = self.on_audio
                        self.open_live()
            finally:
                dev.on_audio_data = None
                self.close_live()

    async def run(self):
        try:
            while True:
                address = await self.find_device()
                if address:
                    try:
                        await self.session(address)
                        if self.args.once:
                            return
                        log("disconnected")
                    except Exception as e:
                        log(f"session ended: {type(e).__name__}: {e}")
                if self.args.once:
                    return
                log(f"retrying in {self.args.retry}s")
                await asyncio.sleep(self.args.retry)
        finally:
            self.close_live()
            if self.wifi and self.wifi_joined:
                self.wifi.restore()


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--library", default="~/pendant", help="local folder for recordings")
    p.add_argument("--address", help="skip scanning and use this BLE address")
    p.add_argument("--key", help="16-character pairing key")
    p.add_argument("--once", action="store_true", help="one sync pass, then exit")
    p.add_argument("--passive", action="store_true", help="never start a recording")
    p.add_argument("--no-wifi", action="store_true", help="BLE transfers only")
    p.add_argument("--restore-ssid",
                   help="Wi-Fi network to rejoin after a WiFi transfer; required "
                        "for WiFi mode because macOS hides the current SSID")
    p.add_argument("--force-network-switch", action="store_true",
                   help="join the pendant AP even with no way to rejoin your network")
    p.add_argument("--live", action="store_true", default=True,
                   help="capture the live MP3 stream between syncs")
    p.add_argument("--no-live", dest="live", action="store_false")
    p.add_argument("--interval", type=float, default=300.0, help="seconds between syncs")
    p.add_argument("--retry", type=float, default=20.0, help="seconds between reconnects")
    p.add_argument("--scan-seconds", type=float, default=12.0)
    p.add_argument("--transfer-timeout", type=float, default=600.0)
    p.add_argument("--transfer-gap", type=float, default=2.0,
                   help="seconds to pause between file transfers; the device "
                        "ignores requests that arrive back-to-back")
    p.add_argument("--verbose", action="store_true", help="log every protocol message")
    args = p.parse_args()

    daemon = SyncDaemon(args)
    try:
        asyncio.run(daemon.run())
    except KeyboardInterrupt:
        log("stopped")


if __name__ == "__main__":
    main()
