#!/usr/bin/env python3
"""
Watch the pendant for voice-activation behaviour.

Passive: connects, subscribes, and reports every recording start/stop the
device announces on its own, plus how fast live audio is arriving. If voice
activation is real, recording will stop by itself during silence and restart
when someone speaks - with no command from us.

Sends no commands except an initial status query.
"""
import asyncio
import sys
import time

from mr20 import MR20, field

ADDRESS = sys.argv[1]
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 120.0

start = time.monotonic()
events = []


def stamp():
    return f"[{time.monotonic() - start:6.1f}s]"


async def main():
    audio = {"total": 0, "last": 0}

    async with MR20(ADDRESS, allow_dangerous=False, verbose=False) as dev:

        def on_event(msg):
            verb = msg.split("&", 1)[1] if "&" in msg else msg
            if verb.startswith("STA&"):
                events.append(("start", time.monotonic() - start))
                print(f"{stamp()} RECORDING STARTED by the device -> {field(msg, 2)}",
                      flush=True)
            elif verb.startswith("STO"):
                events.append(("stop", time.monotonic() - start))
                print(f"{stamp()} RECORDING STOPPED by the device", flush=True)
            elif verb.startswith("DISK&ERR"):
                print(f"{stamp()} storage full", flush=True)
            elif verb.startswith("RT&"):
                print(f"{stamp()} in progress: {field(msg,2)} ({field(msg,3)}s)",
                      flush=True)

        def on_audio(chunk):
            audio["total"] += len(chunk)

        dev.on_event = on_event
        dev.on_audio_data = on_audio

        state = await dev.ask("STE", timeout=8.0)
        recording = field(state, 2) == "1"
        print(f"{stamp()} initial state: {'RECORDING' if recording else 'idle'}")
        print(f"\nWatching {SECONDS:.0f}s. Stay quiet for the first minute, then talk.")
        print("Audio rate is the giveaway: it drops to zero when recording stops.\n",
              flush=True)

        while time.monotonic() - start < SECONDS:
            await asyncio.sleep(5.0)
            delta = audio["total"] - audio["last"]
            audio["last"] = audio["total"]
            rate = delta / 5.0
            bar = "#" * min(int(rate / 200), 40)
            print(f"{stamp()} audio {rate:7.0f} B/s  {bar}", flush=True)

        final = await dev.ask("STE", timeout=8.0)
        print(f"\n{stamp()} final state: "
              f"{'RECORDING' if field(final,2)=='1' else 'idle'}")

    print("\n" + "=" * 62)
    starts = [e for e in events if e[0] == "start"]
    stops = [e for e in events if e[0] == "stop"]
    if starts or stops:
        print(f"The device changed recording state on its own: "
              f"{len(starts)} start(s), {len(stops)} stop(s).")
        print("That is voice activation - we sent no start or stop commands.")
    else:
        print("No self-initiated state changes in this window.")
        print("Either voice activation is off in this mode, or it only")
        print("segments files without announcing it over Bluetooth.")


asyncio.run(main())
