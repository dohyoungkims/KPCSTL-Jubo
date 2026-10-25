(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Bulletin = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  const stamp = () => new Date().toISOString();
  const uid = () => 'i' + Math.random().toString(36).slice(2, 11);
  const rosterDefaults=()=>({date1:'10월 11일',date2:'10월 18일',month1:'10월',month2:'11월',prayer11:'목회기도',prayer12:'최영애 권사',prayer21:'박철재 집사',prayer22:'김도영 집사',usher11:'서진극 장로',usher12:'기영재 장로',usher21:'이영주 집사',usher22:'박영애 집사'});
  const midweekDefaults=()=>({fridayText:'사무엘상',saturdayText:'사사기 묵상',fridayLeader:'이강택 목사',saturdayLeader:'송경석 목사'});
  const fixedSchedule='1부 예배: 주일 09:30 AM (본당)\n2부 예배: 주일 11:00 AM (본당)\nAdult English Service*: Sunday 11:00 AM (Mission Hall)\n중고등부 예배 Youth*: Sunday 11:00 AM (Mission Hall)\n주일학교 Sunday School: 주일 11:00 AM (영유아부/유치부/유년부)\n브릿지 미니스트리: 주일 01:15 PM (본당)\n청년대학부 순모임: 주일 01:00 PM (교육관), 금 09:00 PM (유년부실)\n금요찬양집회/큐티스쿨: 금요일 07:30 PM (본당 및 유년부실)\n중고등부 IGNITE 모임*: 금요일 07:30 PM (Mission Hall)\n토요새벽기도: 토요일 06:00 AM (본당)\n뉴 웨이브 미니스트리: 토요일 10:00 AM (봄/가을)\n* In English Language';
  const fixedStaff='한국어 사역부\n이강택 담임목사 (Senior Pastor) · Rev. Kangtaek Peter Lee\n860-682-8576 · petroslee@hotmail.com\n박태진 목사 (KM부목사, 청년대학부) · Rev. TJ Park\n314-809-4030 · kpcstloffice@gmail.com\n송경석 목사 (찬양, 뉴웨이브) · Rev. Landon Song\n213-479-1134 · kpcstlsong@gmail.com\n\n영어 사역부\n홍정모 목사 (EM) · Rev. Abraham Hong\n630-828-3394 · arhong327@gmail.com\nPastoral Intern Joshua Joo (EM)\n919-328-0286 · josh.joo@ruf.org\n\n교육부\n홍정모 목사 (Youth Group) · Rev. Abraham Hong\n630-828-3394 · arhong327@gmail.com\n조수안 전도사 (Youth Director) · Intern Pastor Suan Cho\n314-239-1980 · jangsua@gmail.com\n이형만 전도사 (주일학교) · Intern Pastor Jonah Lee\n314-827-9329 · kpcs.sundayschool@gmail.com\n박보영 집사 (유년부): 636-233-3792\n최희경 사모 (유치부): 314-357-4018\n김은지 집사 (영유아부): 850-714-2188';
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10) === s;
  const seedIssue = () => ({
    id:'2026-10-04',date:'2026-10-04',status:'draft',revision:1,reviewedRevision:null,history:[],requests:[],comments:[],updatedAt:stamp(),
    sermon:{title:'고별설교 8: 포도나무 비유로 듣는 기독교 복음',scripture:'요한복음 (John) 15:1-6',preacher:'담임목사'},
    worship:{service1:'오전 9:30',service2:'오전 11:00',call:'예배로의 부름',doxology:'찬송가 5장',confession:'신앙고백',hymn1:'찬송가 90장',praise2:'들림 워십과 함께',prayer1:'목회기도',prayer2:'기도 담당자',giving:'예수 하나님의 공의',closing:'폐회찬양',benediction:'축도'},
    sections:{volunteers:'10/11 대표기도\n1부: 담당자 확인\n2부: 담당자 확인\n\n10월 예배 안내\n1부: 담당자 확인\n2부: 담당자 확인',meals:'10/11: EM\n10/18: 청년대학부',pastoral:'10/6: 순장모임\n10/7: 여성 제자반\n10/8: 남성 제자반',events:'10/4: 주일학교 야외예배\n10/10: 브릿지 미니스트리 피크닉\n10/30-11/1: 청년대학부 수련회',midweek:'금요찬양집회: 사무엘상\n토요새벽예배: 사사기 묵상',regular:'1부 예배: 주일 09:30 AM\n2부 예배: 주일 11:00 AM\nEnglish Service: Sunday 11:00 AM\n주일학교: 주일 11:00 AM\n금요찬양집회: 금요일 07:30 PM\n토요새벽기도: 토요일 06:00 AM',prayers:'교우들의 건강과 회복을 위해 기도해 주세요.\n기도제목은 공개 범위를 확인한 후 입력합니다.',staff:'한국어 사역부 / English Ministry / 교육부\n담당자와 연락처를 입력하세요.'},
    announcements:[{id:'a1',title:'환영합니다!',body:'오늘 함께 예배하는 모든 분들을 환영합니다.'},{id:'a2',title:'KPC 캠페인',body:'공예배 5분 일찍 오기\n주일학교 Drop off: 매주일 오전 10:50까지.'},{id:'a3',title:'새교우반',body:'주일 오후 1시, 유년부실\n참여 일정과 장소를 확인해 주세요.'},{id:'a4',title:'주일학교 야외예배',body:'이번 주 행사 안내를 입력하세요.'},{id:'a5',title:'일반 공지사항',body:'모임 후 정리, 소등과 문단속을 부탁드립니다.'}],
    offering:{tithe:'0',sunday:'0',thanks:'0',school:'0',mission:'0',scholarship:'0',relief:'0'},
    questions:[{id:'q1',number:'1',body:'본문을 읽고, 참 포도나무의 비유가 전하는 의미를 나누어 보세요.'},{id:'q5',number:'5',body:'이번 주 말씀을 삶에 어떻게 적용할 수 있을까요?'}],
    roster:rosterDefaults(),midweek:midweekDefaults()
  });
  function createStore(){return {schemaVersion:1,serial:0,current:'2026-10-04',issues:[seedIssue()]};}
  function getPath(o,path){return path.split('.').reduce((v,k)=>v[k],o);}
  function setPath(o,path,value){
    const keys=path.split('.');
    if(keys.some(k=>['__proto__','prototype','constructor'].includes(k))) throw Error('Invalid field');
    if(!['sermon','worship','sections','announcements','offering','questions','roster','midweek'].includes(keys[0])) throw Error('Field is not editable');
    if(['sections.regular','sections.staff','sections.volunteers','sections.midweek'].includes(path))throw Error('고정 안내 또는 표 항목입니다. 해당 표의 입력 칸을 사용해 주세요.');
    let at=o;for(const k of keys.slice(0,-1)){if(!Object.prototype.hasOwnProperty.call(at,k))throw Error('Unknown field');at=at[k];}
    const key=keys.at(-1);if(!Object.prototype.hasOwnProperty.call(at,key))throw Error('Unknown field');
    if(typeof value!=='string'||value.length>12000)throw Error('Invalid content');
    if(keys[0]==='offering'&&!/^\d{1,8}(\.\d{0,2})?$/.test(value))throw Error('금액은 소수점 두 자리까지 입력해 주세요.');
    at[key]=value;
  }
  function changed(issue,event){
    issue.revision+=1;issue.status='draft';issue.reviewedRevision=null;issue.updatedAt=stamp();
    issue.history.push({...event,id:uid(),revision:issue.revision,at:issue.updatedAt});return issue;
  }
  function update(issue,path,value,expectedRevision=issue.revision){
    if(issue.revision!==expectedRevision)throw Error('Stale revision');
    const next=clone(issue),before=clone(getPath(next,path));
    if(before===value)return next;
    setPath(next,path,value);return changed(next,{type:'field',path,before,after:value});
  }
  function listChange(issue,list,action,index){
    if(!['announcements','questions'].includes(list))throw Error('Invalid list');
    const next=clone(issue),before=clone(next[list]),items=next[list];
    if(action==='add')items.push(list==='announcements'?{id:uid(),title:'새 교회 소식',body:''}:{id:uid(),number:String(items.length+1),body:''});
    else if(action==='delete'&&Number.isInteger(index)&&index>=0&&index<items.length)items.splice(index,1);
    else if(['up','down'].includes(action)){const dest=index+(action==='up'?-1:1);if(dest<0||dest>=items.length||index<0||index>=items.length)return next;[items[index],items[dest]]=[items[dest],items[index]];}
    else throw Error('Invalid list action');
    return changed(next,{type:'list',path:list,before,after:clone(items)});
  }
  function undo(issue){
    const undone=new Set(issue.history.filter(e=>e.undoOf).map(e=>e.undoOf));
    const event=[...issue.history].reverse().find(e=>!e.undoOf&&!undone.has(e.id));if(!event)return clone(issue);
    const next=clone(issue);
    if(event.type==='field')setPath(next,event.path,event.before);
    else next[event.path]=clone(event.before);
    return changed(next,{type:event.type,path:event.path,before:clone(event.after),after:clone(event.before),undoOf:event.id});
  }
  function nextWeek(date){if(!validDate(date))throw Error('Invalid date');const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+7);return d.toISOString().slice(0,10);}
  function duplicate(store,sourceId,date){
    if(!validDate(date))throw Error('날짜를 확인해 주세요.');
    if(new Date(date+'T12:00:00Z').getUTCDay()!==0)throw Error('주일 날짜를 선택해 주세요.');
    if(store.issues.some(x=>x.id===date))throw Error('이미 같은 주의 주보가 있습니다. 보관함에서 열어 주세요.');
    const base=store.issues.find(x=>x.id===sourceId);if(!base)throw Error('Unknown issue');
    const next=clone(store),issue=clone(base);Object.assign(issue,{id:date,date,status:'draft',revision:1,reviewedRevision:null,history:[],requests:[],comments:[],updatedAt:stamp()});
    for(const k of Object.keys(issue.offering))issue.offering[k]='0';
    issue.sermon.title='';issue.sermon.scripture='';issue.sections.prayers='';
    next.issues.push(issue);next.current=date;return next;
  }
  function totalCents(offering){return Object.values(offering).reduce((a,s)=>{if(!/^\d{1,8}(\.\d{0,2})?$/.test(s))throw Error('Invalid amount');const [d,f='']=s.split('.');return a+Number(d)*100+Number(f.padEnd(2,'0'));},0);}
  function addRequest(issue,body,section){const next=clone(issue);const clean=body.trim();if(!clean||clean.length>12000)throw Error('변경 요청 내용을 입력해 주세요.');next.requests.push({id:uid(),body:clean,section,baseRevision:issue.revision,at:stamp(),resolved:false});return next;}
  function approve(issue){const n=clone(issue);n.reviewedRevision=n.revision;n.status='reviewed';return n;}
  function validStore(s){return s&&s.schemaVersion===1&&Number.isInteger(s.serial)&&Array.isArray(s.issues)&&s.issues.length>0&&s.issues.some(i=>i.id===s.current)&&s.issues.every(i=>validDate(i.date)&&i.id===i.date&&Number.isInteger(i.revision)&&i.sermon&&i.worship&&i.sections&&Array.isArray(i.announcements)&&Array.isArray(i.questions)&&i.offering&&Array.isArray(i.history)&&Array.isArray(i.requests)&&Array.isArray(i.comments));}
  function upgrade(source){
    const i=clone(source),notes=[];
    if(!i.roster){i.roster=rosterDefaults();if(i.sections.volunteers&&i.sections.volunteers!==seedIssue().sections.volunteers)notes.push({section:'volunteers',body:i.sections.volunteers});}
    if(!i.midweek){i.midweek=midweekDefaults();if(i.sections.midweek&&i.sections.midweek!==seedIssue().sections.midweek)notes.push({section:'schedule',body:i.sections.midweek});}
    i.migrationNotes=i.migrationNotes||notes;
    return i;
  }
  return {clone,createStore,getPath,update,listChange,undo,nextWeek,duplicate,totalCents,addRequest,approve,validStore,validDate,uid,upgrade,rosterDefaults,midweekDefaults,fixedSchedule,fixedStaff};
});
