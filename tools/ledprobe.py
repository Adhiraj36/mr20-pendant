#!/usr/bin/env python3
"""
Retest LED control with a correct blocklist.

The first sweep wrongly skipped LED&1, LED&ON and friends: it rejected any verb
containing "D&", which matches the "D" in "LED&". The destructive delete verb is
D&<dir>&<file>, so the guard must anchor at the start of the verb instead.
"""
import asyncio
import sys

from bleak import BleakClient

ADDRESS = sys.argv[1]
WRITE_UUID = "001120a2-2233-4455-6677-88995a5b5c5d"
CMD_UUID = "001120a3-2233-4455-6677-88995a5b5c5d"
PREFIX = "BLE&"

# Anchored at the start of the verb, so "LED&1" no longer trips the "D&" rule.
BLOCKED_PREFIXES = ["D&", "OTA", "OT&", "BLE&RESET", "BLE&OFF", "WIFI&CH", "SHUT"]
BLOCKED_WORDS = ["FORMAT", "ERASE", "FACTORY", "WIPE", "SHUTDOWN", "REBOOT"]

CANDIDATES = [
    # The ones the broken guard skipped.
    "LED&1", "LED&0", "LED&ON", "LED&OFF", "SET&LED&1", "SET&LED&0",
    "LED&STA", "LED&S", "LED&B", "IND&1", "IND&0",
    # A few more spellings worth trying.
    "LED&C", "LED&2", "LED&3", "LIGHT&ON", "LIGHT&OFF", "LED&EN",
    "LED&DIS", "LEDCTL", "LED_CTL", "SETLED",
]

replies: list[str] = []


def on_notify(_, data: bytearray):
    replies.append(data.decode("utf-8", errors="replace").replace("\x00", "").strip())


def unsafe(verb: str) -> str | None:
    upper = verb.upper()
    for bad in BLOCKED_PREFIXES:
        if upper.startswith(bad):
            return bad
    for bad in BLOCKED_WORDS:
        if bad in upper:
            return bad
    return None


async def send(client, verb: str) -> str:
    replies.clear()
    await client.write_gatt_char(WRITE_UUID, f"{PREFIX}{verb}".encode(), response=True)
    await asyncio.sleep(0.9)
    return " | ".join(replies) if replies else "(no reply)"


async def main():
    async with BleakClient(ADDRESS, timeout=25.0) as client:
        print(f"connected to {ADDRESS}\n")
        await client.start_notify(CMD_UUID, on_notify)

        print(f"recording state before: {await send(client, 'STE')}\n")

        print("-- LED candidates (watch the pendant) --")
        hits, silent = [], []
        for verb in CANDIDATES:
            if bad := unsafe(verb):
                print(f"   {PREFIX}{verb:<14} -> SKIPPED (blocked: {bad})")
                continue
            out = await send(client, verb)
            mark = ""
            if out == "(no reply)":
                silent.append(verb)
                mark = "   <== silent, may have acted"
            elif "UNKNOWN" not in out:
                hits.append((verb, out))
                mark = "   <== RECOGNISED"
            print(f"   {PREFIX}{verb:<14} -> {out}{mark}")

        print(f"\nrecording state after: {await send(client, 'STE')}")

        print("\n" + "=" * 60)
        if hits:
            print("LED commands that replied:")
            for verb, out in hits:
                print(f"   {PREFIX}{verb}  ->  {out}")
        if silent:
            print("Accepted silently (did the LED change?):")
            print("   " + ", ".join(f"{PREFIX}{v}" for v in silent))
        if not hits and not silent:
            print("No LED command exists. The indicator is firmware-driven only.")

        await client.stop_notify(CMD_UUID)


asyncio.run(main())
