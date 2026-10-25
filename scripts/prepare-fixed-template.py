"""Retain fixed artwork and wording, repairing the source's staff alignment."""
from pathlib import Path
import argparse
import fitz
from pdf_layout import corrected_source
parser=argparse.ArgumentParser()
parser.add_argument('--proof',type=Path,help='Also save the complete source PDF with repaired layout.')
args=parser.parse_args()
ROOT=Path(__file__).resolve().parents[1]
asset=ROOT/'frontend/assets'
source=corrected_source(asset/'reference.pdf')
if args.proof:
    args.proof.parent.mkdir(parents=True,exist_ok=True)
    args.proof.write_bytes(source)
doc=fitz.open(stream=source,filetype='pdf')
keep={0:[fitz.Rect(49,568,299,751),fitz.Rect(309,158,560,180),fitz.Rect(309,200,338,259),fitz.Rect(309,649,560,668),fitz.Rect(309,667,365,742)],1:[fitz.Rect(419,36,572,628)]}
for n,page in enumerate(doc):
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines',[]):
            for span in line['spans']:
                box=fitz.Rect(span['bbox']);center=(box.tl+box.br)/2
                if not any(center in area for area in keep.get(n,[])):
                    page.add_redact_annot(box,fill=False)
    page.apply_redactions(images=0,graphics=0,text=0)
doc.set_metadata({})
doc.save(asset/'print/template.pdf',garbage=4,deflate=True)
original=fitz.open(stream=source,filetype='pdf')
for name,n,box in [('fixed-regular',0,(49,568,299,751)),('fixed-staff',1,(419,36,572,628))]:
    original[n].get_pixmap(matrix=fitz.Matrix(2,2),clip=fitz.Rect(box)).save(asset/(name+'.png'))
print('Fixed wording and table labels retained; staff text aligned inside its frame.')
