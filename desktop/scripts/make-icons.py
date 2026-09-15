#!/usr/bin/env python3
"""Generate the app icon set from the LYZN mark.

The mark itself is a brand asset — assets/lyzn/app-icon/ios-marketing-1024.png,
the same file the phone ships — so this does not draw it. What it does is
resample that one master into the eight sizes electron-builder and the Linux
desktop entry want, with a proper box filter, so a 16px tray icon is an average
of 64x64 source pixels rather than one of them.

Standard library only, deliberately. Pillow is one `pip install` away on the
machine of whoever is reading this and absent on the machine of whoever is not,
and an icon script that cannot be run is an icon set that gets pasted in by
hand and drifts from the brand.
"""
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.path.join(HERE, '..', '..', 'assets', 'lyzn', 'app-icon', 'ios-marketing-1024.png')
OUT = os.path.join(HERE, '..', 'build')

# 16 through 512: the tray, the dock, the window, and the sizes electron-builder
# packs into .ico and .icns. icon.png is what the builder reads for Linux.
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]


def read_png(path):
    """Decode an 8-bit RGBA PNG into (width, height, bytearray)."""
    raw = open(path, 'rb').read()
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit(f'{path} is not a PNG')

    pos, idat, w = 8, bytearray(), None
    while pos < len(raw):
        (length,) = struct.unpack('>I', raw[pos:pos + 4])
        kind = raw[pos + 4:pos + 8]
        body = raw[pos + 8:pos + 8 + length]
        if kind == b'IHDR':
            w, h, depth, colour = struct.unpack('>IIBB', body[:10])
            if (depth, colour) != (8, 6):
                raise SystemExit(f'{path}: expected 8-bit RGBA, got depth {depth} colour type {colour}')
        elif kind == b'IDAT':
            idat += body
        elif kind == b'IEND':
            break
        pos += 12 + length

    if w is None:
        raise SystemExit(f'{path}: no header')

    data = zlib.decompress(bytes(idat))
    stride = w * 4
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    at = 0
    for y in range(h):
        f = data[at]
        line = bytearray(data[at + 1:at + 1 + stride])
        at += 1 + stride
        # The five PNG filters, undone in place. `a` is the pixel to the left,
        # `b` the one above, `c` the one above-left.
        for i in range(stride):
            a = line[i - 4] if i >= 4 else 0
            b = prev[i]
            c = prev[i - 4] if i >= 4 else 0
            if f == 1:
                line[i] = (line[i] + a) & 0xFF
            elif f == 2:
                line[i] = (line[i] + b) & 0xFF
            elif f == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 0xFF
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, out


def box_resize(src, w, h, size):
    """Average every source pixel that falls inside each destination pixel.

    Alpha-weighted, so the transparent edge of a rounded corner does not drag
    the colour underneath it towards black — which is the usual tell of an icon
    resampled without thinking about premultiplication.
    """
    out = bytearray(size * size * 4)
    for dy in range(size):
        y0, y1 = dy * h // size, max(dy * h // size + 1, (dy + 1) * h // size)
        for dx in range(size):
            x0, x1 = dx * w // size, max(dx * w // size + 1, (dx + 1) * w // size)
            r = g = b = a = 0
            n = 0
            for sy in range(y0, y1):
                row = sy * w * 4
                for sx in range(x0, x1):
                    i = row + sx * 4
                    alpha = src[i + 3]
                    r += src[i] * alpha
                    g += src[i + 1] * alpha
                    b += src[i + 2] * alpha
                    a += alpha
                    n += 1
            o = (dy * size + dx) * 4
            if a:
                out[o] = r // a
                out[o + 1] = g // a
                out[o + 2] = b // a
            out[o + 3] = a // n
    return out


def write_png(path, size, pixels):
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter 0: an icon is small and compresses fine flat
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(kind, body):
        return (struct.pack('>I', len(body)) + kind + body
                + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(bytes(raw), 9)))
        f.write(chunk(b'IEND', b''))


def main():
    master = os.path.normpath(MASTER)
    if not os.path.exists(master):
        raise SystemExit(f'no LYZN mark at {master}')
    w, h, pixels = read_png(master)
    print(f'{os.path.relpath(master)}: {w}x{h}')

    os.makedirs(OUT, exist_ok=True)
    for size in SIZES:
        small = box_resize(pixels, w, h, size)
        write_png(os.path.join(OUT, f'icon-{size}.png'), size, small)
        if size == 512:
            write_png(os.path.join(OUT, 'icon.png'), size, small)
        print(f'  icon-{size}.png')
    return 0


if __name__ == '__main__':
    sys.exit(main())
