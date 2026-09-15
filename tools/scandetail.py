#!/usr/bin/env python3
"""Detailed BLE advertisement dump - shows service UUIDs and manufacturer data."""
import asyncio
import sys

from bleak import BleakScanner

SVC_UUID = "001120a0-2233-4455-6677-88995a5b5c5d"
MIN_RSSI = int(sys.argv[1]) if len(sys.argv) > 1 else -75
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 15.0


async def main():
    print(f"scanning {SECONDS}s, showing devices stronger than {MIN_RSSI} dBm\n")
    found = await BleakScanner.discover(timeout=SECONDS, return_adv=True)

    ranked = sorted(found.items(), key=lambda kv: -(kv[1][1].rssi or -999))
    for addr, (dev, adv) in ranked:
        if (adv.rssi or -999) < MIN_RSSI:
            continue
        print(f"{addr}   rssi={adv.rssi}")
        print(f"    name          : {adv.local_name or dev.name or '(none)'}")
        if adv.service_uuids:
            for u in adv.service_uuids:
                mark = "  <== MR20 SERVICE" if u.lower() == SVC_UUID else ""
                print(f"    service uuid  : {u}{mark}")
        else:
            print("    service uuid  : (none advertised)")
        if adv.manufacturer_data:
            for cid, data in adv.manufacturer_data.items():
                print(f"    mfr data      : company=0x{cid:04x} {data.hex()}")
        if adv.service_data:
            for u, data in adv.service_data.items():
                print(f"    service data  : {u} = {data.hex()}")
        if adv.tx_power is not None:
            print(f"    tx power      : {adv.tx_power}")
        print()


asyncio.run(main())
