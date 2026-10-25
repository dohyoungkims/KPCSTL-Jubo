import test from 'node:test';
import assert from 'node:assert/strict';
import B from '../frontend/core.js';
import * as domain from '../lib/team-domain.mjs';
import {createPagesStore} from '../frontend/pages-store.mjs';
import {fieldFixture, generate, extractAuthoredText, verifyFieldText, verifyLayout} from '../scripts/qa-field-matrix.mjs';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}
const KEY = 'field-matrix-pages-workspace';
const NOW = '2026-10-25T02:00:00.000Z';
const createAPI = storage => createPagesStore({storage, B, domain, key: KEY, now: () => NOW});
const command = (op, issue, args = {}) => ({op, commandId: crypto.randomUUID(), issueId: issue?.id, baseVersion: issue?.version, ...args});
async function setup() {
  const storage = new MemoryStorage(), api = createAPI(storage);
  await api.call({op: 'profile', name: '필드 검토자'});
  const {issue} = await api.call(command('import', null, {issue: B.createStore().issues[0]}));
  return {storage, api, issue};
}

test('all 56 editable fields persist through Pages storage and populate the saved four-page PDF', async () => {
  const fixture = fieldFixture(), {storage, api, issue} = await setup();
  const changes = Object.fromEntries(fixture.fields.map(field => [field.path, field.value]));
  const saved = (await api.call(command('fields', issue, {changes}))).issue;
  const reloaded = (await createAPI(storage).call()).issues[0];
  for (const {path, value} of fixture.fields) {
    assert.equal(B.getPath(reloaded, path), value, `${path} was not saved`);
    assert.ok(reloaded.history.some(entry => entry.path === path && entry.after === value && entry.actorName === '필드 검토자'), `${path} has no attributed audit record`);
  }
  assert.equal(reloaded.version, saved.version);
  assert.equal(reloaded.history.length, 56);
  const before = JSON.stringify(reloaded), pdf = await generate(reloaded);
  assert.equal(JSON.stringify(reloaded), before, 'PDF generation must not mutate saved content');
  assert.equal(pdf.exportable, true, JSON.stringify(pdf.warnings));
  const pages = await extractAuthoredText(pdf.bytes);
  assert.equal(pages.length, 4);
  verifyFieldText(pages, fixture.fields, fixture.total);
  verifyLayout(pdf.layout);
});

test('oversized table cells and weekly text are individually blocked with their editor section', async () => {
  // Each case changes only one field, proving warnings are attributed correctly
  // rather than a different overflowing field masking a missing check.
  const cases = [
    ['roster.date1', 'roster-date1', 'volunteers'],
    ['roster.usher22', 'roster-usher22', 'volunteers'],
    ['midweek.fridayText', 'midweek-fridayText', 'schedule'],
    ['midweek.saturdayLeader', 'midweek-saturdayLeader', 'schedule'],
    ['sections.meals', 'meals', 'volunteers'],
    ['sections.pastoral', 'pastoral', 'schedule'],
    ['sections.events', 'events', 'schedule'],
    ['sections.prayers', 'prayers', 'prayers'],
    ['sermon.preacher', 'sermon', 'sermon'],
    ['announcements.0.title', 'announcements', 'announcements'],
    ['questions.0.number', 'questions', 'questions']
  ];
  for (const [path, id, section] of cases) {
    const issue = B.update(B.createStore().issues[0], path, '경계 검토 Boundary '.repeat(180));
    const pdf = await generate(issue);
    assert.equal(pdf.exportable, false, path);
    assert.ok(pdf.warnings.some(warning => warning.blocking && warning.id === id && warning.section === section), path);
    verifyLayout(pdf.layout);
  }
});

