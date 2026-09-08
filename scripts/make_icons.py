# -*- coding: utf-8 -*-
"""
生成思源集市要求的 icon.png (160x160, <=20KB) 与 preview.png (1024x768, <=200KB)。

不依赖 Pillow，直接用标准库手写 PNG 编码，保证任何环境都能生成。
运行： python scripts/make_icons.py
"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WECHAT_GREEN = (7, 193, 96, 255)
WHITE = (255, 255, 255, 255)
INK = (17, 24, 39, 255)
GRAY_DARK = (55, 65, 81, 255)
GRAY_MID = (156, 163, 175, 255)
GRAY_LIGHT = (209, 213, 219, 255)
BORDER = (229, 231, 235, 255)
PAGE_BG = (243, 244, 246, 255)


class Canvas:
    def __init__(self, w, h, bg=WHITE):
        self.w = w
        self.h = h
        self.px = [[bg for _ in range(w)] for _ in range(h)]

    def set(self, x, y, color):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = color

    def rect(self, x0, y0, x1, y1, color):
        for y in range(max(0, y0), min(self.h, y1)):
            row = self.px[y]
            for x in range(max(0, x0), min(self.w, x1)):
                row[x] = color

    def rounded_rect(self, x0, y0, x1, y1, r, color):
        for y in range(max(0, y0), min(self.h, y1)):
            for x in range(max(0, x0), min(self.w, x1)):
                inside = True
                if x < x0 + r and y < y0 + r:
                    inside = (x - (x0 + r)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
                elif x > x1 - r - 1 and y < y0 + r:
                    inside = (x - (x1 - r - 1)) ** 2 + (y - (y0 + r)) ** 2 <= r * r
                elif x < x0 + r and y > y1 - r - 1:
                    inside = (x - (x0 + r)) ** 2 + (y - (y1 - r - 1)) ** 2 <= r * r
                elif x > x1 - r - 1 and y > y1 - r - 1:
                    inside = (x - (x1 - r - 1)) ** 2 + (y - (y1 - r - 1)) ** 2 <= r * r
                if inside:
                    self.px[y][x] = color

    def circle(self, cx, cy, r, color):
        for y in range(max(0, cy - r), min(self.h, cy + r + 1)):
            for x in range(max(0, cx - r), min(self.w, cx + r + 1)):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.px[y][x] = color

    def save(self, path):
        raw = bytearray()
        for row in self.px:
            raw.append(0)
            for r, g, b, a in row:
                raw += bytes((r, g, b, a))
        compressed = zlib.compress(bytes(raw), 9)

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", compressed)
        png += chunk(b"IEND", b"")

        with open(path, "wb") as f:
            f.write(png)
        return len(png)


def make_icon(path):
    c = Canvas(160, 160, WECHAT_GREEN)

    # 打开的书：左右两页 + 书脊
    left_x0, right_x1 = 40, 120
    top, bottom = 44, 116
    mid_l, mid_r = 78, 82

    c.rounded_rect(left_x0, top, mid_l, bottom, 4, WHITE)
    c.rounded_rect(mid_r, top, right_x1, bottom, 4, WHITE)

    # 书脊
    c.rect(mid_l, top, mid_r, bottom, WECHAT_GREEN)

    # 页面文字线
    for ly in (60, 74, 88, 102):
        c.rect(48, ly, 70, ly + 4, WECHAT_GREEN)
        c.rect(90, ly, 112, ly + 4, WECHAT_GREEN)

    size = c.save(path)
    print(f"icon.png  {os.path.getsize(path)} bytes (<=20480 required)")
    return size


def make_preview(path):
    c = Canvas(1024, 768, PAGE_BG)

    # 左侧：文档区
    c.rounded_rect(24, 24, 700, 744, 10, WHITE)
    c.rect(48, 64, 460, 88, INK)  # 文档标题
    y = 120
    widths = [612, 560, 596, 480, 588, 540, 612, 420]
    for i, w in enumerate(widths):
        c.rect(48, y, 48 + w, y + 12, GRAY_LIGHT if i % 2 == 0 else GRAY_MID)
        y += 32
    # 模拟一条高亮划线
    c.rect(48, 392, 520, 412, (254, 240, 138, 255))
    y = 440
    for w in [596, 540, 480]:
        c.rect(48, y, 48 + w, y + 12, GRAY_LIGHT)
        y += 32

    # 右侧：插件 Dock 面板
    c.rounded_rect(716, 24, 1000, 744, 10, WHITE)
    c.rect(716, 24, 1000, 26, BORDER)

    # 面板标题
    c.rect(736, 52, 852, 72, INK)

    # 工具栏三个按钮
    for bx, bw in ((736, 96), (840, 86), (934, 52)):
        c.rounded_rect(bx, 92, bx + bw, 122, 4, BORDER)

    # 书籍卡片
    card_y = 144
    covers = [WECHAT_GREEN, (59, 130, 246, 255), (239, 68, 68, 255), (168, 85, 247, 255)]
    for i in range(4):
        cy = card_y + i * 96
        c.rounded_rect(736, cy, 976, cy + 80, 6, PAGE_BG)
        c.rect(748, cy + 12, 792, cy + 68, covers[i])  # 封面
        c.rect(806, cy + 16, 946, cy + 30, GRAY_DARK)  # 书名
        c.rect(806, cy + 38, 900, cy + 50, GRAY_MID)  # 作者
        c.rect(806, cy + 62, 964, cy + 68, BORDER)  # 进度条底
        filled = int(158 * (0.75 - i * 0.18))
        c.rect(806, cy + 62, 806 + filled, cy + 68, WECHAT_GREEN)  # 进度

    c.save(path)
    print(f"preview.png  {os.path.getsize(path)} bytes (<=204800 required)")


if __name__ == "__main__":
    make_icon(os.path.join(ROOT, "icon.png"))
    make_preview(os.path.join(ROOT, "preview.png"))
    print("done")
