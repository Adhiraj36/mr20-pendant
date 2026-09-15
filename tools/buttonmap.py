#!/usr/bin/env python3
"""
Map the pendant's button: does one tap toggle recording, or does it take two?

The device pushes STA/STO notifications the moment its state changes, so this
listens rather than polls - timing is accurate to the millisecond. Two toggle
events ~200ms apart mean each tap acts independently; one event per gesture
means the gesture itself is the toggle.

Sends nothing except an initial status query.
"""
import asyncio
import sys
import time

from mr20 import MR20, field

ADDRESS = sys.argv[1]
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 150.0

start = time.monotonic()
events = []


async def main():
    async with MR20(ADDRESS, allow_dangerous=False, verbose=False) as dev:

        def on_event(msg):
            t = time.monotonic() - start
            verb = msg.split("&", 1)[1] if "&" in msg else msg
            if verb.startswith("STA&"):
                events.append((t, "START", field(msg, 2)))
                print(f"[{t:6.2f}s]  START  -> {field(msg, 2)}", flush=True)
            elif verb.startswith("STO"):
                events.append((t, "STOP", None))
                print(f"[{t:6.2f}s]  STOP", flush=True)

        dev.on_event = on_event

        state = field(await dev.ask("STE", timeout=8.0), 2)
        print(f"[{time.monotonic()-start:6.2f}s]  initial: "
              f"{'RECORDING (solid red)' if state == '1' else 'idle (blinking red)'}\n")
        print("Do these, leaving ~20s between them, and tell me the timings:")
        print("   1. ONE tap")
        print("   2. ONE tap again")
        print("   3. DOUBLE tap (two quick taps)\n", flush=True)

        # Stop early if the device drops the link, so the log is still printed.
        while time.monotonic() - start < SECONDS:
            await asyncio.sleep(2.0)
            if not dev.client.is_connected:
                print(f"\n[{time.monotonic()-start:6.2f}s]  link dropped by the device",
                      flush=True)
                break

        if dev.client.is_connected:
            try:
                final = field(await dev.ask("STE", timeout=8.0), 2)
                print(f"\n[{time.monotonic()-start:6.2f}s]  final: "
                      f"{'RECORDING' if final == '1' else 'idle'}")
            except Exception as e:
                print(f"\nfinal status unavailable: {type(e).__name__}")

    print("\n" + "=" * 58)
    print(f"{len(events)} state change(s) observed")
    if len(events) >= 2:
        print("\ngaps between consecutive changes:")
        for (t1, k1, _), (t2, k2, _) in zip(events, events[1:]):
            gap = t2 - t1
            hint = "  <- same gesture, each tap toggled" if gap < 1.0 else ""
            print(f"   {k1:5} -> {k2:5}  {gap:6.2f}s{hint}")
    print("\nIf a double tap produced TWO changes, one tap is the toggle.")
    print("If it produced ONE, the double tap itself is the gesture.")


asyncio.run(main())
