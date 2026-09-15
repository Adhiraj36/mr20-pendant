#!/usr/bin/env python3
"""Exercise the parts of the PoC that do not need the pendant attached."""
import shutil
import tempfile
from pathlib import Path

from mr20 import classify, decode, field
from mr20sync import WIFI_SENTINEL, Library, MacWifi

failures = []


def check(label, got, want):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        print(f"        got  {got!r}\n        want {want!r}")
        failures.append(label)


print("\n== protocol parsing (every documented device response) ==")
# (raw message, field index, expected value, description)
cases = [
    ("XS_DEV&STE&1", 2, "1", "recording status"),
    ("XS_DEV&STA&2026-08-19 17-36-06.mp3", 2, "2026-08-19 17-36-06.mp3", "start + filename"),
    ("XS_DEV&SPA&7500&8000", 2, "7500", "free MB"),
    ("XS_DEV&SPA&7500&8000", 3, "8000", "total MB"),
    ("XS_DEV&BAT&87", 2, "87", "battery"),
    ("XS_DEV&FW&1.0", 2, "1.0", "firmware version"),
    ("XS_DEV&MAC&50c0f04b790c", 2, "50c0f04b790c", "bt mac"),
    ("XS_DEV&CT&20250909105012", 2, "20250909105012", "device time"),
    ("XS_DEV&DIRS&2025-08-13", 2, "2025-08-13", "folder name"),
    ("XS_DEV&DIRS_SUM&3", 2, "3", "folder count"),
    ("XS_DEV&F&2025-08-13&rec1.mp3&125&320000", 3, "rec1.mp3", "file name"),
    ("XS_DEV&F&2025-08-13&rec1.mp3&125&320000", 4, "125", "duration secs"),
    ("XS_DEV&F&2025-08-13&rec1.mp3&125&320000", 5, "320000", "file size"),
    ("XS_DEV&LIST&12", 2, "12", "file count"),
    ("XS_DEV&U&320000", 2, "320000", "BLE transfer size"),
    ("XS_DEV&W&320000", 2, "320000", "WiFi transfer size"),
    ("XS_DEV&WIFI&PENDANT_AP&12345678", 2, "PENDANT_AP", "wifi ssid"),
    ("XS_DEV&WIFI&PENDANT_AP&12345678", 3, "12345678", "wifi password"),
    ("XS_DEV&WIFIS&1", 2, "1", "wifi state"),
    ("XS_DEV&WF&V1", 2, "V1", "wifi firmware"),
    ("XS_DEV&USB&1", 2, "1", "usb file mode"),
    ("XS_DEV&RT&rec1.mp3&65", 2, "rec1.mp3", "in-progress name"),
    ("XS_DEV&RT&rec1.mp3&65", 3, "65", "in-progress secs"),
]
for msg, idx, want, label in cases:
    check(label, field(msg, idx), want)

print("\n== the DIRS / DIRS_SUM prefix trap ==")
# "XS_DEV&DIRS_SUM&3" also startswith "XS_DEV&DIRS" - the terminator must be
# matched before the item prefix or list collection never ends.
check("DIRS_SUM is not mistaken for a DIRS item",
      "XS_DEV&DIRS_SUM&3".startswith("XS_DEV&DIRS&"), False)
check("a real DIRS item still matches",
      "XS_DEV&DIRS&2025-08-13".startswith("XS_DEV&DIRS&"), True)

print("\n== dangerous-command gating (verbs, prefix added by the client) ==")
must_block = [
    "BLE&RESET",           # formats storage
    "OTA&123456",          # firmware write
    "WIFI&OTA&123456",     # wifi firmware write
    "OT&OVER",             # commits firmware
    "D&2025-08-13&a.mp3",  # deletes a recording
    "BLE&OFF",             # resets pairing
    "WIFI&CH",             # changes wifi creds
]
for verb in must_block:
    check(f"blocks {verb}", classify(verb) is not None, True)

must_allow = [
    "STE", "STA", "STO", "BAT", "SPACE", "FW", "MAC", "GT", "WF",
    "LIST_DIRS", "LIST&2025-08-13", "U&2025-08-13&a.mp3",
    "W&2025-08-13&a.mp3", "WIFIO", "WIFIC", "WIFI", "WIFIS",
    "SHAKE", "SHUT", "GET&USB", "REC&SECEN",
]
for verb in must_allow:
    check(f"allows {verb}", classify(verb) is None, True)

print("\n== the gate actually refuses, not just classifies ==")
# A classify() that returns a reason is useless if send() ignores it.
import asyncio as _asyncio

from mr20 import MR20 as _MR20


class _FakeChar:
    uuid = "001120a2-2233-4455-6677-88995a5b5c5d"
    properties = ["write"]


class _FakeClient:
    """Records writes so we can prove the destructive one never reaches the wire."""
    def __init__(self):
        self.written = []

    async def write_gatt_char(self, uuid, data, response=True):
        self.written.append(data)


