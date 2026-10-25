"""Rebuild PDF metrics from the bundled TrueType fonts without changing them.

Run with fontTools. Some complete NanumSquare fonts map unsupported characters to
empty outlines; those mappings must not hide the visible fallback glyphs.
"""
from pathlib import Path
import json
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'frontend/assets/print'
FONT_IDS = ('regular', 'bold', 'extra', 'worksheet', 'fallback')


def font_metrics(ident):
    with TTFont(OUT / f'{ident}.ttf') as font:
        outlines = font['glyf']
        cmap = {}
        for codepoint, name in font.getBestCmap().items():
            glyph_id = font.getGlyphID(name)
            glyph = outlines[name]
            # Composite glyphs have a negative contour count and remain valid.
            visible = glyph.isComposite() or glyph.numberOfContours > 0
            if codepoint >= 32 and glyph_id > 0 and (visible or chr(codepoint).isspace()):
                cmap[str(codepoint)] = glyph_id
        head, hhea = font['head'], font['hhea']
        result = {
            'id': ident,
            'url': f'assets/print/{ident}.ttf',
            'unitsPerEm': head.unitsPerEm,
            'ascent': hhea.ascent,
            'descent': hhea.descent,
            'capHeight': getattr(font['OS/2'], 'sCapHeight', hhea.ascent),
            'bbox': {'minX': head.xMin, 'minY': head.yMin, 'maxX': head.xMax, 'maxY': head.yMax},
            'cmap': cmap,
            'widths': [font['hmtx'].metrics[name][0] for name in font.getGlyphOrder()],
        }
    print(ident, len(cmap), 'visible or whitespace characters')
    return result


def main():
    metadata = {ident: font_metrics(ident) for ident in FONT_IDS}
    (OUT / 'font-metrics.json').write_text(json.dumps(metadata, separators=(',', ':')))


if __name__ == '__main__':
    main()
