#!/usr/bin/env python3
"""
Find the command format this unit's firmware actually accepts.

The spec documents commands as XS_BLE&... with replies as XS_DEV&..., but the
device replies "DEV&UNKNOWN" - no XS_ prefix. So the prefix is likely different
on this build. Sends read-only queries in several spellings and reports which
produce a real answer.
"""
import asyncio
import sys

from bleak import BleakClient

ADDRESS = sys.argv[1]
WRITE_UUID = "001120a2-2233-4455-6677-88995a5b5c5d"
CMD_UUID = "001120a3-2233-4455-6677-88995a5b5c5d"

# Read-only queries only - nothing here changes device state.
PREFIXES = ["XS_BLE&", "BLE&", "XS&", "DEV&", "APP&", ""]
VERBS = ["FW", "BAT", "STE"]

replies: list[str] = []


def on_notify(_, data: bytearray):
    msg = data.decode("utf-8", errors="replace").replace("\x00", "").strip()
    replies.append(msg)


async def try_cmd(client, cmd: str, response: bool) -> str:
    replies.clear()
    try:
        await client.write_gatt_char(WRITE_UUID, cmd.encode(), response=response)
    except Exception as e:
        return f"write failed: {type(e).__name__}"
    await asyncio.sleep(1.2)
    return " | ".join(replies) if replies else "(no reply)"


async def main():
    async with BleakClient(ADDRESS, timeout=25.0) as client:
        print(f"connected to {ADDRESS}\n")
        await client.start_notify(CMD_UUID, on_notify)

        interesting = []
        for prefix in PREFIXES:
            print(f"-- prefix {prefix!r} --")
            for verb in VERBS:
                cmd = f"{prefix}{verb}"
                out = await try_cmd(client, cmd, response=True)
                flag = ""
                if out not in ("(no reply)",) and "UNKNOWN" not in out:
                    flag = "   <== ACCEPTED"
                    interesting.append((cmd, out))
                print(f"   {cmd:<20} -> {out}{flag}")
            print()

        # The spec's own newline-separated variants, in case the separator differs.
        print("-- separator and casing variants --")
        for cmd in ["XS_BLE_FW", "XS_BLE:FW", "xs_ble&fw", "ble&fw", "BLE&VER", "BLE&INFO"]:
            out = await try_cmd(client, cmd, response=True)
            flag = ""
            if out != "(no reply)" and "UNKNOWN" not in out:
                flag = "   <== ACCEPTED"
                interesting.append((cmd, out))
            print(f"   {cmd:<20} -> {out}{flag}")

        print("\n" + "=" * 60)
        if interesting:
            print("commands the device accepted:")
            for cmd, out in interesting:
                print(f"   {cmd}  ->  {out}")
        else:
            print("every spelling returned UNKNOWN or nothing.")
            print("The device may require the 16-character pairing key first.")

        await client.stop_notify(CMD_UUID)


asyncio.run(main())
