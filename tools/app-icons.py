#!/usr/bin/env python3
"""Render the mobile app's icon set from the monochrome LYZN mark.

Ruling R2' (the controller's, overruling Decision 3): the mark is
monochrome everywhere — fg `#EDEAE4` on ink `#0B0B0C`, never the brand
green. `assets/lyzn/mono/` holds that mark, rendered from
`assets/lyzn/logo/lyzn-logo-vector.svg` by task 3.5; this script is the
only thing that turns it into what `mobile/app.json` and the tab bar ask
for. App spec §8 is the list; nothing here is drawn by hand.

    python3 tools/app-icons.py          # writes mobile/assets/*

Needs Pillow (`pip install pillow`). Run from the repository root. The
outputs are committed, so this never has to run in CI — it exists so the
next person can change a size without guessing what the old one was.
"""

from __future__ import annotations

import pathlib
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - a developer's first run
    sys.exit("Pillow is required: pip install pillow")

ROOT = pathlib.Path(__file__).resolve().parent.parent
MONO = ROOT / "assets" / "lyzn" / "mono"
OUT = ROOT / "mobile" / "assets"

INK = (11, 11, 12, 255)          # colors.ink  #0B0B0C
FG = (237, 234, 228, 255)        # colors.fg   #EDEAE4

#: The mark occupies this fraction of the canvas's width on an adaptive
#: icon's foreground layer. Android crops the outer third of that layer to
#: whatever shape the launcher wants, so anything past ~0.66 risks being
#: shaved; half leaves the mark room to breathe inside the circle too.
FOREGROUND_SCALE = 0.50

#: The splash mark is the same restraint at a larger canvas: Expo scales
#: `splash.image` to fit, and a mark that fills its own file has no air.
SPLASH_SCALE = 0.55


def mark(size: int, scale: float, colour: tuple[int, int, int, int] | None = None) -> Image.Image:
    """The mark, alpha-trimmed and re-centred on a transparent square."""
    src = Image.open(MONO / "mark-transparent-1024.png").convert("RGBA")
    src = src.crop(src.getchannel("A").getbbox())

    target = round(size * scale)
    ratio = min(target / src.width, target / src.height)
    src = src.resize((round(src.width * ratio), round(src.height * ratio)), Image.LANCZOS)

    if colour is not None:
        # Keep the alpha, replace the pixels: an Android themed icon is a
        # silhouette the launcher tints, so its colour must be uniform.
        flat = Image.new("RGBA", src.size, colour)
        flat.putalpha(src.getchannel("A"))
        src = flat

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(src, ((size - src.width) // 2, (size - src.height) // 2), src)
    return canvas


def write(image: Image.Image, name: str) -> None:
    path = OUT / name
    image.save(path, "PNG", optimize=True)
    print(f"{path.relative_to(ROOT)}  {image.width}×{image.height}")


def main() -> None:
    # The application icon: the mark on ink, already composed at 1024.
    write(Image.open(MONO / "mark-fg-on-ink-1024.png").convert("RGBA"), "icon.png")

    # Android's three layers. The background is flat ink (spec §8, D1: the
    # green adaptive background is retired), the foreground the mark inside
    # its safe zone, the monochrome layer the same silhouette in white.
    write(Image.new("RGBA", (1024, 1024), INK), "android-icon-background.png")
    write(mark(1024, FOREGROUND_SCALE), "android-icon-foreground.png")
    write(mark(1024, FOREGROUND_SCALE, (255, 255, 255, 255)), "android-icon-monochrome.png")

    # The splash sits on `splash.backgroundColor` (#0B0B0C), so the mark
    # itself is transparent and takes the fg.
    write(mark(1024, SPLASH_SCALE, FG), "splash-icon.png")

    # Expo web's favicon.
    write(Image.open(MONO / "mark-fg-on-ink-192.png").convert("RGBA"), "favicon.png")

    # The Pendant tab's glyph, cut at 24 pt for the three densities. iOS
    # renders a tab icon as a template (alpha only), so the fill is there
    # for Android, where `src` is drawn as it is.
    for suffix, scale in (("", 1), ("@2x", 2), ("@3x", 3)):
        write(mark(24 * scale, 1.0, FG), f"pendant-tab{suffix}.png")


if __name__ == "__main__":
    main()
