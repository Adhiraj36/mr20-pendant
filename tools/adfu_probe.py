#!/usr/bin/env python3
"""
Probe the Actions ADFU bootloader with standard, read-only SCSI commands.

ADFU speaks the USB Bulk-Only Transport wrapper (CBW/CSW) over its two bulk
endpoints. This sends only commands defined by the SCSI standard as read-only -
TEST UNIT READY, INQUIRY, READ CAPACITY - to identify the chip.

No vendor opcodes, no writes, no erase. Guessing at vendor opcodes on a ROM
bootloader is how devices get bricked, so that is deliberately not done here.
"""
import struct
import sys

import usb.core
import usb.util

VID, PID = 0x10D6, 0x10D6
EP_IN, EP_OUT = 0x81, 0x02
CBW_SIG = 0x43425355  # 'USBC'
CSW_SIG = 0x53425355  # 'USBS'

tag_counter = 0


def build_cbw(cdb: bytes, data_len: int, data_in: bool = True, lun: int = 0) -> bytes:
    global tag_counter
    tag_counter += 1
    cbw = struct.pack(
        "<IIIBBB",
        CBW_SIG, tag_counter, data_len,
        0x80 if data_in else 0x00,
        lun, len(cdb),
    )
    return cbw + cdb.ljust(16, b"\x00")


def transact(dev, cdb: bytes, data_len: int, label: str, timeout: int = 3000):
    """Send one CBW, read any data, then read the status wrapper."""
    try:
        dev.write(EP_OUT, build_cbw(cdb, data_len), timeout=timeout)
    except usb.core.USBError as e:
        return None, f"CBW write failed: {e}"

    data = b""
    if data_len:
        try:
            data = bytes(dev.read(EP_IN, data_len, timeout=timeout))
        except usb.core.USBError as e:
            data = b""
            note = f"data phase: {e}"
        else:
            note = ""
    else:
        note = ""

    try:
        csw = bytes(dev.read(EP_IN, 13, timeout=timeout))
    except usb.core.USBError as e:
        return data, f"{note} no status wrapper: {e}".strip()

    if len(csw) == 13:
        sig, tag, residue, status = struct.unpack("<IIIB", csw)
        ok = "ok" if status == 0 else f"status 0x{status:02x}"
        valid = "valid" if sig == CSW_SIG else f"bad signature 0x{sig:08x}"
        return data, f"{note} CSW {valid}, {ok}, residue {residue}".strip()
    return data, f"{note} short status ({len(csw)} bytes)".strip()


def hexdump(data: bytes, limit: int = 128) -> str:
    lines = []
    for off in range(0, min(len(data), limit), 16):
        chunk = data[off:off + 16]
        hexpart = " ".join(f"{b:02x}" for b in chunk).ljust(47)
        text = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"   {off:04x}  {hexpart}  {text}")
    return "\n".join(lines)


def main():
    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        print("no ADFU device found - it may have dropped out of ADFU mode")
        return 1

    dev.set_configuration()
    usb.util.claim_interface(dev, 0)
    print(f"talking to {VID:04x}:{PID:04x} on bulk endpoints "
          f"0x{EP_IN:02x}/0x{EP_OUT:02x}\n")

    print("-- TEST UNIT READY (SCSI 0x00) --")
    _, note = transact(dev, bytes([0x00] + [0] * 5), 0, "tur")
    print(f"   {note}\n")

    print("-- INQUIRY (SCSI 0x12) --")
    data, note = transact(dev, bytes([0x12, 0, 0, 0, 36, 0]), 36, "inquiry")
    print(f"   {note}")
    if data:
        print(hexdump(data))
        if len(data) >= 36:
            vendor = data[8:16].decode("ascii", "replace").strip()
            product = data[16:32].decode("ascii", "replace").strip()
            rev = data[32:36].decode("ascii", "replace").strip()
            print(f"\n   vendor  : {vendor!r}")
            print(f"   product : {product!r}")
            print(f"   revision: {rev!r}")
    print()

    print("-- READ CAPACITY (SCSI 0x25) --")
    data, note = transact(dev, bytes([0x25] + [0] * 9), 8, "capacity")
    print(f"   {note}")
    if data and len(data) >= 8:
        last_lba, block_size = struct.unpack(">II", data[:8])
        print(hexdump(data))
        if block_size:
            total = (last_lba + 1) * block_size
            print(f"\n   last LBA   : {last_lba}")
            print(f"   block size : {block_size}")
            print(f"   total      : {total} bytes ({total / 1e6:.1f} MB)")
    print()

    usb.util.release_interface(dev, 0)
    print("done - only read-only standard SCSI commands were sent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
