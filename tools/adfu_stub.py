#!/usr/bin/env python3
"""
Upload the ADFU stub into SRAM and switch to it, then test whether memory
reads become real.

Mirrors actions_dump.c's "simple_switch": write_mem(addr & ~1, file) followed
by CMD_ADFU_SWITCH and a 10 ms settle.

SAFETY: issues only WRITERAM (0x13) and SWITCH (0x20). WRITERAM targets SRAM,
which is volatile - CMD_ADFU_FLASH (0x10) is the command that writes flash and
it is never sent here. Worst case is a hung loader, cleared by long-pressing
the button to power the device off.

The load address defaults to 0x118000, which is documented for ATJ2157. Our
chip is a different family, so this may simply not take.
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
USBS_LEN = 13

CMD_ADFU_WRITERAM = 0x13
CMD_ADFU_READRAM = 0x93
CMD_ADFU_SWITCH = 0x20

CHUNK = 512


def build_cbw(cmd: int, length: int, addr: int, recv: int, data_len: int) -> bytes:
    cdb = bytearray(16)
    cdb[0] = 0xCD
    struct.pack_into("<I", cdb, 1, cmd)
    struct.pack_into("<I", cdb, 5, length)
    struct.pack_into("<I", cdb, 9, addr)
    return struct.pack("<IIIBBB", USBC_SIG, 0, data_len, recv << 7, 0, 16) + bytes(cdb)


def read_csw(dev, timeout=3000):
    try:
        csw = bytes(dev.read(EP_IN, USBS_LEN, timeout=timeout))
    except usb.core.USBError as e:
        return f"no status: {e}"
    if len(csw) != USBS_LEN:
        return f"short status ({len(csw)})"
    sig, tag, residue, status = struct.unpack("<IIIB", csw)
    if sig != USBS_SIG:
        return f"bad signature 0x{sig:08x}"
    return "ok" if status == 0 else f"status 0x{status:02x}"


def write_mem(dev, addr: int, data: bytes) -> bool:
    """Upload to SRAM in chunks. Never touches flash."""
    for off in range(0, len(data), CHUNK):
        chunk = data[off:off + CHUNK]
        try:
            dev.write(EP_OUT, build_cbw(CMD_ADFU_WRITERAM, len(chunk),
                                        addr + off, 0, len(chunk)), timeout=3000)
            dev.write(EP_OUT, chunk, timeout=5000)
        except usb.core.USBError as e:
            print(f"   chunk at 0x{addr + off:08x} failed: {e}")
            return False
        note = read_csw(dev)
        print(f"   wrote {len(chunk):4} bytes to 0x{addr + off:08x}: {note}")
        if note != "ok":
            return False
    return True


def read_mem(dev, addr: int, size: int):
    try:
        dev.write(EP_OUT, build_cbw(CMD_ADFU_READRAM, size, addr, 1, size),
                  timeout=3000)
        buf = bytes(dev.read(EP_IN, size + USBS_LEN, timeout=3000))
    except usb.core.USBError as e:
        return None, str(e)
    if len(buf) < size:
        return buf, f"short ({len(buf)})"
    return buf[:size], "ok"


def main():
    load_addr = int(sys.argv[1], 0) if len(sys.argv) > 1 else 0x118000
    stub_path = sys.argv[2] if len(sys.argv) > 2 else "payload_arm/adfus.bin"

    stub = open(stub_path, "rb").read()
    print(f"stub  : {stub_path}, {len(stub)} bytes")
    print(f"target: 0x{load_addr:08x}")
    print("commands used: WRITERAM (SRAM) and SWITCH only - no flash writes\n")

    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        print("no ADFU device - power-cycle and re-enter ADFU mode")
        return 1
    dev.set_configuration()
    usb.util.claim_interface(dev, 0)

    print("-- baseline read before the stub --")
    before_a, _ = read_mem(dev, 0x00000000, 32)
    before_b, _ = read_mem(dev, 0xDEADBEEF, 32)
    print(f"   0x00000000: {before_a.hex() if before_a else 'failed'}")
    print(f"   0xdeadbeef: {before_b.hex() if before_b else 'failed'}")
    print(f"   identical : {before_a == before_b}\n")

    print("-- uploading stub to SRAM --")
    if not write_mem(dev, load_addr & ~1, stub):
        print("\nupload rejected - this address is probably not SRAM on this chip.")
        print("Nothing was written to flash. Power-cycle to reset.")
        usb.util.release_interface(dev, 0)
        return 2

    print("\n-- switching to the stub --")
    try:
        dev.write(EP_OUT, build_cbw(CMD_ADFU_SWITCH, 0, load_addr, 0, 0), timeout=3000)
        print(f"   switch: {read_csw(dev)}")
    except usb.core.USBError as e:
        print(f"   switch failed: {e}")
    time.sleep(0.05)

    print("\n-- reads after the stub --")
    after_a, na = read_mem(dev, 0x00000000, 32)
    after_b, nb = read_mem(dev, 0xDEADBEEF, 32)
    print(f"   0x00000000: {after_a.hex() if after_a else na}")
    print(f"   0xdeadbeef: {after_b.hex() if after_b else nb}")

    print("\n" + "=" * 62)
    if after_a and after_b and after_a != after_b:
        print("SUCCESS - reads now differ by address. The stub is running.")
        print("We can dump memory and identify the chip.")
    elif after_a and before_a and after_a != before_a:
        print("PARTIAL - reads changed after the switch, but still uniform.")
    else:
        print("No change: the stub did not take at this address.")
        print("Expected for a different chip family. Nothing was written to")
        print("flash; long-press the button to power off and recover.")

    usb.util.release_interface(dev, 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
