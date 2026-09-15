#!/usr/bin/env python3
"""
Does this firmware know how to join someone else's WiFi?

The pendant's WiFi is an access point: WIFIO raises it, WIFI reads back its own
credentials, and the file socket lives at a hardcoded 192.168.200.1. Nothing in
the documented protocol suggests the other mode — the device joining a network
we choose — and the app would need exactly that before a QR-scanned network
could be handed over.

Rather than assume either way, ask the device. Everything below is a bare verb
with no payload, which is a query: firmware that does not know a verb answers
DEV&UNKNOWN. A verb that answers with anything else is a lead.

    python3 tools/wifistaprobe.py <ble-address>

What this deliberately does NOT send:

  WIFI&CH    the one candidate that writes credentials. If it sets the access
             point's own passphrase rather than a network to join, a probe
             would change it and break the transfer path that works today.
  WIFI&OTA   puts the WiFi coprocessor into firmware-write mode.
  STATUS     answers DEV&STO — it silently stops an in-progress recording.

Those three are the reason this is a separate script and not a loop over every
verb that starts with WIFI.
"""
import asyncio
import sys

from bleak import BleakClient

WRITE_UUID = "001120a2-2233-4455-6677-88995a5b5c5d"
CMD_UUID = "001120a3-2233-4455-6677-88995a5b5c5d"

# Never sent, whatever else changes below.
BLOCKED = {"WIFI&CH", "WIFI&OTA", "OTA", "OT&OVER", "BLE&RESET", "BLE&OFF", "STATUS", "SHUT"}

# Three questions, in the order they matter.
PROBES = [
    # 1. Is there a station/client mode at all, and can it be asked about?
    ("station mode", ["WIFI&STA", "WIFISTA", "STA", "WIFI&MODE", "WIFIMODE", "GET&WIFI",
                      "WIFI&STATUS", "WIFI&INFO", "WIFI&CONN", "WIFI&JOIN", "JOIN"]),
    # 2. Can it see other networks? A scan implies a client radio.
    ("scanning", ["WIFI&SCAN", "WIFISCAN", "SCAN", "WIFI&LIST", "WIFIL", "WIFI&AP"]),
    # 3. If it ever joined one, could it tell us where it is? Without this the
    #    app has no address to open a socket to — 192.168.200.1 is the AP
    #    gateway and means nothing on a home network.
    ("address reporting", ["WIFI&IP", "WIFIIP", "IP", "GETIP", "GET&IP", "WIFI&ADDR", "ADDR"]),
]

replies: list[str] = []


def on_notify(_, data: bytearray):
    replies.append(data.decode("utf-8", errors="replace").replace("\x00", "").strip())


async def ask(client, cmd: str) -> str:
    replies.clear()
    try:
        await client.write_gatt_char(WRITE_UUID, cmd.encode(), response=True)
    except Exception as e:
        return f"write failed: {type(e).__name__}"
    await asyncio.sleep(1.2)
    return " | ".join(r for r in replies if r) or "(no reply)"


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)

    leads: list[tuple[str, str]] = []
    async with BleakClient(sys.argv[1], timeout=25.0) as client:
        print(f"connected to {sys.argv[1]}\n")
        await client.start_notify(CMD_UUID, on_notify)

        for heading, verbs in PROBES:
            print(f"-- {heading} --")
            for verb in verbs:
                if verb in BLOCKED:
                    print(f"   {verb:<16} -> skipped (blocked)")
                    continue
                out = await ask(client, verb)
                known = out != "(no reply)" and "UNKNOWN" not in out.upper()
                if known:
                    leads.append((verb, out))
                print(f"   {verb:<16} -> {out}{'   <== ANSWERED' if known else ''}")
            print()

        await client.stop_notify(CMD_UUID)

    print("=" * 60)
    if leads:
        print("Verbs this firmware recognises:\n")
        for verb, out in leads:
            print(f"   {verb}  ->  {out}")
        print("\nStation mode may be reachable. The reply format decides how.")
    else:
        print("Every verb returned UNKNOWN or nothing.")
        print("No evidence of station mode: the device can host an access point")
        print("and nothing more, so a QR-shared network cannot be handed to it")
        print("without new firmware from the vendor.")


asyncio.run(main())
