#!/usr/bin/env python3
"""
Investigate the MR20's recording modes.

The manufacturer's spec documents BLE&REC&SECEN as a getter only, but the
device answered BLE&REC&SECEN&CALL with DEV&REC&CALL. That is either the getter
ignoring a trailing argument, or an undocumented setter echoing the new value.
Asking for the OTHER mode settles it.

The product listing advertises "Voice Activation: Supported", so one of these
modes is likely the voice-triggered one - which is what we actually want.

Everything here is reversible: the original mode is restored at the end.
"""
import asyncio
import sys

from mr20 import MR20, field

ADDRESS = sys.argv[1]


async def mode(dev):
    reply = await dev.ask("REC&SECEN", "REC", timeout=8.0)
    return field(reply, 2), reply


async def main():
    async with MR20(ADDRESS, allow_dangerous=False, verbose=False) as dev:
        original, raw = await mode(dev)
        print(f"current mode: {original}   ({raw})\n")

        print("-- is REC&SECEN&<mode> a setter? --")
        # Ask for the mode we are NOT in. If the reply flips, it is a setter.
        target = "CON" if original == "CALL" else "CALL"
        reply = await dev.ask(f"REC&SECEN&{target}", "REC", timeout=8.0)
        print(f"   sent REC&SECEN&{target} -> {reply}")

        after, _ = await mode(dev)
        print(f"   mode now reads: {after}")

        if after == target:
            print(f"\n   *** SETTER CONFIRMED: the mode changed {original} -> {after}")
            print("   The spec is wrong; the mode IS settable over Bluetooth.")
            settable = True
        else:
            print(f"\n   not a setter - mode stayed {after}")
            print("   REC&SECEN just echoes the current mode, ignoring arguments.")
            settable = False

        if not settable:
            print("\n-- other spellings for switching mode --")
            for verb in [f"REC&{target}", f"SET&SECEN&{target}", f"SECEN&{target}",
                         f"REC&MODE&{target}", f"MODE&{target}", f"REC&SET&{target}",
                         "REC&SECEN&0", "REC&SECEN&1", "SECEN", "SECEN&1"]:
                r = await dev.ask(verb, timeout=4.0)
                now, _ = await mode(dev)
                flag = "   <== MODE CHANGED" if now != original else ""
                print(f"   {verb:20} -> {r or '(no reply)':22} mode={now}{flag}")
                if now != original:
                    settable = True
                    break

        print("\n-- restoring original mode --")
        now, _ = await mode(dev)
        if now != original:
            await dev.ask(f"REC&SECEN&{original}", "REC", timeout=8.0)
            back, _ = await mode(dev)
            print(f"   restored to {back}")
        else:
            print(f"   unchanged ({now}), nothing to restore")

        print("\n" + "=" * 60)
        if settable:
            print("Recording mode is controllable over BLE.")
        else:
            print("No BLE command changes the recording mode.")
            print("If the two modes differ in behaviour, the button likely selects")
            print("between them - worth testing physically.")


asyncio.run(main())
