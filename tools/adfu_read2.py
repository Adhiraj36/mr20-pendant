#!/usr/bin/env python3
"""
ADFU memory read, faithful to actions_dump.c's read_mem_buf.

The earlier attempt read the data phase and the status wrapper as two separate
bulk transfers. The reference does ONE read of (n + 13) bytes and finds the
status wrapper at offset n:

    actions_cmd(io, CMD_ADFU_READRAM, n, addr + i, 1, n);
    n2 = n + USBS_LEN;
    usb_recv(io, n2);
    check_usbs(io, io->buf + n);
    memcpy(mem, io->buf, n);

Read-only: only CMD_ADFU_READRAM (0x93) is issued.
"""
import struct
import sys

import usb.core
import usb.util

VID, PID = 0x10D6, 0x10D6
EP_IN, EP_OUT = 0x81, 0x02
USBC_SIG = 0x43425355
USBS_SIG = 0x53425355
USBS_LEN = 13
CMD_ADFU_READRAM = 0x93


def build_cbw(cmd: int, length: int, addr: int, recv: int, data_len: int) -> bytes:
    cdb = bytearray(16)
    cdb[0] = 0xCD
    struct.pack_into("<I", cdb, 1, cmd)
    struct.pack_into("<I", cdb, 5, length)
    struct.pack_into("<I", cdb, 9, addr)
    return struct.pack("<IIIBBB", USBC_SIG, 0, data_len, recv << 7, 0, 16) + bytes(cdb)


def read_mem(dev, addr: int, size: int, timeout: int = 3000):
    """Returns (data, note). One combined read, as the reference does."""
    try:
        dev.write(EP_OUT, build_cbw(CMD_ADFU_READRAM, size, addr, 1, size),
                  timeout=timeout)
    except usb.core.USBError as e:
        return None, f"command failed: {e}"

    want = size + USBS_LEN
    try:
        buf = bytes(dev.read(EP_IN, want, timeout=timeout))
    except usb.core.USBError as e:
        return None, f"read failed: {e}"

    if len(buf) != want:
        return buf, f"unexpected length {len(buf)}, wanted {want}"

    data, csw = buf[:size], buf[size:]
    sig, tag, residue, status = struct.unpack("<IIIB", csw)
    if sig != USBS_SIG:
        return data, f"bad status signature 0x{sig:08x}"
    return data, ("ok" if status == 0 else f"status 0x{status:02x}")


def hexdump(data: bytes, base: int = 0) -> str:
    out = []
    for off in range(0, len(data), 16):
        chunk = data[off:off + 16]
        hexpart = " ".join(f"{b:02x}" for b in chunk).ljust(47)
        text = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        out.append(f"   {base + off:08x}  {hexpart}  {text}")
    return "\n".join(out)


TARGETS = [
    (0x00000000, "address zero / boot ROM"),
    (0xE000ED00, "ARM Cortex-M CPUID"),
    (0x00118000, "ATJ2157 adfus load address"),
    (0x20000000, "typical Cortex-M SRAM"),
    (0xDEADBEEF, "CONTROL: nonsense address"),
]


def main():
    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        print("no ADFU device - power-cycle and re-enter ADFU")
        return 1
    dev.set_configuration()
    usb.util.claim_interface(dev, 0)
    print(f"connected to {VID:04x}:{PID:04x}")
    print("single-transfer read, data + status together (matches reference)\n")

    seen = {}
    for addr, label in TARGETS:
        print(f"-- 0x{addr:08x}  {label} --")
        data, note = read_mem(dev, addr, 64)
        if data is None:
            print(f"   {note}\n")
            continue
        print(f"   {note}")
        print(hexdump(data, addr))
        seen[addr] = data
        print()

    print("=" * 66)
    control = seen.get(0xDEADBEEF)
    distinct = {a: d for a, d in seen.items() if control is None or d != control}
    if control is not None and len(distinct) == 0:
        print("Every address still matches the nonsense-address control.")
        print("The ROM is not performing real reads - a stub is required.")
    else:
        print("Addresses returning data DIFFERENT from the control:")
        for a in distinct:
            print(f"   0x{a:08x}")
        cpu = seen.get(0xE000ED00)
        if cpu and len(cpu) >= 4:
            cpuid = struct.unpack("<I", cpu[:4])[0]
            cores = {0xC20: "Cortex-M0", 0xC60: "Cortex-M0+", 0xC23: "Cortex-M3",
                     0xC24: "Cortex-M4", 0xC27: "Cortex-M7", 0xD20: "Cortex-M23",
                     0xD21: "Cortex-M33"}
            if (cpuid >> 24) == 0x41:
                print(f"\n   CPUID 0x{cpuid:08x} -> ARM "
                      f"{cores.get((cpuid >> 4) & 0xFFF, 'unknown core')}")

    usb.util.release_interface(dev, 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
