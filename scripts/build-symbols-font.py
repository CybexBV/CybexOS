#!/usr/bin/env python3
"""Build Cybex OS Symbols: a one-glyph font holding the Cybex OS mark.

No installed font has the mark, so a terminal cannot draw it in the fish
prompt. This font puts the monochrome symbol (assets/brand/symbol/svg/
cybexos-symbol-mono-white.svg) at CODEPOINT, in Supplementary Private Use
Area-B, which no Nerd Font uses. Terminals reach it through fontconfig's
fallback, like any glyph their own font lacks, and draw it in the prompt's
text colour.

Those terminals draw a fallback glyph at its own size from the left edge of
its cell, on the terminal font's baseline: they don't centre it. So the mark
is placed for the default terminal font, JetBrains Mono Nerd Font, the way
the prompt's icon slot needs it. The prompt gives the icon two cells (the
icon and the space after it), and the mark is centred on the line between
them and on the middle of the cell's height, where Nerd Font icons sit.

    build-symbols-font.py SVG OUTPUT.ttf

nix/packages/symbols-font.nix runs this at build time. The Settings preview
and the bar draw the mark from its SVG, never from this font.
"""
import sys
import xml.etree.ElementTree as ET

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

FAMILY = 'Cybex OS Symbols'
CODEPOINT = 0x1000CB
GLYPH = 'cybexos'
UNITS_PER_EM = 1000
# Square, as Nerd Font icons are: a terminal that fits a private-use glyph to
# its cells keeps the mark's proportions. Its longer side spans the em less a
# small margin.
ADVANCE = 1000
MARGIN = 40
# JetBrains Mono's line (hhea and OS/2 alike): 1020 above the baseline, 300
# below, in cells 600 wide.
ASCENT, DESCENT = 1020, -300
CELL = 600
# Where the mark's centre goes: the end of the icon's own cell, half-way
# across the two cells, and the middle of the line, as for Nerd Font icons
# (NixOS's spans -74 to 794, Fedora's -140 to 860: both centred on 360).
CENTRE_X = CELL
CENTRE_Y = (ASCENT + DESCENT) / 2


def mark_paths(svg):
    """The SVG's path data."""
    root = ET.parse(svg).getroot()
    paths = [element.get('d') for element in root.iter()
             if element.tag.rsplit('}', 1)[-1] == 'path' and element.get('d')]
    if not paths:
        raise SystemExit(f'{svg}: expected at least one path')
    return paths


def glyph(svg):
    paths = mark_paths(svg)
    outline = RecordingPen()
    for data in paths:
        parse_path(data, outline)
    bounds = BoundsPen(None)
    outline.replay(bounds)
    left, top, right, bottom = bounds.bounds
    width, height = right - left, bottom - top
    size = UNITS_PER_EM - 2 * MARGIN
    scale = size / max(width, height)
    # SVG y grows downwards, a font's upwards: flip, and centre the mark's
    # own outline (not its padded viewBox) on CENTRE_X and CENTRE_Y.
    dx = CENTRE_X - (left + right) / 2 * scale
    dy = CENTRE_Y + (top + bottom) / 2 * scale
    pen = TTGlyphPen(None)
    # TrueType outlines are quadratic and run clockwise; flipping y reversed
    # the SVG's direction, so it is reversed back.
    outline.replay(TransformPen(Cu2QuPen(pen, max_err=1.0, reverse_direction=True),
                                (scale, 0, 0, -scale, dx, dy)))
    return pen.glyph()


def build(svg, output):
    builder = FontBuilder(UNITS_PER_EM, isTTF=True)
    builder.setupGlyphOrder(['.notdef', GLYPH])
    builder.setupCharacterMap({CODEPOINT: GLYPH})
    builder.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), GLYPH: glyph(svg)})
    table = builder.font['glyf']
    mark = table[GLYPH]
    mark.recalcBounds(table)
    builder.setupHorizontalMetrics({'.notdef': (ADVANCE, 0), GLYPH: (ADVANCE, mark.xMin)})
    builder.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    builder.setupNameTable({'familyName': FAMILY, 'styleName': 'Regular',
                            'uniqueFontIdentifier': FAMILY + ' Regular',
                            'fullName': FAMILY, 'psName': 'CybexOSSymbols-Regular',
                            'version': 'Version 1.000'})
    builder.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, sTypoLineGap=0,
                     usWinAscent=ASCENT, usWinDescent=-DESCENT, achVendID='CYBX',
                     fsType=0)
    builder.setupPost()
    builder.save(output)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    build(sys.argv[1], sys.argv[2])
