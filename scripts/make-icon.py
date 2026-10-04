#!/usr/bin/env python3
"""Generate images/icon.png (128x128) without any third-party deps."""
import os
import struct
import zlib

W = H = 128

# Colors (RGBA)
BG = (17, 24, 39, 255)        # dark slate
PROMPT = (52, 211, 153, 255)  # emerald ">" and "_"
CURSOR = (255, 255, 255, 255)

px = [[(0, 0, 0, 0) for _ in range(W)] for _ in range(H)]


def rounded_rect(x0, y0, x1, y1, r, color):
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            # distance to nearest corner center
            cx = min(max(x, x0 + r), x1 - 1 - r)
            cy = min(max(y, y0 + r), y1 - 1 - r)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                px[y][x] = color


def line(x0, y0, x1, y1, width, color):
    steps = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(steps + 1):
        t = i / steps
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        for dy in range(-width, width + 1):
            for dx in range(-width, width + 1):
                if dx * dx + dy * dy <= width * width:
                    xi, yi = int(x) + dx, int(y) + dy
                    if 0 <= xi < W and 0 <= yi < H:
                        px[yi][xi] = color


# Body: rounded square with a "terminal" title bar feel
rounded_rect(6, 14, 122, 114, 16, BG)
# Title bar strip
BAR = (31, 41, 55, 255)
for y in range(14, 40):
    for x in range(W):
        if px[y][x] == BG:
            px[y][x] = BAR
# three dots in the title bar
for cx in (24, 40, 56):
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            if dx * dx + dy * dy <= 16:
                px[27 + dy][cx + dx] = (75, 85, 99, 255)

# Prompt: ">" chevron
line(30, 56, 52, 74, 5, PROMPT)
line(52, 74, 30, 92, 5, PROMPT)
# "_" underscore
line(60, 92, 94, 92, 5, CURSOR)

# --- write PNG ---
raw = bytearray()
for y in range(H):
    raw.append(0)  # filter: none
    for x in range(W):
        raw.extend(px[y][x])


def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    + chunk(b"IEND", b"")
)

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, "images", "icon.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "wb") as f:
    f.write(png)
print("wrote", out, len(png), "bytes")
