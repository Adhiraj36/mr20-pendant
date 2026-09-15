#!/usr/bin/env python3
"""
Continuously watch for the MR20 pendant appearing over BLE.

Builds a baseline of what is already advertising, then reports any NEW
device - the pendant should show up as new the moment it powers on.
Explicitly flags anything advertising the documented MR20 service UUID.
"""
import asyncio
import sys
import time

from bleak import BleakScanner

SVC_UUID = "001120a0-2233-4455-6677-88995a5b5c5d"
BASELINE_SECONDS = 8.0
RUN_SECONDS = float(sys.argv[1]) if len(sys.argv) > 1 else 300.0

seen: dict[str, int] = {}
baseline: set[str] = set()
hits: set[str] = set()
started = time.monotonic()


def on_detect(device, adv):
    addr = device.address
    uuids = [u.lower() for u in (adv.service_uuids or [])]
    name = adv.local_name or device.name or "(unnamed)"
    stamp = time.strftime("%H:%M:%S")

    if SVC_UUID in uuids and addr not in hits:
        hits.add(addr)
        print("\n" + "=" * 68)
        print(f"[{stamp}] MR20 SERVICE FOUND")
        print(f"    address : {addr}")
        print(f"    name    : {name}")
        print(f"    rssi    : {adv.rssi}")
        print("=" * 68)
        print(f"\nConnect with:\n    mr20.py info --address {addr}\n", flush=True)
        return

    if addr in seen:
        return
    seen[addr] = adv.rssi

    if time.monotonic() - started < BASELINE_SECONDS:
        baseline.add(addr)
        return

    # New device that was not part of the baseline - candidate pendant.
    print(f"[{stamp}] NEW device  {addr}  rssi={adv.rssi}  name={name}")
    if uuids:
        for u in uuids:
            print(f"             service: {u}")
    if adv.manufacturer_data:
        for cid, data in adv.manufacturer_data.items():
            note = "  (Apple continuity - not the pendant)" if cid == 0x004C else ""
            print(f"             mfr 0x{cid:04x}: {data.hex()}{note}")
    print(flush=True)


async def main():
    print(f"baseline for {BASELINE_SECONDS:.0f}s, then watching {RUN_SECONDS:.0f}s for new devices")
    print("UNPLUG the pendant from USB and press its power/record button now.\n", flush=True)
    scanner = BleakScanner(detection_callback=on_detect)
    await scanner.start()
    try:
        await asyncio.sleep(RUN_SECONDS)
    finally:
        await scanner.stop()
    print(f"\nfinished. {len(seen)} devices seen, {len(hits)} matched the MR20 service.")
    if not hits:
        print("The pendant never advertised the documented service UUID.")


asyncio.run(main())
