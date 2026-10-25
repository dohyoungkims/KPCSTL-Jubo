"""Repair known source geometry without retyping or rasterizing any text."""
from io import BytesIO
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, FloatObject


def corrected_source(path):
    reader = PdfReader(path)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    page = writer.pages[1]
    contents = ContentStream(page.get_contents(), writer)
    shifted = 0
    # The Youth Group entry is 8.4 pt left of every other staff entry.
    # Move all text runs in its three baselines, preserving the original
    # fonts, glyphs, tracking, colors, and surrounding vector artwork.
    baselines = (469.27, 458.35, 445.99)
    for operands, operator in contents.operations:
        if operator != b'Tm' or len(operands) != 6:
            continue
        x, y = float(operands[4]), float(operands[5])
        if 419 <= x <= 550 and any(abs(y - baseline) < .01 for baseline in baselines):
            operands[4] = FloatObject(x + 8.4)
            shifted += 1
    if shifted != 17:
        raise ValueError(f'Expected 17 staff text runs, found {shifted}; review the source before repairing.')
    page.replace_contents(contents)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()
