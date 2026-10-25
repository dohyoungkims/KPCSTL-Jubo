// Read-only public projection. Never return the current draft or an editor document.
const CONTENT_FIELDS=Object.freeze({
  sermon:['title','scripture','preacher'],
  worship:['service1','service2','call','doxology','confession','hymn1','praise2','prayer1','prayer2','giving','closing','benediction'],
  sections:['meals','pastoral','events','prayers'],
  offering:['tithe','sunday','thanks','school','mission','scholarship','relief'],
  roster:['date1','date2','month1','month2','prayer11','prayer12','prayer21','prayer22','usher11','usher12','usher21','usher22'],
  midweek:['fridayText','saturdayText','fridayLeader','saturdayLeader'],
});
const SECTIONS=['sermon','announcements','volunteers','schedule','prayers','questions'];
const MAX_DOCUMENT_LENGTH=1800000;
// One query for the archive, not one query per Sunday. Guard JSON functions in
// SQL, then independently validate the full publication record before output.
const PUBLISHED_ROWS=`SELECT i.id,i.version,i.document,
  v.version AS published_version,v.document AS published_document
  FROM issues AS i LEFT JOIN issue_versions AS v ON v.issue_id=i.id AND v.version=(
    SELECT MAX(CASE WHEN publication.type='object' THEN
      CASE WHEN json_type(publication.value,'$.version')='integer'
        THEN json_extract(publication.value,'$.version') END END)
    FROM json_each(CASE WHEN json_valid(i.document) THEN i.document ELSE '{}' END,'$.publications') AS publication
  )`;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>record(value)&&Object.hasOwn(value,key);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const text=value=>typeof value==='string'&&value.length<=12000;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value;
const samePublication=(a,b)=>record(a)&&record(b)&&a.version===b.version&&a.revision===b.revision&&a.at===b.at;
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});

function parseDocument(row){
  if(!record(row)||typeof row.document!=='string'||row.document.length>MAX_DOCUMENT_LENGTH)return null;
  try{const value=JSON.parse(row.document);return record(value)?value:null;}catch{return null;}
}

function publications(document){
  if(!Array.isArray(document.publications)||document.publications.length>document.version)return null;
  const seen=new Set();
  for(const entry of document.publications){
    if(!record(entry)||!positive(entry.version)||entry.version>document.version||!positive(entry.revision)||entry.revision>document.revision||!timestamp(entry.at)||seen.has(entry.version))return null;
    seen.add(entry.version);
  }
  return document.publications;
}

function identityMatches(document,id,version){
  return record(document)&&date(id)&&document.id===id&&document.date===id&&document.version===version&&positive(version)&&positive(document.revision);
}

function copyFields(source,fields){
  if(!record(source)||fields.some(key=>!own(source,key)||!text(source[key])))return null;
  return Object.fromEntries(fields.map(key=>[key,source[key]]));
}

function printableSnapshot(snapshot,id,publication){
  if(!identityMatches(snapshot,id,publication.version)||snapshot.status!=='finalized'||snapshot.revision!==publication.revision||!samePublication(snapshot.finalization,publication))return null;
  const published=publications(snapshot);
  if(!published?.some(entry=>samePublication(entry,publication)))return null;
  if(!record(snapshot.tasks)||SECTIONS.some(section=>!own(snapshot.tasks,section)||snapshot.tasks[section]?.status!=='done'))return null;
  if(!Array.isArray(snapshot.requests)||snapshot.requests.some(request=>!record(request)||request.resolved!==true))return null;
  if(!Array.isArray(snapshot.migrationNotes)||snapshot.migrationNotes.length)return null;

  const result={id,date:id,revision:snapshot.revision};
  for(const [group,fields]of Object.entries(CONTENT_FIELDS)){
    const content=copyFields(snapshot[group],fields);
    if(!content)return null;
    result[group]=content;
  }
  if(Object.values(result.offering).some(value=>!/^\d{1,8}(\.\d{0,2})?$/.test(value)))return null;
  for(const [list,fields]of [['announcements',['title','body']],['questions',['number','body']]]){
    if(!Array.isArray(snapshot[list])||snapshot[list].length>100)return null;
    result[list]=snapshot[list].map(item=>copyFields(item,fields));
    if(result[list].some(item=>item===null))return null;
  }
  return result;
}

function latestPublished(row){
  if(!record(row))return null;
  const current=parseDocument(row);
  if(!identityMatches(current,row.id,row.version)||!['draft','finalized'].includes(current.status))return null;
  const published=publications(current);
  if(!published?.length)return null;
  // Versions define publication order. Clock drift and array order do not.
  const latest=published.reduce((a,b)=>a.version>b.version?a:b);
  if(row.published_version!==latest.version)return null;
  const snapshot=parseDocument({document:row.published_document});
  // A missing/corrupt latest publication must not silently reveal another version.
  return snapshot?printableSnapshot(snapshot,row.id,latest):null;
}

/**
 * GET /api/public -> {issues: PrintableIssue[]} in descending bulletin date order.
 * GET /api/public?issue=YYYY-MM-DD -> {issue: PrintableIssue}, or 404.
 * Authentication, routing, and CORS belong to the hosting adapter. This service
 * performs no writes and never returns editor-only fields or database errors.
 */
export async function publicBulletinApi(request,db){
  if(request.method!=='GET')return json({error:'Method not allowed'},405,{allow:'GET'});
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>key!=='issue')||params.getAll('issue').length>1)return json({error:'주보 주소를 확인해 주세요.'},400);
  const id=params.get('issue');
  if(id!==null&&!date(id))return json({error:'주보 날짜를 확인해 주세요.'},400);
  if(!db)return json({error:'주보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);
  try{
    if(id!==null){
      const row=await db.prepare(PUBLISHED_ROWS+' WHERE i.id=?').bind(id).first();
      const issue=row?latestPublished(row):null;
      return issue?json({issue}):json({error:'공개된 주보를 찾을 수 없습니다.'},404);
    }
    const rows=await db.prepare(PUBLISHED_ROWS+' ORDER BY i.id DESC').all();
    if(!Array.isArray(rows.results))throw Error('Invalid database response');
    const issues=[];
    for(const row of rows.results){const issue=latestPublished(row);if(issue)issues.push(issue);}
    return json({issues});
  }catch{return json({error:'주보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},503);}
}
