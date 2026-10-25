const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const B=require('../frontend/core.js');
const P=require('../frontend/print.js');
const PDFLib=require('../frontend/vendor/pdf-lib.min.js');
const load=p=>fs.readFile(path.join(__dirname,'../frontend',p));
const generate=i=>P.generate(i,{PDFLib,load});

test('edited Korean content produces a four-page Letter PDF without mutating the issue',async()=>{
  let i=B.createStore().issues[0];i=B.update(i,'sermon.title','은혜와 사랑으로 살아가는 믿음');
  i=B.update(i,'worship.prayer2','김믿음 장로');i=B.update(i,'announcements.0.body','이번 주 토요일 오후 3시에 만납니다.');
  const before=JSON.stringify(i),r=await generate(i),doc=await PDFLib.PDFDocument.load(r.bytes);
  assert.equal(JSON.stringify(i),before);assert.equal(r.exportable,true);assert.equal(doc.getPageCount(),4);
  assert.ok(doc.getPages().every(p=>p.getWidth()===612&&p.getHeight()===792));
  assert.equal(doc.getTitle(),`KPCSTL ${i.date} v${i.revision}`);
  assert.equal(r.filename,`KPCSTL-${i.date}-v${i.revision}.pdf`);
});
test('oversized worship fields block export and identify the editor section',async()=>{
  const i=B.update(B.createStore().issues[0],'worship.prayer2','아주 긴 기도 담당자 이름 '.repeat(35));
  const r=await generate(i);assert.equal(r.exportable,false);
  assert.ok(r.warnings.some(w=>w.blocking&&w.id==='prayer2'&&w.section==='sermon'));
});
test('announcement overflow is detected even after moving to the second column',async()=>{
  const i=B.update(B.createStore().issues[0],'announcements.0.body','전체 공지 내용입니다. '.repeat(500));
  const r=await generate(i);assert.equal(r.exportable,false);
  assert.ok(r.warnings.some(w=>w.blocking&&w.id==='announcements'));
});
test('question overflow and unsupported characters block export instead of silently dropping text',async()=>{
  let i=B.update(B.createStore().issues[0],'questions.0.body','말씀 나눔 질문 '.repeat(800));
  i=B.update(i,'sections.events','행사 안내 🦕');
  const r=await generate(i);assert.equal(r.exportable,false);
  assert.ok(r.warnings.some(w=>w.blocking&&w.id==='questions'));
  assert.ok(r.warnings.some(w=>w.blocking&&w.id==='events'&&w.message.includes('🦕')));
});
test('new week export preserves the old week and uses the new date and revision',async()=>{
  const initial=B.createStore(),copy=B.duplicate(initial,initial.current,'2026-10-11');
  const r=await generate(copy.issues[1]);assert.equal(r.exportable,true);
  assert.equal(r.filename,'KPCSTL-2026-10-11-v1.pdf');
  assert.equal(initial.issues.length,1);assert.equal(copy.issues[0].date,'2026-10-04');
  assert.ok(r.warnings.every(w=>!w.blocking));
});

const assertInside=(item)=>{
  const b=item.bounds,r=item.region,tolerance=.001;
  assert.ok(b.left>=r.left-tolerance&&b.right<=r.right+tolerance&&b.top>=r.top-tolerance&&b.bottom<=r.bottom+tolerance,
    `${item.id} on page ${item.page} escapes its text area: ${JSON.stringify({text:item.text,bounds:b,region:r})}`);
};

test('every default text line stays within its padded print region on all four pages',async()=>{
  const r=await generate(B.createStore().issues[0]);
  assert.equal(r.exportable,true);
  assert.deepEqual([...new Set(r.layout.map(line=>line.page))].sort(),[1,2,3,4]);
  assert.ok(r.layout.length>70);
  r.layout.forEach(assertInside);
});

test('wide glyph ink and an unbroken contact string wrap without losing content',async()=>{
  const body='⁄'.repeat(141)+'\n'+'contact@'+'w'.repeat(60)+'.org';
  const i=B.update(B.createStore().issues[0],'announcements.0.body',body),r=await generate(i);
  assert.equal(r.exportable,true);
  const lines=r.layout.filter(l=>l.id==='announcements');
  const firstTitle=lines.findIndex(l=>l.font==='bold'&&l.text.startsWith('1. '));
  const nextTitle=lines.findIndex((l,n)=>n>firstTitle&&l.font==='bold'&&l.text.startsWith('2. '));
  const bodyLines=lines.slice(firstTitle+1,nextTitle).filter(l=>l.font==='regular');
  assert.equal(bodyLines.map(l=>l.text).join(''),body.replaceAll('\n',''));
  assert.ok(bodyLines.length>=4);
  r.layout.forEach(assertInside);
});

test('word-wrap rechecks a wide remainder after a zero-advance prefix',async()=>{
  const body='‾'.repeat(30)+' '+'W'.repeat(18)+'끝';
  const i=B.update(B.createStore().issues[0],'announcements.0.body',body),r=await generate(i);
  assert.equal(r.exportable,true);
  const lines=r.layout.filter(l=>l.id==='announcements'&&l.font==='regular');
  assert.equal(lines.slice(0,3).map(l=>l.text).join(''),body.replace(' ',''));
  r.layout.forEach(assertInside);
});

test('the actual PDF draw baseline keeps tall fallback glyphs within the heading',async()=>{
  const draws=[];
  const recordingLib={...PDFLib,PDFDocument:{load:async bytes=>{
    const doc=await PDFLib.PDFDocument.load(bytes);
    doc.getPages().forEach((page,index)=>{
      const draw=page.drawText.bind(page);
      page.drawText=(text,options)=>{draws.push({page:index+1,text,...options});return draw(text,options);};
    });
    return doc;
  }}};
  const i=B.update(B.createStore().issues[0],'sermon.title','Ĵ\nĴ');
  const r=await P.generate(i,{PDFLib:recordingLib,load});
  assert.equal(r.exportable,true);
  const draw=draws.find(d=>d.page===3&&d.text==='Ĵ');
  assert.ok(draw);
  // Ĵ in the embedded fallback font has yMax=238 at 256 units/em.
  // The old constant 0.86-em baseline put this ink above the 76pt inner top.
  assert.ok(792-draw.y-238/256*draw.size>=76-.001);
  r.layout.forEach(assertInside);
});
