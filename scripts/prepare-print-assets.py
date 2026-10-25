"""Prepare fixed artwork and licensed/embedded font metrics from the supplied PDF.

Run with PyMuPDF and fontTools. Existing reference.pdf remains unchanged.
"""
from pathlib import Path
import json, io, shutil, os
import fitz
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'frontend/assets/print'
OUT.mkdir(parents=True,exist_ok=True)
doc=fitz.open(ROOT/'frontend/assets/reference.pdf')
fonts=[]
for ident,xref in [('regular',17),('bold',10),('extra',34),('worksheet',87)]:
    name,ext,kind,data=doc.extract_font(xref)
    (OUT/f'{ident}.ttf').write_bytes(data)
    fonts.append((ident,TTFont(io.BytesIO(data))))

# Full modern Hangul fallback for characters absent from the PDF's font subsets.
fallback=TTFont(io.BytesIO(fitz.Font('cjk').buffer))
opts=subset.Options();opts.name_IDs=['*'];opts.name_legacy=True
s=subset.Subsetter(options=opts)
s.populate(unicodes=list(range(32,0x0250))+list(range(0x1100,0x1200))+list(range(0x2000,0x2800))+list(range(0x3000,0x3200))+list(range(0xAC00,0xD7B0))+list(range(0xFF00,0xFFEF)))
s.subset(fallback);fallback.save(OUT/'fallback.ttf');fonts.append(('fallback',fallback))
metadata={}
for ident,f in fonts:
    cp={str(c):f.getGlyphID(g) for c,g in f.getBestCmap().items() if c>=32 and f.getGlyphID(g)>0}
    names=f.getGlyphOrder();widths=[f['hmtx'].metrics[g][0] for g in names]
    h=f['head'];hh=f['hhea'];units=h.unitsPerEm
    metadata[ident]={'id':ident,'url':f'assets/print/{ident}.ttf','unitsPerEm':units,'ascent':hh.ascent,'descent':hh.descent,'capHeight':getattr(f['OS/2'],'sCapHeight',hh.ascent),'bbox':{'minX':h.xMin,'minY':h.yMin,'maxX':h.xMax,'maxY':h.yMax},'cmap':cp,'widths':widths}
    print(ident,len(cp),'characters')
(OUT/'font-metrics.json').write_text(json.dumps(metadata,separators=(',',':')))

# Remove text operators only. Preserve raster artwork and vector rules/fills.
for page in doc:
    page.add_redact_annot(page.rect,fill=False)
    page.apply_redactions(images=0,graphics=0,text=0)
assert all(not p.get_text().strip() for p in doc)
doc.set_metadata({})
doc.save(OUT/'template.pdf',garbage=4,deflate=True)

runtime=Path(os.environ['CODEX_PRIMARY_RUNTIME_NODE_MODULES'])
vendor=ROOT/'frontend/vendor';vendor.mkdir(exist_ok=True)
for a,b in [('pdf-lib/dist/pdf-lib.min.js','pdf-lib.min.js'),('pdf-lib/LICENSE.md','pdf-lib-LICENSE.md'),('pdfjs-dist/build/pdf.min.mjs','pdf.min.mjs'),('pdfjs-dist/build/pdf.worker.min.mjs','pdf.worker.min.mjs'),('pdfjs-dist/LICENSE','pdfjs-LICENSE')]:
    shutil.copy2(runtime/a,vendor/b)
(OUT/'FONT-NOTICE.txt').write_text('NanumSquare and KoPub font subsets are retained from the church-supplied source PDF for faithful document reproduction. They are not complete font distributions. Additional Hangul glyphs use the Droid Sans Fallback font distributed with PyMuPDF, under the Apache License 2.0. See https://www.apache.org/licenses/LICENSE-2.0 . Full original licensed fonts are still needed for exact matching of arbitrary new Korean text.\n')
print('Prepared',OUT)
