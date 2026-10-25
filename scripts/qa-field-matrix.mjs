import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import B from '../frontend/core.js';
import P from '../frontend/print.js';
import PDFLib from '../frontend/vendor/pdf-lib.min.js';

// The fixture covers the editor's 56 editable bulletin fields. IDs and fixed
// church-reference text are intentionally excluded: the editor cannot edit them.
export function fieldFixture() {
  let issue = B.createStore().issues[0];
  const fields = [];
  const add = (path, value, pages, expected = value) => {
    issue = B.update(issue, path, value);
    fields.push({path, value, pages, expected});
  };
  add('sermon.title', '은혜 S01', [1, 3]);
  add('sermon.scripture', '요한복음 S02', [1, 3]);
  add('sermon.preacher', '목사 S03', [1]);
  Object.keys(issue.worship).forEach((key, index) => add(`worship.${key}`, `예배 W${String(index + 1).padStart(2, '0')}`, [1]));
  Object.keys(issue.roster).forEach((key, index) => add(`roster.${key}`, `봉사 R${String(index + 1).padStart(2, '0')}`, [1]));
  Object.keys(issue.midweek).forEach((key, index) => add(`midweek.${key}`, `말씀 M${String(index + 1).padStart(2, '0')}`, [1]));
  add('sections.meals', '애찬 C01', [1]);
  add('sections.pastoral', '목회 C02\n일정 Schedule C02', [1]);
  add('sections.events', '행사 C03\n문의 contact@example.org', [1]);
  add('sections.prayers', '기도 C04\n건강과 회복 Peace C04', [2]);
  issue.announcements.forEach((_, index) => {
    const id = String(index + 1).padStart(2, '0');
    add(`announcements.${index}.title`, `소식 A${id}T`, [2]);
    add(`announcements.${index}.body`, `안내 A${id}B\n은혜와 평안. Welcome A${id}B.`, [2]);
  });
  issue.questions.forEach((_, index) => {
    const marker = `Q${String(index + 1).padStart(2, '0')}B`;
    const number = String(index ? 6 : 2), body = `말씀 ${marker}: 은혜를 나눕니다. Share grace.`;
    add(`questions.${index}.number`, number, [index + 3], `${number}. ${body}`);
    add(`questions.${index}.body`, body, [index + 3]);
  });
  Object.keys(issue.offering).forEach((key, index) => {
    const value = ((index + 1) * 101.11).toFixed(2);
    add(`offering.${key}`, value, [2], `$${value}`);
  });
  assert.equal(fields.length, 56);
  assert.equal(new Set(fields.map(field => field.path)).size, fields.length);
  return {issue, fields, total: '$2,831.08'};
}

const cache = new Map();
export function loadPrintAsset(path) {
  if (!cache.has(path)) cache.set(path, readFile(new URL('../frontend/' + path, import.meta.url)));
  return cache.get(path);
}
export const generate = issue => P.generate(issue, {PDFLib, load: loadPrintAsset});

// Decode the saved PDF's text operators, using its embedded ToUnicode maps.
// This checks the persisted PDF bytes independently of the layout diagnostics.
// It covers the renderer's embedded Type0 fonts and Tj text operators; fixed
// background artwork is audited separately against the supplied PDF.
export async function extractAuthoredText(bytes) {
  const doc = await PDFLib.PDFDocument.load(bytes);
  const N = PDFLib.PDFName.of;
  const decode = stream => new TextDecoder().decode(PDFLib.decodePDFRawStream(stream).decode());
  const unicode = hex => {
    let output = '';
    for (let offset = 0; offset < hex.length; offset += 4) output += String.fromCharCode(parseInt(hex.slice(offset, offset + 4), 16));
    return output;
  };
  return doc.getPages().map(page => {
    const fonts = page.node.Resources().lookup(N('Font'), PDFLib.PDFDict), maps = new Map();
    for (const [name, ref] of fonts.entries()) {
      const font = doc.context.lookup(ref), mapping = font.lookupMaybe(N('ToUnicode'), PDFLib.PDFRawStream);
      if (!mapping) continue;
      const map = new Map(), cmap = decode(mapping);
      for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const match of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(parseInt(match[1], 16), unicode(match[2]));
      }
      maps.set(name.toString(), map);
    }
    const contents = page.node.Contents(), streams = contents instanceof PDFLib.PDFArray ? contents.asArray() : [contents];
    const output = [];
    for (const reference of streams) {
      const stream = doc.context.lookup(reference);
      if (!(stream instanceof PDFLib.PDFRawStream)) continue;
      const source = decode(stream);
      let font;
      for (const match of source.matchAll(/(\/[^\s/]+)\s+[\d.]+\s+Tf|<([0-9a-f]*)>\s*Tj/gi)) {
        if (match[1]) font = maps.get(match[1]);
        else if (font) {
          const codes = match[2].match(/.{1,4}/g) || [];
          output.push(codes.map(code => font.get(parseInt(code, 16)) ?? '\uFFFD').join(''));
        }
      }
    }
    return output.join('\n');
  });
}

