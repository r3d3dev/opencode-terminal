#!/usr/bin/env python3
"""Generate images/icon.png (256x256) for the OpenCode v2 Terminal mark,
using only the standard library.

The mark is the extension's own "O with a terminal prompt" glyph: a periwinkle
frame with an inset shadow band, a lit panel, and a white prompt made of a
three-dot chevron and an underscore. It is not the OpenCode logo.
"""
import math
import os
import struct
import zlib

SIZE = 256
GRID = 512  # the mark is authored on a 512x512 grid

BG = (41, 40, 58)         # #29283A icon background
FRAME = (129, 138, 193)   # #818AC1
STRIP = (42, 41, 59)      # #2A293B recessed band
PANEL = (63, 63, 89)      # #3F3F59 lit panel
GLYPH = (255, 255, 255)

U = 28
OW, OH = 10 * U, 13 * U
OX, OY = (GRID - OW) // 2, (GRID - OH) // 2  # centre the mark inside the icon
CX, CY = OX + 2 * U, OY + 2 * U  # counter
CELLS = [(1, 3), (2, 4), (1, 5), (1, 7), (2, 7)]
RADIUS = 104


def rect(x, y, x0, y0, x1, y1):
    return x0 <= x < x1 and y0 <= y < y1


def rounded(x, y, x0, y0, x1, y1, r):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2 - r, (y1 - y0) / 2 - r
    qx, qy = abs(x - cx) - hx, abs(y - cy) - hy
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r


def layers():
    out = [(lambda x, y: rounded(x, y, 16, 16, 496, 496, RADIUS) < 0, BG)]
    out.append((
        lambda x, y: rect(x, y, OX, OY, OX + OW, OY + OH)
        and not rect(x, y, CX, CY, CX + 6 * U, CY + 9 * U),
        FRAME,
    ))
    out.append((lambda x, y: rect(x, y, CX, CY, CX + 6 * U, CY + 2 * U), STRIP))
    out.append((lambda x, y: rect(x, y, CX, CY + 2 * U, CX + 6 * U, CY + 9 * U), PANEL))
    for c, r in CELLS:
        x0, y0 = CX + c * U, CY + r * U
        out.append((
            lambda x, y, x0=x0, y0=y0: rect(x, y, x0, y0, x0 + U, y0 + U),
            GLYPH,
        ))
    return out


def main():
    supersample = 3
    stack = layers()
    raw = bytearray()
    for py in range(SIZE):
        raw.append(0)  # PNG filter: none
        for px in range(SIZE):
            acc = [0, 0, 0, 0]
            for sy in range(supersample):
                for sx in range(supersample):
                    x = (px + (sx + 0.5) / supersample) * GRID / SIZE
                    y = (py + (sy + 0.5) / supersample) * GRID / SIZE
                    color = None
                    for predicate, value in stack:
                        if predicate(x, y):
                            color = value
                    if color:
                        acc[0] += color[0]
                        acc[1] += color[1]
                        acc[2] += color[2]
                        acc[3] += 255
            n = supersample * supersample
            raw.extend(bytes(v // n for v in acc))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "images", "icon.png")
    with open(out, "wb") as f:
        f.write(png)
    print("wrote", out, len(png), "bytes")


if __name__ == "__main__":
    main()
