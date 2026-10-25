import test from 'node:test';
import assert from 'node:assert/strict';
import B from '../frontend/core.js';
import {readLocalIssues,planMigration} from '../frontend/cloud-migration.mjs';
const directory = new URL('https://dohyoungkims.github.io/KPCSTL-Jubo/');
const storage = values => ({getItem:key=>values[key]??null,setItem:()=>{throw Error('Reader must never write');}});

test('migration reads actual Pages drafts before legacy examples without modifying either',()=>{
  const legacy=B.createStore(), pages=B.clone(legacy.issues[0]);
  pages.sermon.title='이 기기의 최신 설교';
  const input=storage({'kpcstl.bulletin.study.v1':JSON.stringify(legacy),'kpcstl.github-pages.v1:/KPCSTL-Jubo/':JSON.stringify({schemaVersion:1,issues:[pages]})});
  const result=readLocalIssues({storage:input,B,directory});
  assert.equal(result.issues.length,1);
  assert.equal(result.issues[0].sermon.title,pages.sermon.title);
  assert.deepEqual(result.errors,[]);
});

test('migration never replaces a shared bulletin with a same-date browser draft',()=>{
  const local=B.createStore().issues;
  assert.deepEqual(planMigration(local,[{id:local[0].id}]),{available:[],conflicts:local});
  assert.deepEqual(planMigration(local,[]),{available:local,conflicts:[]});
});

test('fresh browser does not invent sample drafts and malformed data is reported, not erased',()=>{
  assert.deepEqual(readLocalIssues({storage:storage({}),B,directory}).issues,[]);
  const result=readLocalIssues({storage:storage({'kpcstl.github-pages.v1:/KPCSTL-Jubo/':'invalid'}),B,directory});
  assert.deepEqual(result.issues,[]);
  assert.equal(result.errors.length,1);
});

test('migration workspace is scoped to this project path and returns isolated copies',()=>{
  const original=B.createStore();
  const input=storage({'kpcstl.github-pages.v1:/different/':JSON.stringify(original),'kpcstl.bulletin.study.v1':JSON.stringify(original)});
  const result=readLocalIssues({storage:input,B,directory});
  result.issues[0].sermon.title='changed';
  assert.notEqual(readLocalIssues({storage:input,B,directory}).issues[0].sermon.title,'changed');
});
