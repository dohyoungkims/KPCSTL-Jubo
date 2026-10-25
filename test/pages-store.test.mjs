import test from 'node:test';
import assert from 'node:assert/strict';
import B from '../frontend/core.js';
import * as domain from '../lib/team-domain.mjs';
import {createPagesStore} from '../frontend/pages-store.mjs';

const KEY = 'test.github-pages:/KPCSTL-Jubo/';
const NOW = '2026-10-25T01:00:00.000Z';
class MemoryStorage {
  values = new Map();
  writes = 0;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.failWrite) throw Error('Quota exceeded');
    this.writes++;
    this.values.set(key, value);
  }
}
class SerialLocks {
  queue = Promise.resolve();
  names = [];
  request(name, options, callback) {
    assert.equal(options.mode, 'exclusive');
    this.names.push(name);
    const next = this.queue.then(callback);
    this.queue = next.catch(() => {});
    return next;
  }
}
const adapter = (storage, options = {}) => createPagesStore({storage, B, domain, key: KEY, now: () => NOW, ...options});
const command = (op, issue, args = {}) => ({op, commandId: crypto.randomUUID(), issueId: issue?.id, baseVersion: issue?.version, ...args});
async function setup(options = {}) {
  const storage = options.storage || new MemoryStorage();
  const api = adapter(storage, options);
  await api.call({op: 'profile', name: '김도영'});
  const {issue} = await api.call(command('import', null, {issue: B.createStore().issues[0]}));
  return {storage, api, issue};
}

test('Pages reload preserves stable local profile, content and complete audit history', async () => {
  const {storage, api, issue} = await setup();
  const before = await api.call();
  const {issue: changed} = await api.call(command('fields', issue, {changes: {'sermon.title': '저장한 설교'}}));
  const reloaded = await adapter(storage, {id: () => 'must-not-replace-id'}).call();
  assert.deepEqual(reloaded.profile, before.profile);
  assert.equal(reloaded.user.id, before.user.id);
  assert.equal(reloaded.issues[0].version, changed.version);
  assert.equal(reloaded.issues[0].sermon.title, '저장한 설교');
  assert.deepEqual(reloaded.issues[0].history, changed.history);
  assert.equal(changed.history[0].actorName, '김도영');
  assert.equal(changed.history[0].at, NOW);
});

test('Pages workspaces are separate across devices and path-specific keys', async () => {
  const {storage, api} = await setup();
  const original = await api.call();
  const device = await adapter(new MemoryStorage()).call();
  const path = await adapter(storage, {key: 'another-project'}).call();
  assert.notEqual(device.user.id, original.user.id);
  assert.notEqual(path.user.id, original.user.id);
  assert.equal(device.profile, null);
  assert.deepEqual(device.issues, []);
  assert.deepEqual(path.issues, []);
});

test('stale tabs receive current content in a 409 and preserve the first edit', async () => {
  const {storage, api, issue} = await setup();
  const secondTab = adapter(storage);
  const {issue: saved} = await api.call(command('fields', issue, {changes: {'sermon.title': '첫 저장'}}));
  await assert.rejects(secondTab.call(command('fields', issue, {changes: {'sermon.title': '충돌'}})), error => {
    assert.equal(error.status, 409);
    assert.equal(error.current.version, saved.version);
    assert.equal(error.current.sermon.title, '첫 저장');
    return true;
  });
  assert.equal((await secondTab.call()).issues[0].sermon.title, '첫 저장');
});

