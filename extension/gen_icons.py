#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成扩展图标：B站粉(#FB7299)底 + 白色五角星。纯标准库，输出 16/48/128 PNG。"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent / "icons"
PINK = (0xFB, 0x72, 0x99)
WHITE = (255, 255, 255)


def star_points(cx, cy, r_out, r_in, n=5):
    pts = []
    for i in range(2 * n):
        ang = -math.pi / 2 + i * math.pi / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def inside(px, py, poly):
    # ray-casting point-in-polygon
    inside_ = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and \
           (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi):
            inside_ = not inside_
        j = i
    return inside_


def make_png(path, size):
    w = h = size
    cx = cy = (size - 1) / 2
    poly = star_points(cx, cy, size * 0.34, size * 0.34 * 0.42)
    rows = bytearray()
    for y in range(h):
        rows.append(0)  # filter type 0
        for x in range(w):
            # 抗锯齿：采样 2x2
            hits = 0
            for dy in (0.25, 0.75):
                for dx in (0.25, 0.75):
                    if inside(x + dx, y + dy, poly):
                        hits += 1
            t = hits / 4.0
            r = int(PINK[0] + (WHITE[0] - PINK[0]) * t)
            g = int(PINK[1] + (WHITE[1] - PINK[1]) * t)
            b = int(PINK[2] + (WHITE[2] - PINK[2]) * t)
            rows += bytes((r, g, b))

    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(rows), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"wrote {path} ({size}x{size}, {len(png)}B)")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for s in (16, 48, 128):
        make_png(OUT / f"icon{s}.png", s)