test('less common Korean syllables have visible ink and decomposed Hangul normalizes before printing', async () => {
  // A font can advertise a code point in its cmap while the actual outline is
  // blank. Isolating each syllable makes a missing outline observable in bounds.
  const input = ['똠', '뷁', '쀍', '뛟', '\u1100\u1161', '가'];
  const expected = input.map(value => value.normalize('NFC'));
  const pdf = await generate(B.update(B.createStore().issues[0], 'sections.prayers', input.join('\n')));
  assert.equal(pdf.exportable, true, JSON.stringify(pdf.warnings));
  const lines = pdf.layout.filter(line => line.id === 'prayers');
  assert.deepEqual(lines.map(line => line.text), expected);
  for (const line of lines) {
    assert.ok(line.bounds.right - line.bounds.left > 2, `${line.text} has no visible width`);
    assert.ok(line.bounds.bottom - line.bounds.top > 2, `${line.text} has no visible height`);
  }
  const pages = await extractAuthoredText(pdf.bytes);
  verifyFieldText(pages, [{path: 'sections.prayers', pages: [2], expected: expected.join('\n')}], '$0.00');
  verifyLayout(pdf.layout);
});

test('maximum valid currency inputs stay in their cells or safely block export, retaining exact totals', async () => {
  let issue = B.createStore().issues[0];
  for (const key of Object.keys(issue.offering)) issue = B.update(issue, `offering.${key}`, '99999999.99');
  assert.equal(B.totalCents(issue.offering), 69999999993);
  const pdf = await generate(issue);
  verifyLayout(pdf.layout);
  if (pdf.exportable) assert.ok((await extractAuthoredText(pdf.bytes))[1].replace(/\s/g, '').includes('$699,999,999.93'));
  else assert.ok(pdf.warnings.some(warning => warning.blocking && warning.id.startsWith('offering-')));
});

test('both editable lists support add, move, delete, undo and persistence through the Pages API', async () => {
  let {storage, api, issue} = await setup();
  for (const list of ['announcements', 'questions']) {
    const original = B.clone(issue[list]);
    issue = (await api.call(command('list', issue, {list, action: 'add'}))).issue;
    const index = issue[list].length - 1, addedId = issue[list][index].id;
    issue = (await api.call(command('fields', issue, {changes: {[`${list}.${index}.body`]: '추가한 내용 Added content'}}))).issue;
    issue = (await api.call(command('list', issue, {list, action: 'up', index}))).issue;
    assert.equal(issue[list][index - 1].id, addedId);
    assert.equal(issue[list][index - 1].body, '추가한 내용 Added content');
    issue = (await api.call(command('list', issue, {list, action: 'down', index: index - 1}))).issue;
    assert.equal(issue[list][index].id, addedId);
    const beforeDelete = B.clone(issue[list]);
    issue = (await api.call(command('list', issue, {list, action: 'delete', index}))).issue;
    assert.deepEqual(issue[list], original);
    issue = (await api.call(command('undo', issue))).issue;
    assert.deepEqual(issue[list], beforeDelete);
    assert.deepEqual((await createAPI(storage).call()).issues[0][list], beforeDelete);
  }
});

test('resolved requests permit finalization, reopening blocks it, and comments survive backup and reload', async () => {
  let {storage, api, issue} = await setup();
  issue = (await api.call(command('comment', issue, {body: '검토 메모 Review note'}))).issue;
  issue = (await api.call(command('request', issue, {body: '본문 확인 Verify text', section: 'sermon'}))).issue;
  const requestId = issue.requests[0].id;
  for (const section of Object.keys(domain.areas)) issue = (await api.call(command('task', issue, {section, status: 'done'}))).issue;
  await assert.rejects(api.call(command('finalize', issue)), /변경 요청/);
  issue = (await api.call(command('resolve', issue, {requestId}))).issue;
  assert.equal(issue.requests[0].resolved, true);
  assert.equal(issue.requests[0].resolvedBy.name, '필드 검토자');
  issue = (await api.call(command('resolve', issue, {requestId}))).issue;
  assert.equal(issue.requests[0].resolved, false);
  await assert.rejects(api.call(command('finalize', issue)), /변경 요청/);
  issue = (await api.call(command('resolve', issue, {requestId}))).issue;
  issue = (await api.call(command('finalize', issue))).issue;
  const backup = JSON.parse(JSON.stringify(await api.getBackup()));
  assert.equal(backup.versions[issue.id][issue.version].status, 'finalized');
  const reloaded = (await createAPI(storage).call()).issues[0];
  assert.equal(reloaded.comments[0].body, '검토 메모 Review note');
  assert.equal(reloaded.comments[0].actorName, '필드 검토자');
  assert.equal(reloaded.requests[0].resolved, true);
  assert.deepEqual(reloaded, issue);
});
