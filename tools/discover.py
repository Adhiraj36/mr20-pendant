#!/usr/bin/env python3
"""
Discover undocumented commands on the MR20 pendant.

The firmware answers "DEV&UNKNOWN" to anything it does not recognise, which
makes it an oracle: any other reply means the command exists. Used here to look
for LED control and other hardware the manufacturer's spec never mentions.

Every probe is checked against a blocklist first, so nothing here can format
storage, delete recordings, unpair, write firmware, or power the device off.
"""
import asyncio
import sys

from bleak import BleakClient

ADDRESS = sys.argv[1]
WRITE_UUID = "001120a2-2233-4455-6677-88995a5b5c5d"
CMD_UUID = "001120a3-2233-4455-6677-88995a5b5c5d"
PREFIX = "BLE&"

# Substrings that must never appear in a probe.
BLOCKED = [
    "RESET", "FORMAT", "ERASE", "CLR", "CLEAR", "DEL", "OTA", "OT&",
    "BLE&OFF", "SHUT", "POWEROFF", "POWER_OFF", "SHUTDOWN", "REBOOT",
    "FACTORY", "WIPE", "D&",
]

PROBES = {
    "LED and indicators": [
        "LED", "LED&1", "LED&0", "LED&ON", "LED&OFF", "GET&LED", "LEDS",
        "LIGHT", "LIGHT&1", "LIGHT&0", "LAMP", "IND", "IND&1", "RGB",
        "LED&STA", "LED&S", "SET&LED", "SET&LED&1", "BLINK", "LED&B",
    ],
    "Haptic and audio feedback": [
        "SHAKE", "VIB", "VIBRATE", "BUZZ", "BEEP", "TONE", "SOUND",
        "SHAKE&1", "VOL", "VOLUME", "GET&VOL",
    ],
    "Recording mode setters (spec has only a getter)": [
        "REC&CALL", "REC&CON", "SET&REC", "SET&REC&CALL", "SET&REC&CON",
        "SECEN&CALL", "SECEN&CON", "REC&SECEN&CALL", "REC&MODE", "MODE",
    ],
    "Microphone and encoding": [
        "MIC", "GAIN", "MIC&GAIN", "GET&MIC", "RATE", "BITRATE", "QUALITY",
        "VAD", "AGC", "NS",
    ],
    "Device and diagnostics": [
        "VER", "INFO", "SN", "MODEL", "CHIP", "ID", "NAME", "GET&NAME",
        "STATUS", "TEMP", "KEY", "BTN", "BUTTON", "SLEEP", "IDLE",
    ],
}

replies: list[str] = []


def on_notify(_, data: bytearray):
    replies.append(data.decode("utf-8", errors="replace").replace("\x00", "").strip())


async def probe(client, verb: str) -> str:
    upper = verb.upper()
    for bad in BLOCKED:
        if bad in upper:
            return f"SKIPPED (blocklisted: {bad})"
    replies.clear()
    try:
        await client.write_gatt_char(WRITE_UUID, f"{PREFIX}{verb}".encode(), response=True)
    except Exception as e:
        return f"write failed: {type(e).__name__}"
    await asyncio.sleep(0.9)
    return " | ".join(replies) if replies else "(no reply)"


async def main():
    async with BleakClient(ADDRESS, timeout=25.0) as client:
        print(f"connected to {ADDRESS}\n")
        await client.start_notify(CMD_UUID, on_notify)

        found = []
        silent = []
        for group, verbs in PROBES.items():
            print(f"-- {group} --")
            for verb in verbs:
                out = await probe(client, verb)
                mark = ""
                if out == "(no reply)":
                    # Accepted-but-silent is how SHAKE behaves, so it is a hit too.
                    silent.append(verb)
                    mark = "   <== no reply (may still have acted)"
                elif "UNKNOWN" not in out and "SKIPPED" not in out and "failed" not in out:
                    found.append((verb, out))
                    mark = "   <== RECOGNISED"
                print(f"   {PREFIX}{verb:<18} -> {out}{mark}")
            print()

        print("=" * 64)
        if found:
            print("Commands that returned real data:")
            for verb, out in found:
                print(f"   {PREFIX}{verb}  ->  {out}")
        else:
            print("No probe returned data beyond the documented set.")
        if silent:
            print("\nAccepted without a reply (like SHAKE - watch the device):")
            print("   " + ", ".join(f"{PREFIX}{v}" for v in silent))

        await client.stop_notify(CMD_UUID)


asyncio.run(main())
