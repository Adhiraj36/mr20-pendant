#!/usr/bin/env python3
"""
Watch for USB enumeration changes on Actions Semiconductor devices.

Read-only. Used to detect whether the pendant can be coaxed into ADFU
(Actions Device Firmware Upgrade) mode, which is the low-level flash path.

Normal runtime mode enumerates as 10d6:b00b (USB mass storage).
ADFU recovery mode enumerates as 10d6:10d6 (vendor class, no mass storage).

Run this, then try a button combo while plugging the pendant in.
"""
from __future__ import annotations

import re
import subprocess
import sys
import time

ACTIONS_VID = 0x10D6
KNOWN = {
    0xB00B: "normal runtime (Zephyr USB mass storage)",
    0x10D6: "*** ADFU RECOVERY BOOTLOADER *** - flashable",
    0x1101: "legacy Actions flash-disk mode",
}


def snapshot() -> dict[str, tuple[int, int, str]]:
    """Map locationID -> (vid, pid, product name) for every USB device."""
    try:
        out = subprocess.run(
            ["ioreg", "-r", "-c", "IOUSBHostDevice", "-l", "-w0"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except Exception:
        return {}

    devices: dict[str, tuple[int, int, str]] = {}
    vid = pid = loc = name = None
    for line in out.splitlines():
        if m := re.search(r'"idVendor"\s*=\s*(\d+)', line):
            vid = int(m.group(1))
        elif m := re.search(r'"idProduct"\s*=\s*(\d+)', line):
            pid = int(m.group(1))
        elif m := re.search(r'"locationID"\s*=\s*(\d+)', line):
            loc = m.group(1)
        elif m := re.search(r'"USB Product Name"\s*=\s*"([^"]*)"', line):
            name = m.group(1)
        elif m := re.search(r'"kUSBProductString"\s*=\s*"([^"]*)"', line):
            name = name or m.group(1)

        if vid is not None and pid is not None and loc is not None:
            devices[loc] = (vid, pid, name or "(unnamed)")
            vid = pid = loc = name = None
    return devices


def describe(vid: int, pid: int, name: str) -> str:
    tag = ""
    if vid == ACTIONS_VID:
        tag = "  <-- " + KNOWN.get(pid, "Actions device, UNKNOWN mode")
    return f"{vid:04x}:{pid:04x}  {name}{tag}"


def main():
    only_actions = "--all" not in sys.argv

    print(__doc__)
    print("=" * 70)
    print("watching for USB changes - press Ctrl-C to stop\n")

    prev = snapshot()
    print("current devices:")
    for loc, (vid, pid, name) in sorted(prev.items()):
        if only_actions and vid != ACTIONS_VID:
            continue
        print(f"   {describe(vid, pid, name)}")
    if not any(v[0] == ACTIONS_VID for v in prev.values()):
        print("   (no Actions device currently attached)")
    print("\nwaiting for changes...\n")

    try:
        while True:
            time.sleep(0.4)
            cur = snapshot()
            if cur == prev:
                continue
            stamp = time.strftime("%H:%M:%S")
            for loc, dev in cur.items():
                if loc not in prev and (not only_actions or dev[0] == ACTIONS_VID):
                    print(f"[{stamp}] ATTACHED  {describe(*dev)}")
                    if dev[0] == ACTIONS_VID and dev[1] == 0x10D6:
                        print("\n" + "!" * 70)
                        print("ADFU BOOTLOADER REACHED - the device is flashable at the ROM level.")
                        print("!" * 70 + "\n")
            for loc, dev in prev.items():
                if loc not in cur and (not only_actions or dev[0] == ACTIONS_VID):
                    print(f"[{stamp}] DETACHED  {describe(*dev)}")
            prev = cur
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
