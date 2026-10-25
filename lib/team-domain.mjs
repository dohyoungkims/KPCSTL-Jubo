import B from '../frontend/core.js';
export const areas={sermon:'설교 · 예배',announcements:'교회 소식',volunteers:'봉사 · 애찬',schedule:'모임 · 일정',prayers:'기도 · 헌금',questions:'설교 질문'};
export function sectionFor(path){const root=path.split('.')[0];if(['sermon','worship'].includes(root))return 'sermon';if(root==='roster'||path==='sections.meals')return 'volunteers';if(root==='midweek'||['sections.pastoral','sections.events'].includes(path))return 'schedule';if(root==='offering'||path==='sections.prayers')return 'prayers';return Object.hasOwn(areas,root)?root:null;}
export function actorName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>60||/[\u0000-\u001f<>]/.test(name))throw Error('표시할 이름을 1–60자로 입력해 주세요.');return name.trim();}
export function validateIssue(i){
  if(!B.validStore({schemaVersion:1,serial:0,current:i?.id,issues:[i]}))throw Error('주보 형식을 확인해 주세요.');
  const shape=B.createStore().issues[0];
  for(const group of ['sermon','worship','sections','offering','roster','midweek']){
    if(['roster','midweek'].includes(group)&&i[group]===undefined)continue;
    if(!i[group]||typeof i[group]!=='object'||Array.isArray(i[group]))throw Error('주보 항목 형식이 올바르지 않습니다.');
    for(const key of Object.keys(shape[group]))if(typeof i[group][key]!=='string'||i[group][key].length>12000)throw Error('필수 주보 항목이 없거나 너무 깁니다.');
    if(Object.keys(i[group]).some(k=>!Object.hasOwn(shape[group],k)))throw Error('알 수 없는 주보 항목입니다.');
  }
  for(const group of ['sermon','worship','sections','offering'])for(const v of Object.values(i[group]))if(typeof v!=='string'||v.length>12000)throw Error('잘못된 주보 내용입니다.');
  B.totalCents(i.offering);
  for(const group of ['announcements','questions']){if(i[group].length>100)throw Error('항목은 100개까지 입력할 수 있습니다.');const ids=new Set();for(const item of i[group]){if(!item||typeof item!=='object')throw Error('잘못된 항목입니다.');for(const key of group==='announcements'?['id','title','body']:['id','number','body'])if(typeof item[key]!=='string'||item[key].length>12000)throw Error('잘못된 항목입니다.');if(!item.id||item.id.length>100||ids.has(item.id))throw Error('중복되거나 잘못된 항목 식별자입니다.');ids.add(item.id);}}
  if(i.history.some(h=>!h||typeof h.path!=='string'||!['field','list'].includes(h.type)))throw Error('수정 기록 형식을 확인해 주세요.');
  if(i.requests.some(r=>!r||typeof r.body!=='string'||r.body.length>12000||typeof r.section!=='string'))throw Error('변경 요청 형식을 확인해 주세요.');
  if(i.comments.some(c=>!c||typeof c.body!=='string'||c.body.length>12000))throw Error('메모 형식을 확인해 주세요.');
  if(JSON.stringify(i).length>1800000)throw Error('주보 기록이 너무 큽니다. 백업 후 관리자에게 문의해 주세요.');
  return true;
}
export function initializeIssue(input,actor,now){
  validateIssue(input);const i=B.upgrade(input);
  i.version=1;i.coordinatorId=actor.id;i.tasks=Object.fromEntries(Object.keys(areas).map(k=>[k,{assigneeId:null,status:'todo',updatedAt:null,updatedBy:null,completedAt:null,completedBy:null}]));
  i.history=i.history.map(h=>({...h,actorId:null,actorName:'이전 기기 기록',legacy:true}));
  i.requests=i.requests.map(r=>({...r,id:crypto.randomUUID(),actorId:null,actorName:'이전 기기 기록',legacy:true}));
  i.comments=i.comments.map(c=>({...c,id:crypto.randomUUID(),actorId:null,actorName:'이전 기기 기록',legacy:true}));
  i.activity=[];i.publications=[];i.finalization=null;i.status='draft';i.reviewedRevision=null;i.appliedCommands=[];i.updatedAt=now;
  i.activity.push({id:crypto.randomUUID(),type:'import',label:'주보를 공유 보관함에 등록',actorId:actor.id,actorName:actor.name,at:now,version:1});
  return i;
}
export function ready(i){return Object.values(i.tasks||{}).length===Object.keys(areas).length&&Object.values(i.tasks).every(t=>t.status==='done')&&!(i.migrationNotes||[]).length;}
export function applyCommand(source,command,actor,members,now=new Date().toISOString()){
  if(!actor?.id||!actor?.name)throw Error('편집 전에 이름을 등록해 주세요.');
  const {op}=command;if(source.appliedCommands?.includes(command.commandId))return {issue:source,duplicate:true};
  if(command.baseVersion!==source.version){const e=Error('다른 분의 변경이 먼저 저장됐습니다. 최신 내용과 비교해 주세요.');e.status=409;throw e;}
  let i=B.clone(source),historyLength=i.history.length;const touched=new Set();
  const event=(type,label,extra={})=>i.activity.push({id:crypto.randomUUID(),type,label,...extra,actorId:actor.id,actorName:actor.name,at:now,version:source.version+1});
  const requireMember=id=>{if(id&&!members.some(m=>m.id===id))throw Error('등록된 참여자를 선택해 주세요.');};
  if(op==='fields'){
    if(!command.changes||typeof command.changes!=='object'||Array.isArray(command.changes)||Object.keys(command.changes).length>80)throw Error('변경 내용을 확인해 주세요.');
    for(const [path,value]of Object.entries(command.changes)){const area=sectionFor(path);if(!area)throw Error('고정 영역은 주간 편집에서 바꿀 수 없습니다.');i=B.update(i,path,value);touched.add(area);}
  }else if(op==='list'){
    i=B.listChange(i,command.list,command.action,command.index);touched.add(command.list);
  }else if(op==='undo'){
    const undone=new Set(i.history.filter(h=>h.undoOf).map(h=>h.undoOf));
    const h=[...i.history].reverse().find(h=>h.actorId===actor.id&&!h.undoOf&&!undone.has(h.id));
    if(!h)throw Error('되돌릴 내 수정이 없습니다.');
    if(JSON.stringify(B.getPath(i,h.path))!==JSON.stringify(h.after))throw Error('이 항목은 이후에 수정됐습니다. 현재 내용과 비교해 직접 수정해 주세요.');
    if(h.type==='field')i=B.update(i,h.path,h.before);
    else{const before=B.clone(i[h.path]);i[h.path]=B.clone(h.before);i.revision++;i.history.push({id:crypto.randomUUID(),revision:i.revision,type:'list',path:h.path,before,after:B.clone(h.before)});}
    i.history.at(-1).undoOf=h.id;touched.add(sectionFor(h.path));
  }else if(op==='task'){
    if(typeof command.section!=='string'||!Object.hasOwn(areas,command.section)||!i.tasks||!Object.hasOwn(i.tasks,command.section))throw Error('담당 항목을 확인해 주세요.');
    const t=i.tasks[command.section];if(!t||typeof t!=='object'||Array.isArray(t))throw Error('담당 항목을 확인해 주세요.');
    if(command.assigneeId!==undefined){requireMember(command.assigneeId);const old=t.assigneeId;t.assigneeId=command.assigneeId||null;t.status='todo';t.completedAt=null;t.completedBy=null;event('assignment',areas[command.section]+' 담당자 변경',{section:command.section,before:members.find(m=>m.id===old)?.name||'미지정',after:members.find(m=>m.id===t.assigneeId)?.name||'미지정'});}
    if(command.status!==undefined){
      if(!['todo','progress','done'].includes(command.status))throw Error('진행 상태를 확인해 주세요.');
      if(t.assigneeId&&t.assigneeId!==actor.id&&i.coordinatorId!==actor.id)throw Error('담당자 또는 최종 담당자가 완료 상태를 변경할 수 있습니다.');
      if(!t.assigneeId)t.assigneeId=actor.id;
      const old=t.status;t.status=command.status;t.completedAt=t.status==='done'?now:null;t.completedBy=t.status==='done'?{id:actor.id,name:actor.name}:null;
      event('task',areas[command.section]+' 진행 상태 변경',{section:command.section,before:old,after:t.status});
    }
    t.updatedAt=now;t.updatedBy={id:actor.id,name:actor.name};i.finalization=null;i.status='draft';
  }else if(op==='coordinator'){
    if(i.coordinatorId!==actor.id&&actor.isAdmin!==true)throw Error('현재 최종 담당자 또는 관리자만 담당자를 바꿀 수 있습니다.');requireMember(command.memberId);if(!command.memberId)throw Error('최종 담당자를 선택해 주세요.');
    event('coordinator','최종 담당자 변경',{before:members.find(m=>m.id===i.coordinatorId)?.name,after:members.find(m=>m.id===command.memberId)?.name});i.coordinatorId=command.memberId;
  }else if(op==='comment'){
    const body=String(command.body||'').trim();if(!body||body.length>12000)throw Error('메모를 입력해 주세요.');i.comments.push({id:crypto.randomUUID(),body,revision:i.revision,actorId:actor.id,actorName:actor.name,at:now});event('comment','검토 메모 추가',{after:body});
  }else if(op==='request'){
    const section=typeof command.section==='string'&&Object.hasOwn(areas,command.section)?areas[command.section]:'주보';
    i=B.addRequest(i,String(command.body||''),section);Object.assign(i.requests.at(-1),{actorId:actor.id,actorName:actor.name,at:now});event('request','변경 요청 추가',{after:i.requests.at(-1).body});
  }else if(op==='resolve'){
    const r=i.requests.find(r=>r.id===command.requestId);if(!r)throw Error('요청을 찾을 수 없습니다.');r.resolved=!r.resolved;r.resolvedBy={id:actor.id,name:actor.name};r.resolvedAt=now;event('resolve',r.resolved?'변경 요청 처리 완료':'변경 요청 다시 열기',{after:r.body});
  }else if(op==='migration-ack'){
    i.migrationNotes=[];event('migration','이전 자유 입력을 표에 반영했음을 확인');
  }else if(op==='finalize'){
    if(i.coordinatorId!==actor.id)throw Error('최종 담당자만 주보를 확정할 수 있습니다.');
    if(!ready(i))throw Error('모든 담당 항목을 완료한 뒤 확정해 주세요.');
    if(i.requests.some(r=>!r.resolved))throw Error('확인 대기 중인 변경 요청을 먼저 처리해 주세요.');
    i.status='finalized';i.finalization={version:source.version+1,revision:i.revision,actorId:actor.id,actorName:actor.name,at:now};i.publications.push(i.finalization);event('finalize','배포용 주보 최종 확정');
  }else throw Error('지원하지 않는 변경입니다.');
  if(i.history.length>historyLength){
    for(const h of i.history.slice(historyLength))Object.assign(h,{actorId:actor.id,actorName:actor.name,at:now,version:source.version+1,section:sectionFor(h.path)});
    for(const section of touched){const t=i.tasks[section];if(!t)continue;const wasDone=t.status==='done';t.status='progress';t.completedAt=null;t.completedBy=null;t.updatedAt=now;t.updatedBy={id:actor.id,name:actor.name};if(wasDone)event('reopen',areas[section]+' 수정으로 완료 표시 해제',{section});}
    i.status='draft';i.finalization=null;i.reviewedRevision=null;
  }
  i.version=source.version+1;i.updatedAt=now;i.appliedCommands=[...(i.appliedCommands||[]),command.commandId].slice(-100);
  validateIssue(i);return {issue:i,duplicate:false};
}