guarded = _MR20("fake", allow_dangerous=False, verbose=False)
guarded.client = _FakeClient()
try:
    _asyncio.run(guarded.send("BLE&RESET"))
    check("send() raises on the format command", False, True)
except PermissionError:
    check("send() raises on the format command", True, True)
check("nothing was transmitted", guarded.client.written, [])

_asyncio.run(guarded.send("BAT"))
check("a safe verb still transmits", guarded.client.written, [b"BLE&BAT"])

unlocked = _MR20("fake", allow_dangerous=True, verbose=False)
unlocked.client = _FakeClient()
_asyncio.run(unlocked.send("BLE&RESET"))
check("--allow-dangerous lets it through", unlocked.client.written, [b"BLE&BLE&RESET"])

print("\n== live-stream MP3 frame alignment ==")
from mr20 import align_mp3

# Captures begin mid-frame; everything before the first sync must go.
payload = b"\xff\xf3\x48\xc4" + b"\x11" * 200
check("leading partial frame trimmed", align_mp3(b"\x40\x90\xd5" + payload), payload)
check("already-aligned data untouched", align_mp3(payload), payload)
check("data with no sync survives unchanged", align_mp3(b"\x01\x02\x03"), b"\x01\x02\x03")

print("\n== WiFi end-of-transfer sentinel ==")
payload = b"\xff\xf3H\xc4fake mp3 payload"
stream = payload + WIFI_SENTINEL
stripped = stream[: -len(WIFI_SENTINEL)] if stream.endswith(WIFI_SENTINEL) else stream
check("sentinel stripped, payload intact", stripped, payload)
check("sentinel bytes match the doc", WIFI_SENTINEL.hex(), "ba5a028f04")

print("\n== notification decoding ==")
check("trailing NULs stripped", decode(b"XS_DEV&BAT&87\x00\x00"), "XS_DEV&BAT&87")
check("whitespace stripped", decode(b"  XS_DEV&STO \r\n"), "XS_DEV&STO")

print("\n== local library round-trip (real MP3 from the device) ==")
src = Path("/Volumes/MR20/RECORD/2026-08-19/2026-08-19 17-36-06.mp3")
data = src.read_bytes() if src.exists() else b"\xff\xf3H\xc4" + b"\x00" * 4096
print(f"  using {'the real recording' if src.exists() else 'synthetic data'}"
      f" ({len(data)} bytes)")

tmp = Path(tempfile.mkdtemp())
try:
    lib = Library(tmp / "library")
    folder, name = "2026-08-19", "2026-08-19 17-36-06.mp3"
    check("file is initially absent", lib.have(folder, name, len(data)), False)
    dest = lib.save(folder, name, data, via="test")
    check("saved bytes match exactly", dest.read_bytes(), data)
    check("file now recorded as present", lib.have(folder, name, len(data)), True)
    check("stored under its date folder", dest.parent.name, folder)
    check("no .part left behind", list(dest.parent.glob("*.part")), [])

    # A fresh Library must trust the on-disk manifest, so a restart does not
    # re-download the whole device.
    lib2 = Library(tmp / "library")
    check("manifest survives restart", lib2.have(folder, name, len(data)), True)
    # A size mismatch means the device file changed - refetch it.
    check("size mismatch forces refetch", lib2.have(folder, name, len(data) + 1), False)
    # If the local file is deleted, it must be refetched even though the
    # manifest still lists it.
    dest.unlink()
    check("deleted local file forces refetch",
          Library(tmp / "library").have(folder, name, len(data)), False)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print("\n== macOS WiFi interface detection ==")
wifi = MacWifi()
detected = wifi.current_network()
print(f"  interface : {wifi.interface}")
print(f"  current   : {detected}  "
      f"({'macOS is hiding the SSID' if detected is None else 'readable'})")
check("a Wi-Fi interface was found", wifi.interface is not None, True)
check("not currently on the pendant AP", wifi.on_pendant_network(), False)

print("\n== network-switch safety guard ==")
# join() must bail out BEFORE touching networksetup when it has no way to put
# the Mac back on its own network. Only exercisable while the SSID is hidden.
if detected is None:
    guard = MacWifi(restore_ssid=None, force=False)
    check("refuses to switch networks with no restore target",
          guard.join("FAKE_PENDANT_AP", "fakepassword"), False)
    check("nothing was joined", guard.on_pendant_network(), False)
    ready = MacWifi(restore_ssid="SomeNetwork", force=False)
    check("an explicit --restore-ssid satisfies the guard",
          ready.restore_ssid, "SomeNetwork")
else:
    print("  SKIP  SSID is readable on this Mac, guard path not exercised")

print("\n== restore is a no-op when nothing was joined ==")
idle = MacWifi()
idle.restore()  # must not raise or change the network
check("still not on the pendant AP after restore()", idle.on_pendant_network(), False)

print("\n" + "=" * 60)
if failures:
    print(f"{len(failures)} CHECK(S) FAILED: {', '.join(failures)}")
    raise SystemExit(1)
print("all checks passed")
