#!/usr/bin/env python3
"""Generate platform launcher icons from assets/icon.png.

Dev-time tool (requires Pillow): regenerates the committed icon assets that
`make-launcher.mjs` bakes into the desktop shortcuts. Re-run after replacing
assets/icon.png with new art.

    python3 scripts/generate-icons.py

Outputs (all derived from the single source, Lanczos-resampled at every size):
    assets/navidrome-player.png    512x512 PNG  -> Linux .desktop Icon=
    assets/navidrome-player.ico    16..256      -> Windows .lnk IconLocation
    assets/navidrome-player.icns   16..1024     -> macOS .app bundle icon

The source is padded to a square canvas (transparent) rather than cropped, so
its rounded corners survive. ICO/ICNS embed PNG-compressed entries directly, so
no resampling beyond our explicit Image.LANCZOS pass ever touches the pixels.
"""

import struct
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SRC = ASSETS / "icon.png"


def load_square():
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    side = max(w, h)
    if (w, h) == (side, side):
        return im
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return canvas


def png_bytes(base, size):
    """Lanczos-resample `base` to size x size and return PNG-encoded bytes."""
    resized = base.resize((size, size), Image.LANCZOS)
    buf = BytesIO()
    resized.save(buf, format="PNG")
    return buf.getvalue()


def write_png(base):
    out = ASSETS / "navidrome-player.png"
    out.write_bytes(png_bytes(base, 512))
    print(f"  wrote {out.relative_to(ROOT)}  (512x512)")


def write_ico(base):
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [(s, png_bytes(base, s)) for s in sizes]

    header = struct.pack("<HHH", 0, 1, len(images))  # reserved, type=icon, count
    entries = bytearray()
    data = bytearray()
    offset = len(header) + 16 * len(images)
    for size, blob in images:
        dim = 0 if size >= 256 else size  # 0 means 256 in the ICO dir
        entries += struct.pack(
            "<BBBBHHII",
            dim, dim,        # width, height
            0,               # palette count (0 = no palette)
            0,               # reserved
            1,               # color planes
            32,              # bits per pixel
            len(blob),       # bytes of image data
            offset,          # offset from file start
        )
        data += blob
        offset += len(blob)

    out = ASSETS / "navidrome-player.ico"
    out.write_bytes(header + bytes(entries) + bytes(data))
    print(f"  wrote {out.relative_to(ROOT)}  ({', '.join(str(s) for s in sizes)})")


def write_icns(base):
    # OSType -> pixel dimension. These are the PNG-accepting ICNS element types
    # macOS reads natively (retina @2x variants included for crisp scaling).
    types = [
        (b"icp4", 16),
        (b"icp5", 32),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic09", 512),
        (b"ic11", 32),    # 16x16@2x
        (b"ic12", 64),    # 32x32@2x
        (b"ic13", 256),   # 128x128@2x
        (b"ic14", 512),   # 256x256@2x
        (b"ic10", 1024),  # 512x512@2x
    ]
    body = bytearray()
    for ostype, size in types:
        blob = png_bytes(base, size)
        body += ostype + struct.pack(">I", len(blob) + 8) + blob

    out = ASSETS / "navidrome-player.icns"
    out.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + bytes(body))
    print(f"  wrote {out.relative_to(ROOT)}  (16..1024)")


def main():
    if not SRC.exists():
        raise SystemExit(f"source art not found: {SRC}")
    base = load_square()
    print(f"  source:  {SRC.relative_to(ROOT)}  {Image.open(SRC).size} -> square {base.size}")
    write_png(base)
    write_ico(base)
    write_icns(base)


if __name__ == "__main__":
    main()
