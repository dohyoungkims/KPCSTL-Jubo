"""Prepare corrected artwork and metrics while preserving bundled full fonts.

Run with PyMuPDF and fontTools. Existing reference.pdf remains unchanged.
NanumSquare files and their license are checked in; never replace them with the
limited font subsets extracted from reference.pdf. See FONT-NOTICE.txt.
"""
from pathlib import Path
import io, shutil, os, subprocess, sys
import fitz
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'frontend/assets/print'
OUT.mkdir(parents=True,exist_ok=True)
for name in ('regular.ttf','bold.ttf','extra.ttf','NanumSquare-LICENSE.txt','FONT-NOTICE.txt'):
    if not (OUT/name).is_file():
        raise FileNotFoundError(f'Restore the bundled licensed font asset before regeneration: {OUT/name}')

# Preserve the source worksheet subset and the bundled modern-Hangul fallback.
if not (OUT/'worksheet.ttf').is_file():
    with fitz.open(ROOT/'frontend/assets/reference.pdf') as doc:
        (OUT/'worksheet.ttf').write_bytes(doc.extract_font(87)[3])
if not (OUT/'fallback.ttf').is_file():
    fallback=TTFont(io.BytesIO(fitz.Font('cjk').buffer))
    opts=subset.Options();opts.name_IDs=['*'];opts.name_legacy=True
    s=subset.Subsetter(options=opts)
    s.populate(unicodes=list(range(32,0x0250))+list(range(0x1100,0x1200))+list(range(0x2000,0x2800))+list(range(0x3000,0x3200))+list(range(0xAC00,0xD7B0))+list(range(0xFF00,0xFFEF)))
    s.subset(fallback);fallback.save(OUT/'fallback.ttf')

subprocess.run([sys.executable,str(ROOT/'scripts/update-font-metrics.py')],check=True)
# This entry point keeps fixed wording and applies the reviewed staff alignment.
subprocess.run([sys.executable,str(ROOT/'scripts/prepare-fixed-template.py')],check=True)

runtime=Path(os.environ['CODEX_PRIMARY_RUNTIME_NODE_MODULES'])
vendor=ROOT/'frontend/vendor';vendor.mkdir(exist_ok=True)
for a,b in [('pdf-lib/dist/pdf-lib.min.js','pdf-lib.min.js'),('pdf-lib/LICENSE.md','pdf-lib-LICENSE.md'),('pdfjs-dist/build/pdf.min.mjs','pdf.min.mjs'),('pdfjs-dist/build/pdf.worker.min.mjs','pdf.worker.min.mjs'),('pdfjs-dist/LICENSE','pdfjs-LICENSE')]:
    shutil.copy2(runtime/a,vendor/b)
print('Prepared',OUT)
