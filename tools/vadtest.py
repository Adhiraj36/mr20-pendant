#!/usr/bin/env python3
"""
Decide whether the pendant has voice activation, with every variable controlled.

Recording is started over BLE (not the button, so there is no gesture
ambiguity), then the device is left completely alone in a silent room.

  - stops by itself after ~10s  -> voice activation is real
  - keeps recording through silence -> the earlier 10s stop was something else

Also reports the live audio rate, which is a second, independent signal.
"""
import asyncio
import sys
import time

from mr20 import MR20, field

ADDRESS = sys.argv[1]
QUIET_SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0

start = time.monotonic()
events = []


def t():
    return time.monotonic() - start


async def main():
    audio = {"total": 0, "last": 0}

    async with MR20(ADDRESS, allow_dangerous=False, verbose=False) as dev:

        def on_event(msg):
            verb = msg.split("&", 1)[1] if "&" in msg else msg
            if verb.startswith("STA&"):
                events.append((t(), "START"))
                print(f"[{t():6.2f}s]  START -> {field(msg, 2)}", flush=True)
            elif verb.startswith("STO"):
                events.append((t(), "STOP"))
                print(f"[{t():6.2f}s]  STOP  (device stopped itself)", flush=True)

        def on_audio(chunk):
            audio["total"] += len(chunk)

        dev.on_event = on_event
        dev.on_audio_data = on_audio

        state = field(await dev.ask("STE", timeout=8.0), 2)
        if state == "1":
            print(f"[{t():6.2f}s]  already recording - stopping first")
            await dev.ask("STO", timeout=10.0)
            await asyncio.sleep(2.0)

        print("\n*** BE COMPLETELY SILENT AND DO NOT TOUCH THE DEVICE ***")
        for i in (3, 2, 1):
            print(f"    starting in {i}...", flush=True)
            await asyncio.sleep(1.0)

        rec_started = t()
        reply = await dev.ask("STA", timeout=10.0)
        print(f"\n[{t():6.2f}s]  started over BLE -> {field(reply, 2)}")
        print(f"   watching {QUIET_SECONDS:.0f}s of silence\n", flush=True)

        stopped_at = None
        while t() - rec_started < QUIET_SECONDS:
            await asyncio.sleep(5.0)
            delta = audio["total"] - audio["last"]
            audio["last"] = audio["total"]
            rate = delta / 5.0
            print(f"[{t():6.2f}s]  audio {rate:6.0f} B/s", flush=True)
            if any(k == "STOP" for _, k in events) and stopped_at is None:
                stopped_at = next(ts for ts, k in events if k == "STOP")
                break

        final = field(await dev.ask("STE", timeout=8.0), 2)
        print(f"\n[{t():6.2f}s]  final state: "
              f"{'RECORDING' if final == '1' else 'idle'}")

    print("\n" + "=" * 60)
    stops = [ts for ts, k in events if k == "STOP"]
    if stops:
        elapsed = stops[0] - rec_started
        print(f"VOICE ACTIVATION CONFIRMED.")
        print(f"The device stopped itself {elapsed:.2f}s into silence,")
        print("with no button press and no stop command from us.")
    else:
        print("NO voice activation.")
        print(f"It recorded through {QUIET_SECONDS:.0f}s of silence without stopping.")
        print("The earlier 10s stop must have had another cause.")


asyncio.run(main())
