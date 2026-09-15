#!/usr/bin/env python3
"""
Settle the question: does ADFU READRAM return real, address-dependent memory?

Earlier runs disagreed with each other, which points at a desynced bulk pipe
left over from partial transfers. This resets the device first, then reads each
address in a fresh, fully-drained transaction.

Read-only: CMD_ADFU_READRAM (0x93) only.
"""
import struct
import sys
import time

import usb.core
import usb.util

VID, PID = 0x10D6, 0x10D6
EP_IN, EP_OUT = 0x81, 0x02
USBC_SIG = 0x43425355
USBS_SIG = 0x53425355
CMD_ADFU_READRAM = 0x93


def build_cbw(cmd, length, addr, recv, data_len):
    cdb = bytearray(16)
    cdb[0] = 0xCD
    struct.pack_into("<I", cdb, 1, cmd)
    struct.pack_into("<I", cdb, 5, length)
    struct.pack_into("<I", cdb, 9, addr)
    return struct.pack("<IIIBBB", USBC_SIG, 0, data_len, recv << 7, 0, 16) + bytes(cdb)


def drain(dev):
    """Empty any stale bytes left in the IN pipe."""
    total = 0
    for _ in range(8):
        try:
            n = len(dev.read(EP_IN, 512, timeout=120))
            total += n
            if not n:
                break
        except usb.core.USBError:
            break
    return total


def probe(dev, addr, size=32):
    """One clean READRAM. Returns (data_or_None, csw_status_or_None, raw_len)."""
    drain(dev)
    try:
        dev.write(EP_OUT, build_cbw(CMD_ADFU_READRAM, size, addr, 1, size), timeout=2000)
    except usb.core.USBError as e:
        return None, f"cmd failed: {e}", 0

    try:
        buf = bytes(dev.read(EP_IN, size + 13, timeout=2000))
    except usb.core.USBError as e:
        return None, f"read failed: {e}", 0

    # A reply of exactly 13 bytes starting with USBS means: no data returned.
    if len(buf) == 13 and buf[:4] == b"USBS":
        status = buf[12]
        return None, f"refused (status 0x{status:02x})", len(buf)

    if len(buf) >= size + 13:
        data, csw = buf[:size], buf[size:size + 13]
        sig, tag, res, status = struct.unpack("<IIIB", csw)
        ok = "ok" if status == 0 else f"status 0x{status:02x}"
        if sig != USBS_SIG:
            ok = f"bad csw sig 0x{sig:08x}"
        return data, ok, len(buf)

    return buf, f"partial ({len(buf)} bytes)", len(buf)


TARGETS = [
    (0x00000000, "address zero"),
    (0x00000040, "address zero + 0x40"),
    (0x00118000, "ATJ2157 SRAM"),
    (0xE000ED00, "Cortex-M CPUID"),
    (0xDEADBEEF, "CONTROL nonsense"),
    (0xFFFFFFF0, "CONTROL top of space"),
]


def main():
    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        print("no ADFU device - power-cycle, then re-enter ADFU")
        return 1

    print("resetting the USB device to clear any pipe desync...")
    try:
        dev.reset()
        time.sleep(1.5)
    except usb.core.USBError as e:
        print(f"  reset raised {e} (usually harmless)")

    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        print("device vanished after reset - re-enter ADFU mode")
        return 1
    dev.set_configuration()
    usb.util.claim_interface(dev, 0)
    print("reconnected\n")

    results = {}
    for addr, label in TARGETS:
        data, note, raw = probe(dev, addr)
        shown = data.hex() if data else "-"
        print(f"0x{addr:08x} {label:22} {note:24} {shown}")
        results[addr] = data

    print("\n" + "=" * 70)
    good = {a: d for a, d in results.items() if d}
    bad_controls = [a for a in (0xDEADBEEF, 0xFFFFFFF0) if results.get(a) is None]

    if good and bad_controls:
        print("Reads ARE address-sensitive: valid addresses return data,")
        print("nonsense addresses are refused. READRAM is genuinely working.")
        uniq = {d for d in good.values()}
        if len(uniq) == 1:
            print("\nBut every accepted address returned the SAME bytes, so the ROM")
            print("is serving a fixed pattern rather than true memory contents.")
        else:
            print("\nAccepted addresses returned DIFFERENT data - this is real memory.")
    elif not good:
        print("No address returned data.")
    else:
        print("Controls also returned data - reads are not address-validated.")

    usb.util.release_interface(dev, 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
