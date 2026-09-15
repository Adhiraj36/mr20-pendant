#!/usr/bin/env python3
"""
Read memory from the Actions ADFU bootloader using its documented READRAM command.

Command format taken from ilyakurdyukov/actions_flash (actions_dump.c), not
guessed:

    cdb[0]     = 0xcd          ADFU marker
    cdb[1..4]  = command       little-endian
    cdb[5..8]  = length        little-endian
    cdb[9..12] = address       little-endian
    tag        = 0             the source comments this as "important"

Only CMD_ADFU_READRAM (0x93) is issued here. WRITERAM, FLASH, SWITCH and EXEC
are deliberately not implemented in this file - reading cannot corrupt flash.

A read of an unmapped address may fault the ROM loader; that is recoverable by
long-pressing the button to power the device off.
"""
import struct
import sys

import usb.core
import usb.util

VID, PID = 0x10D6, 0x10D6
EP_IN, EP_OUT = 0x81, 0x02
USBC_SIG = 0x43425355
USBS_SIG = 0x53425355

CMD_ADFU_READRAM = 0x93


def build_cbw(cmd: int, length: int, addr: int, recv: int, data_len: int) -> bytes:
    cdb = bytearray(16)
    cdb[0] = 0xCD
    struct.pack_into("<I", cdb, 1, cmd)
    struct.pack_into("<I", cdb, 5, length)
    struct.pack_into("<I", cdb, 9, addr)
    header = struct.pack("<IIIBBB", USBC_SIG, 0, data_len, recv << 7, 0, 16)
    return header + bytes(cdb)


def read_mem(dev, addr: int, size: int, timeout: int = 2000):
    """One READRAM transaction. Returns (data, status_note)."""
    try:
        dev.write(EP_OUT, build_cbw(CMD_ADFU_READRAM, size, addr, 1, size),
                  timeout=timeout)
    except usb.core.USBError as e:
        return None, f"command write failed: {e}"

    try:
        data = bytes(dev.read(EP_IN, size, timeout=timeout))
    except usb.core.USBError as e:
        return None, f"data phase failed: {e}"

    try:
        csw = bytes(dev.read(EP_IN, 13, timeout=timeout))
    except usb.core.USBError as e:
        return data, f"read {len(data)} bytes but no status: {e}"

    if len(csw) == 13:
        sig, tag, residue, status = struct.unpack("<IIIB", csw)
        if sig != USBS_SIG:
            return data, f"bad status signature 0x{sig:08x}"
        return data, ("ok" if status == 0 else f"status 0x{status:02x}")
    return data, f"short status ({len(csw)} bytes)"


def hexdump(data: bytes, base: int = 0, limit: int = 256) -> str:
    out = []
    for off in range(0, min(len(data), limit), 16):
        chunk = data[off:off + 16]
        hexpart = " ".join(f"{b:02x}" for b in chunk).ljust(47)
        text = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        out.append(f"   {base + off:08x}  {hexpart}  {text}")
    return "\n".join(out)


# Addresses worth trying, most-likely-valid first. Kept small (64 bytes) so a
# fault costs us little.
TARGETS = [
    (0x00000000, "address zero - vector table or boot ROM"),
    (0xE000ED00, "ARM Cortex-M CPUID register (SCB->CPUID)"),
    (0x20000000, "typical Cortex-M SRAM base"),
    (0x08000000, "typical Cortex-M flash base"),
    (0x00100000, "Actions SRAM region seen on ATJ2157"),
    (0x10000000, "alternate mapped region"),
]


def main():
    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        print("no ADFU device found - power-cycle and re-enter ADFU mode")
        return 1

    dev.set_configuration()
    usb.util.claim_interface(dev, 0)
    print(f"connected to {VID:04x}:{PID:04x}\n")
    print("issuing CMD_ADFU_READRAM (0x93) only - no writes, no exec\n")

    working = []
    for addr, label in TARGETS:
        print(f"-- 0x{addr:08x}  {label} --")
        data, note = read_mem(dev, addr, 64)
        if data:
            nonzero = any(data)
            print(f"   {note}, {len(data)} bytes"
                  f"{'' if nonzero else '  (all zero)'}")
            print(hexdump(data, addr, 64))
            if nonzero:
                working.append((addr, label, data))
        else:
            print(f"   {note}")
        print()

    print("=" * 66)
    if working:
        print("READRAM works. Addresses that returned data:")
        for addr, label, _ in working:
            print(f"   0x{addr:08x}  {label}")

        # Cortex-M CPUID decodes to an exact core, which pins the architecture.
        for addr, _, data in working:
            if addr == 0xE000ED00 and len(data) >= 4:
                cpuid = struct.unpack("<I", data[:4])[0]
                implementer = (cpuid >> 24) & 0xFF
                partno = (cpuid >> 4) & 0xFFF
                cores = {0xC20: "Cortex-M0", 0xC60: "Cortex-M0+",
                         0xC21: "Cortex-M1", 0xC23: "Cortex-M3",
                         0xC24: "Cortex-M4", 0xC27: "Cortex-M7",
                         0xD20: "Cortex-M23", 0xD21: "Cortex-M33"}
                print(f"\n   CPUID = 0x{cpuid:08x}")
                if implementer == 0x41:
                    print(f"   implementer: ARM")
                    print(f"   core       : {cores.get(partno, f'unknown (part 0x{partno:03x})')}")
    else:
        print("READRAM returned nothing at any address tried.")

    usb.util.release_interface(dev, 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