test('Web Locks serialize concurrent tab writers; synchronous fallback also rejects stale writes', async () => {
  for (const locks of [new SerialLocks(), undefined]) {
    const {storage, api, issue} = await setup({locks});
    const second = adapter(storage, {locks});
    const results = await Promise.allSettled([
      api.call(command('comment', issue, {body: '첫 번째'})),
      second.call(command('comment', issue, {body: '두 번째'}))
    ]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
    assert.equal(results[1].reason.status, 409);
    assert.equal((await api.call()).issues[0].comments.length, 1);
    if (locks) assert.ok(locks.names.every(name => name === 'kpcstl-pages-store:' + KEY));
  }
});

test('failed writes report failure and leave content and immutable publications unchanged', async () => {
  const {storage, api, issue} = await setup();
  const before = storage.getItem(KEY);
  storage.failWrite = true;
  await assert.rejects(api.call(command('fields', issue, {changes: {'sermon.title': '실패'}})), error => error.status === 507);
  assert.equal(storage.getItem(KEY), before);
  assert.equal((await api.call()).issues[0].version, issue.version);
  storage.failWrite = false;
  assert.equal((await api.call(command('fields', issue, {changes: {'sermon.title': '재시도'}}))).issue.sermon.title, '재시도');
});

test('a profile is not reported saved when initial browser storage is unavailable', async () => {
  const storage = new MemoryStorage();
  storage.failWrite = true;
  await assert.rejects(adapter(storage).call({op: 'profile', name: '김도영'}), error => error.status === 507);
  assert.equal(storage.getItem(KEY), null);
});

test('replayed commands do not create duplicate history or write storage again', async () => {
  const {storage, api, issue} = await setup();
  const update = command('fields', issue, {changes: {'sermon.title': '한 번만'}});
  const first = await api.call(update);
  const writes = storage.writes;
  const repeated = await adapter(storage).call(update);
  assert.deepEqual(repeated, first);
  assert.equal(repeated.issue.history.length, 1);
  assert.equal(storage.writes, writes);
});

test('final snapshots survive later edits and new weeks; autosaves do not create full snapshots', async () => {
  let {storage, api, issue} = await setup();
  issue = (await api.call(command('fields', issue, {changes: {'sermon.title': '확정 설교'}}))).issue;
  assert.deepEqual((await api.getBackup()).versions, {});
  for (const section of Object.keys(domain.areas)) issue = (await api.call(command('task', issue, {section, status: 'done'}))).issue;
  issue = (await api.call(command('finalize', issue))).issue;
  const finalized = B.clone(issue);
  issue = (await api.call(command('fields', issue, {changes: {'sermon.title': '수정 초안'}}))).issue;
  assert.equal(issue.status, 'draft');
  const next = (await api.call(command('new-week', issue, {date: '2026-10-11'}))).issue;
  assert.equal(next.sermon.title, '');
  assert.ok(Object.values(next.tasks).every(task => task.status === 'todo'));
  const reloaded = adapter(storage);
  assert.deepEqual((await reloaded.getVersion(issue.id, finalized.version)).issue, finalized);
  assert.equal((await reloaded.call()).issues.find(item => item.id === issue.id).sermon.title, '수정 초안');
  assert.deepEqual(Object.keys((await reloaded.getBackup()).versions[issue.id]), [String(finalized.version)]);
  await assert.rejects(reloaded.getVersion(issue.id, issue.version), error => error.status === 404);
});

test('finalization and its snapshot are atomic when browser quota is exceeded', async () => {
  let {storage, api, issue} = await setup();
  for (const section of Object.keys(domain.areas)) issue = (await api.call(command('task', issue, {section, status: 'done'}))).issue;
  const before = storage.getItem(KEY);
  storage.failWrite = true;
  await assert.rejects(api.call(command('finalize', issue)), error => error.status === 507);
  assert.equal(storage.getItem(KEY), before);
  assert.equal((await api.call()).issues[0].status, 'draft');
  assert.deepEqual((await api.getBackup()).versions, {});
});

test('duplicate imports and dates cannot overwrite existing issues', async () => {
  const {api, issue} = await setup();
  await assert.rejects(api.call(command('import', null, {issue: B.createStore().issues[0]})), error => error.status === 409 && error.current.id === issue.id);
  const next = (await api.call(command('new-week', issue, {date: '2026-10-11'}))).issue;
  await assert.rejects(api.call(command('new-week', issue, {date: next.date})), error => error.status === 409 && error.current.id === next.id);
  assert.equal((await api.call()).issues.length, 2);
});

test('profile updates preserve identity and previous audit attribution without touching legacy keys', async () => {
  const storage = new MemoryStorage();
  storage.setItem('kpcstl.bulletin.study.v1', 'legacy backup');
  const {api, issue} = await setup({storage});
  const previous = (await api.call()).profile;
  await api.call(command('comment', issue, {body: '이름 변경 전'}));
  await api.call({op: 'profile', name: '  새 이름  '});
  const current = await api.call();
  assert.equal(current.profile.id, previous.id);
  assert.equal(current.profile.createdAt, previous.createdAt);
  assert.equal(current.profile.name, '새 이름');
  assert.equal(current.members.length, 1);
  assert.equal(current.issues[0].comments[0].actorName, '김도영');
  assert.equal(storage.getItem('kpcstl.bulletin.study.v1'), 'legacy backup');
  await assert.rejects(api.call({op: 'profile', name: '<bad>'}), error => error.status === 400);
});

test('invalid saved JSON and damaged issue metadata are surfaced without resetting data', async () => {
  for (const raw of ['{', 'null', '', JSON.stringify({schemaVersion: 1, profile: null, issues: [], versions: {}})]) {
    const storage = new MemoryStorage();
    storage.setItem(KEY, raw);
    await assert.rejects(adapter(storage).call(), error => error.status === 422);
    assert.equal(storage.getItem(KEY), raw);
  }
  const {storage, api} = await setup();
  const state = await api.getBackup();
  delete state.issues[0].tasks;
  storage.setItem(KEY, JSON.stringify(state));
  const damaged = storage.getItem(KEY);
  await assert.rejects(adapter(storage).call({op: 'profile', name: '새 이름'}), error => error.status === 422);
  assert.equal(storage.getItem(KEY), damaged);
});

test('snapshot lookups and hostile version keys do not access object prototypes', async () => {
  const {storage, api, issue} = await setup();
  await assert.rejects(api.getVersion('__proto__', 'constructor'), error => error.status === 404);
  await assert.rejects(api.getVersion(issue.id, '__proto__'), error => error.status === 404);
  const state = await api.getBackup();
  state.versions = JSON.parse('{"__proto__":{"polluted":true}}');
  storage.setItem(KEY, JSON.stringify(state));
  await assert.rejects(adapter(storage).call(), error => error.status === 422);
  assert.equal({}.polluted, undefined);
});

test('returned documents and full backups cannot mutate saved browser state', async () => {
  const {api} = await setup();
  const result = await api.call();
  result.issues[0].sermon.title = 'outside mutation';
  const backup = await api.getBackup();
  backup.profile.name = 'outside profile';
  const saved = await api.call();
  assert.notEqual(saved.issues[0].sermon.title, 'outside mutation');
  assert.equal(saved.profile.name, '김도영');
});
