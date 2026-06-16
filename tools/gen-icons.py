#!/usr/bin/env python3
"""Generate app icons as PNGs using only the Python standard library.

Produces a diagonal blue->purple gradient (matching the app's Physical/Mental
theme) with a soft central ring. No external dependencies or network needed.
"""
import zlib
import struct
import os
import math

ICON_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
PHYS = (59, 130, 246)   # --physical
MENT = (168, 85, 247)   # --mental
BG = (7, 10, 18)        # --bg


def lerp(a, b, t):
    return int(round(a + (b - a) * t))


def write_png(path, w, h, pixels):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter type 0 (none)
        raw.extend(pixels[y * stride:(y + 1) * stride])
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def make_icon(size, maskable=False):
    px = bytearray(size * size * 4)
    cx, cy = size / 2, size / 2
    # Ring radii (as fraction of size). Maskable keeps content in the safe zone.
    ring_outer = size * (0.30 if maskable else 0.34)
    ring_inner = size * (0.20 if maskable else 0.23)
    maxd = size + size
    for y in range(size):
        for x in range(size):
            t = (x + y) / maxd
            r = lerp(PHYS[0], MENT[0], t)
            g = lerp(PHYS[1], MENT[1], t)
            b = lerp(PHYS[2], MENT[2], t)
            # Vignette toward the dark background at the corners.
            d = math.hypot(x - cx, y - cy) / (size / 2)
            v = max(0.0, min(1.0, (d - 0.75) / 0.45))
            r = lerp(r, BG[0], v)
            g = lerp(g, BG[1], v)
            b = lerp(b, BG[2], v)
            # Soft white ring emblem.
            rd = math.hypot(x - cx, y - cy)
            if ring_inner <= rd <= ring_outer:
                edge = min(rd - ring_inner, ring_outer - rd)
                a = max(0.0, min(1.0, edge / (size * 0.02)))
                r = lerp(r, 248, 0.85 * a)
                g = lerp(g, 250, 0.85 * a)
                b = lerp(b, 252, 0.85 * a)
            i = (y * size + x) * 4
            px[i] = r
            px[i + 1] = g
            px[i + 2] = b
            px[i + 3] = 255
    return px


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    for size in (180, 192, 512):
        write_png(os.path.join(ICON_DIR, f"icon-{size}.png"), size, size, make_icon(size))
    write_png(os.path.join(ICON_DIR, "icon-maskable-512.png"), 512, 512, make_icon(512, maskable=True))
    print("Icons written to", os.path.normpath(ICON_DIR))


if __name__ == "__main__":
    main()
