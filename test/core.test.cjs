const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../frontend/core.js');

test('new week preserves the prior issue and resets one-time fields',()=>{
 const s=B.createStore(),before=JSON.stringify(s.issues[0]);
 const n=B.duplicate(s,s.current,'2026-10-11');
 assert.equal(n.issues.length,2);assert.equal(JSON.stringify(n.issues[0]),before);
 assert.equal(s.issues.length,1);assert.equal(n.current,'2026-10-11');
 assert.equal(n.issues[1].sermon.title,'');assert.equal(n.issues[1].sections.prayers,'');
 assert.equal(B.totalCents(n.issues[1].offering),0);
});
test('duplicate service date cannot overwrite an archived week',()=>{
 const s=B.createStore();assert.throws(()=>B.duplicate(s,s.current,s.current),/이미/);
 assert.equal(s.issues.length,1);
});
test('year-boundary dates remain chronological and distinct',()=>{
 assert.equal(B.nextWeek('2026-12-27'),'2027-01-03');
 const s=B.createStore(),n=B.duplicate(s,s.current,'2026-12-27');
 const m=B.duplicate(n,n.current,'2027-01-03');assert.equal(m.issues.length,3);
 assert.equal(m.issues[1].date,'2026-12-27');
});
test('invalid dates and non-Sundays cannot create normal Sunday bulletins',()=>{
 const s=B.createStore();for(const d of ['2026-02-30','2026-10-09','x'])assert.throws(()=>B.duplicate(s,s.current,d));
});
test('saving new content invalidates review of the old revision',()=>{
 const approved=B.approve(B.createStore().issues[0]);
 const changed=B.update(approved,'sermon.title','새 설교 제목');
 assert.equal(approved.status,'reviewed');assert.equal(changed.status,'draft');
 assert.equal(changed.reviewedRevision,null);assert.equal(changed.revision,2);
 assert.equal(changed.history[0].before,approved.sermon.title);
});
test('a stale proposal cannot overwrite a newer edit',()=>{
 const i=B.update(B.createStore().issues[0],'sermon.title','New');
 assert.throws(()=>B.update(i,'sermon.title','Stale',1),/Stale/);
 assert.equal(i.sermon.title,'New');
});
test('giving totals use exact cents rather than floating point accumulation',()=>{
 assert.equal(B.totalCents({a:'0.10',b:'0.20'}),30);
 assert.equal(B.totalCents({a:'17374',b:'2732.40',c:'190',d:'111',e:'870',f:'0',g:'10'}),2128740);
 assert.throws(()=>B.totalCents({a:'1.001'}));
});
test('invalid money input does not mutate a saved issue',()=>{
 const i=B.createStore().issues[0];assert.throws(()=>B.update(i,'offering.tithe','-3'));
 assert.equal(i.offering.tithe,'0');
});
test('successive undos recover successive prior edits while preserving the audit trail',()=>{
 const i=B.createStore().issues[0];const a=B.update(i,'sermon.title','A');const b=B.update(a,'sermon.scripture','B');
 const u=B.undo(b),v=B.undo(u);assert.equal(u.sermon.scripture,i.sermon.scripture);
 assert.equal(v.sermon.title,i.sermon.title);assert.equal(v.history.length,4);
});
test('deleted announcements are recoverable without losing other items',()=>{
 const i=B.createStore().issues[0],next=B.listChange(i,'announcements','delete',1),u=B.undo(next);
 assert.equal(next.announcements.length,i.announcements.length-1);assert.deepEqual(u.announcements,i.announcements);
});
test('field updates reject prototype pollution and unsupported settings',()=>{
 const i=B.createStore().issues[0];assert.throws(()=>B.update(i,'sermon.__proto__.polluted','x'));
 assert.throws(()=>B.update(i,'status','published'));assert.equal({}.polluted,undefined);
});
test('change requests record their base revision without applying an unreviewed edit',()=>{
 const i=B.createStore().issues[0],n=B.addRequest(i,'  제목 수정 요청  ','설교');
 assert.equal(n.requests[0].body,'제목 수정 요청');assert.equal(n.requests[0].baseRevision,i.revision);
 assert.deepEqual(n.sermon,i.sermon);assert.throws(()=>B.addRequest(i,'  ','설교'));
});
test('backups retain multiple dated issues and pass the version guard',()=>{
 const s=B.duplicate(B.createStore(),'2026-10-04','2026-10-11');
 assert.equal(B.validStore(JSON.parse(JSON.stringify(s))),true);
 assert.equal(B.validStore({...s,schemaVersion:999}),false);
});
