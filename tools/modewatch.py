#!/usr/bin/env python3
"""
Poll the recording mode while someone tries button gestures on the pendant.

No BLE command changes the mode, so the button is the remaining candidate.
This reports the moment REC&SECEN flips from CALL to CON (or back), and also
tracks recording state so we can tell a mode change from a start/stop.
"""
import asyncio
import sys
import time

from mr20 import MR20, field

ADDRESS = sys.argv[1]
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 180.0

start = time.monotonic()


def stamp():
    return f"[{time.monotonic() - start:6.1f}s]"


async def main():
    async with MR20(ADDRESS, allow_dangerous=False, verbose=False) as dev:

        def on_event(msg):
            verb = msg.split("&", 1)[1] if "&" in msg else msg
            if verb.startswith("STA&"):
                print(f"{stamp()} device started recording -> {field(msg, 2)}", flush=True)
            elif verb.startswith("STO"):
                print(f"{stamp()} device stopped recording", flush=True)

        dev.on_event = on_event

        mode = field(await dev.ask("REC&SECEN", "REC", timeout=8.0), 2)
        rec = field(await dev.ask("STE", timeout=8.0), 2)
        print(f"{stamp()} starting mode={mode}  recording={rec}")
        print(f"\nTry button gestures now, one every ~15s, and tell me which you used:")
        print("  double-press, triple-press, long-press, press-and-hold-3s\n", flush=True)

        changes = 0
        while time.monotonic() - start < SECONDS:
            await asyncio.sleep(3.0)
            try:
                m = field(await dev.ask("REC&SECEN", "REC", timeout=5.0), 2)
                r = field(await dev.ask("STE", timeout=5.0), 2)
            except Exception as e:
                print(f"{stamp()} poll failed: {type(e).__name__}", flush=True)
                continue

            if m != mode:
                print(f"{stamp()} *** MODE CHANGED: {mode} -> {m} ***", flush=True)
                mode = m
                changes += 1
            if r != rec:
                print(f"{stamp()} recording state: {rec} -> {r}", flush=True)
                rec = r

        print(f"\n{stamp()} final mode={mode} recording={rec}")

    print("\n" + "=" * 56)
    if changes:
        print(f"The button DOES change the recording mode ({changes} change(s)).")
    else:
        print("No mode change observed. Either the gesture was not tried,")
        print("or this unit is fixed in CALL mode.")


asyncio.run(main())
