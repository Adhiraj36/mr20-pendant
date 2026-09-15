#!/usr/bin/env python3
"""
Inspect the Actions ADFU recovery bootloader (USB 10d6:10d6).

Read-only. Enumerates descriptors and endpoints so we can see what command
surface the ROM exposes before attempting anything that writes.
"""
import sys

import usb.core
import usb.util

VID, PID = 0x10D6, 0x10D6

CLASS_NAMES = {
    0x00: "per-interface", 0x01: "audio", 0x02: "CDC control", 0x03: "HID",
    0x08: "mass storage", 0x09: "hub", 0x0A: "CDC data", 0xFF: "vendor specific",
}


def describe_endpoint(ep) -> str:
    direction = "IN " if usb.util.endpoint_direction(ep.bEndpointAddress) == usb.util.ENDPOINT_IN else "OUT"
    kinds = {0: "control", 1: "isochronous", 2: "bulk", 3: "interrupt"}
    kind = kinds.get(usb.util.endpoint_type(ep.bmAttributes), "?")
    return (f"addr 0x{ep.bEndpointAddress:02x}  {direction}  {kind:<9} "
            f"max packet {ep.wMaxPacketSize}")


def main():
    dev = usb.core.find(idVendor=VID, idProduct=PID)
    if dev is None:
        print(f"no device at {VID:04x}:{PID:04x} - is it still in ADFU mode?")
        print("ADFU usually drops out after a timeout or on replug.")
        return 1

    print(f"found {VID:04x}:{PID:04x}\n")
    print("-- device descriptor --")
    print(f"   USB version    : {dev.bcdUSB >> 8}.{(dev.bcdUSB >> 4) & 0xF}")
    print(f"   device class   : 0x{dev.bDeviceClass:02x} "
          f"({CLASS_NAMES.get(dev.bDeviceClass, '?')})")
    print(f"   device version : 0x{dev.bcdDevice:04x}")
    print(f"   max packet 0   : {dev.bMaxPacketSize0}")
    print(f"   configurations : {dev.bNumConfigurations}")

    for name, idx in (("manufacturer", dev.iManufacturer),
                      ("product", dev.iProduct),
                      ("serial", dev.iSerialNumber)):
        if not idx:
            continue
        try:
            print(f"   {name:<14} : {usb.util.get_string(dev, idx)!r}")
        except Exception as e:
            print(f"   {name:<14} : <unreadable: {type(e).__name__}>")

    for cfg in dev:
        print(f"\n-- configuration {cfg.bConfigurationValue} --")
        print(f"   interfaces : {cfg.bNumInterfaces}")
        print(f"   max power  : {cfg.bMaxPower * 2} mA")
        for intf in cfg:
            print(f"\n   interface {intf.bInterfaceNumber} "
                  f"alt {intf.bAlternateSetting}")
            print(f"      class    : 0x{intf.bInterfaceClass:02x} "
                  f"({CLASS_NAMES.get(intf.bInterfaceClass, '?')})")
            print(f"      subclass : 0x{intf.bInterfaceSubClass:02x}")
            print(f"      protocol : 0x{intf.bInterfaceProtocol:02x}")
            for ep in intf:
                print(f"      endpoint {describe_endpoint(ep)}")

    print("\n-- access check --")
    try:
        cfg = dev.get_active_configuration()
        print(f"   active configuration: {cfg.bConfigurationValue}")
    except usb.core.USBError as e:
        print(f"   could not read active configuration: {e}")
        print("   (macOS may need this run with sudo)")
        return 2

    intf = cfg[(0, 0)]
    try:
        usb.util.claim_interface(dev, intf.bInterfaceNumber)
        print(f"   claimed interface {intf.bInterfaceNumber} - we can talk to it")
        usb.util.release_interface(dev, intf.bInterfaceNumber)
    except usb.core.USBError as e:
        print(f"   could not claim interface: {e}")
        print("   (try with sudo)")
        return 2

    print("\nADFU is reachable and claimable. Nothing was written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