const compact = value => value.normalize('NFC').replace(/\s+/g, '');
export function verifyFieldText(pages, fields, total) {
  const results = fields.map(field => ({...field, found: field.pages.every(page => compact(pages[page - 1]).includes(compact(field.expected)))}));
  assert.ok(results.every(result => result.found), 'PDF is missing fields: ' + results.filter(result => !result.found).map(result => result.path).join(', '));
  assert.ok(compact(pages[1]).includes(compact(total)), 'PDF offering total is missing or incorrect');
  assert.ok(pages.every(page => !page.includes('\uFFFD')), 'PDF contains an unmapped glyph');
  return results;
}

export function verifyLayout(layout) {
  assert.ok(Array.isArray(layout) && layout.length > 0, 'Renderer must return measured line bounds');
  for (const entry of layout) {
    const {bounds: b, region: r} = entry, tolerance = 0.01;
    assert.ok(b.left >= r.left - tolerance && b.right <= r.right + tolerance && b.top >= r.top - tolerance && b.bottom <= r.bottom + tolerance,
      `${entry.id} on page ${entry.page} escapes its region: ${JSON.stringify(entry)}`);
    assert.ok(b.left >= -tolerance && b.top >= -tolerance && b.right <= 612 + tolerance && b.bottom <= 792 + tolerance,
      `${entry.id} escapes the Letter page`);
  }
}

async function main() {
  const directory = resolve(process.argv[2] || fileURLToPath(new URL('../work/layout-qa/', import.meta.url)));
  await mkdir(directory, {recursive: true});
  const fixture = fieldFixture(), result = await generate(fixture.issue);
  assert.equal(result.exportable, true, JSON.stringify(result.warnings));
  const pdfPath = resolve(directory, 'all-fields.pdf');
  await writeFile(pdfPath, result.bytes);
  const pages = await extractAuthoredText(result.bytes);
  const fields = verifyFieldText(pages, fixture.fields, fixture.total);
  verifyLayout(result.layout);
  await writeFile(resolve(directory, 'all-fields-issue.json'), JSON.stringify(fixture.issue, null, 2));
  const report = {fieldCount: fields.length, exportable: result.exportable, pages: pages.length, fields, total: fixture.total, warnings: result.warnings, layout: result.layout, extractedText: pages};
  await writeFile(resolve(directory, 'all-fields-report.json'), JSON.stringify(report, null, 2));
  // A second independent extraction by MuPDF checks the complete saved document
  // when PyMuPDF is available in the workstation's Python environment.
  const independent = spawnSync('python3', ['-c', 'import fitz,json,sys; d=fitz.open(sys.argv[1]); print(json.dumps([p.get_text() for p in d],ensure_ascii=False))', pdfPath], {encoding: 'utf8'});
  if (independent.status === 0) {
    const extracted = JSON.parse(independent.stdout);
    verifyFieldText(extracted, fixture.fields, fixture.total);
    await writeFile(resolve(directory, 'all-fields-mupdf-text.json'), JSON.stringify(extracted, null, 2));
    report.independentMuPDFExtraction = 'passed';
  } else report.independentMuPDFExtraction = 'unavailable: ' + independent.stderr.trim();
  await writeFile(resolve(directory, 'all-fields-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({pdf: pdfPath, fields: fields.length, exportable: result.exportable, measuredLines: result.layout.length, independentMuPDFExtraction: report.independentMuPDFExtraction}, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
