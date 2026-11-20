"""Side-by-side composite for the UI parity loop: legacy | new (| abs diff).

  python scripts/ui-reference/compare.py <legacy.png> <new.png> <out.png> [--diff]
"""
import sys

from PIL import Image, ImageChops, ImageDraw


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    legacy, new, out = Image.open(args[0]).convert('RGB'), Image.open(args[1]).convert('RGB'), args[2]
    # Frameless windows have 8 px invisible borders (left/right/bottom): the CSS viewport is the PNG
    # minus those. Both windows (legacy and new) behave the same, so crop both to the viewport.
    if '--crop' in sys.argv:
        legacy = legacy.crop((8, 0, legacy.width - 8, legacy.height - 8))
        new = new.crop((8, 0, new.width - 8, new.height - 8))
    w, h = max(legacy.width, new.width), max(legacy.height, new.height)
    panels = [('LEGACY', legacy), ('NEW', new)]
    if '--diff' in sys.argv:
        a, b = Image.new('RGB', (w, h)), Image.new('RGB', (w, h))
        a.paste(legacy)
        b.paste(new)
        panels.append(('DIFF x3', ImageChops.difference(a, b).point(lambda v: min(255, v * 3))))
    pad, bar = 8, 18
    sheet = Image.new('RGB', (len(panels) * (w + pad) + pad, h + bar + pad), (60, 60, 60))
    d = ImageDraw.Draw(sheet)
    for i, (label, im) in enumerate(panels):
        x = pad + i * (w + pad)
        d.text((x, 3), label, fill=(255, 255, 255))
        sheet.paste(im, (x, bar))
    sheet.save(out)
    print(out, sheet.size)


main()
