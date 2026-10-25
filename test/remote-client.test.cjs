const test=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const T=require('../frontend/team-client.js');

const baseUrl='https://shared.church.test/api/team';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const client=overrides=>T.createRemoteClient({baseUrl,getToken:async()=>'editor-token',fetch:async()=>json({issues:[]}),...overrides});

test('remote endpoint requires HTTPS, omits URL credentials and disallows URL query/fragment configuration',()=>{
  for(const baseUrl of [undefined,'/api/team','//shared.church.test/api/team','https:shared.church.test/api/team','http://shared.church.test/api/team','ftp://shared.church.test/api/team','https://user:password@shared.church.test/api/team','https://shared.church.test/api/team?token=private','https://shared.church.test/api/team#token',' https://shared.church.test/api/team','https://shared.church.\ntest/api/team','https://shared.church.test\\@other.test/api']){
    assert.throws(()=>client({baseUrl}),TypeError,baseUrl);
  }
  for(const baseUrl of ['http://localhost:8888/api/team','http://127.0.0.1:8888/api/team','http://[::1]:8888/api/team','https://shared.church.test/api/team'])assert.doesNotThrow(()=>client({baseUrl}));
  for(const baseUrl of ['http://localhost.evil.test/api/team','http://192.168.0.1/api/team','http://0.0.0.0/api/team'])assert.throws(()=>client({baseUrl}),TypeError);
});

test('remote client validates required dependencies and bounded timeout',()=>{
  assert.throws(()=>client({getToken:null}),TypeError);
  assert.throws(()=>client({fetch:null}),TypeError);
  for(const timeoutMs of [0,-1,Infinity,NaN,120001,1.1,'15000'])assert.throws(()=>client({timeoutMs}),TypeError);
});

test('remote calls obtain fresh tokens for each read and write and never send cookies',async()=>{
  const requests=[];let token='first-token',lookups=0;
  const api=client({getToken:async()=>{lookups++;return token;},fetch:async(url,options)=>{requests.push({url,options});return json({saved:true});}});
  assert.deepEqual(await api.call(),{saved:true});
  token='second-token';
  const command={op:'fields',issueId:'2026-10-04',changes:{'sermon.title':'주일 말씀'}};
  assert.deepEqual(await api.call(command),{saved:true});
  assert.equal(lookups,2);
  assert.equal(requests[0].options.method,'GET');
  assert.equal(requests[0].options.headers.Authorization,'Bearer first-token');
  assert.equal(requests[0].options.body,undefined);
  assert.equal(requests[1].options.method,'POST');
  assert.equal(requests[1].options.headers.Authorization,'Bearer second-token');
  assert.equal(requests[1].options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(requests[1].options.body),command);
  for(const {url,options}of requests){
    assert.equal(url,baseUrl);assert.equal(options.credentials,'omit');assert.equal(options.mode,'cors');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.headers.Accept,'application/json');assert.ok(options.signal instanceof AbortSignal);
    assert.doesNotMatch(url,/token/);
  }
  assert.deepEqual(Object.keys(api).sort(),['call','getVersion']);
  assert.ok(Object.isFrozen(api));
});

test('version query cannot change the configured destination or inject additional parameters',async()=>{
  let observed;
  const api=client({fetch:async(url,options)=>{observed={url,options};return json({issue:{version:7}});}});
  const issue='https://other.test/steal?token=secret&version=999#escape';
  assert.deepEqual(await api.getVersion(issue,'7'),{issue:{version:7}});
  const url=new URL(observed.url);
  assert.equal(url.origin,'https://shared.church.test');assert.equal(url.pathname,'/api/team');
  assert.deepEqual([...url.searchParams],[['issue',issue],['version','7']]);
  assert.equal(url.hash,'');assert.equal(observed.options.headers.Authorization,'Bearer editor-token');
  assert.equal(observed.options.redirect,'error');assert.equal(observed.options.credentials,'omit');
});

test('invalid history requests never resolve a token or send a request',async()=>{
  let calls=0;const api=client({getToken:async()=>{calls++;return 'token';}});
  for(const [issue,version]of [['',1],[null,1],['id',0],['id',-1],['id',1.2],['id','bad'],['id',Infinity],['id',Number.MAX_SAFE_INTEGER+1]])await assert.rejects(api.getVersion(issue,version),error=>error.code==='INVALID_VERSION'&&error.status===400);
  assert.equal(calls,0);
});

test('missing and malformed tokens block the request without exposing provider details',async()=>{
  let requests=0;
  for(const token of [undefined,null,'',{},'Bearer token','token\r\nInjected: value']){
    const api=client({getToken:async()=>token,fetch:async()=>{requests++;return json({});}});
    await assert.rejects(api.call(),error=>error.code==='AUTH_REQUIRED'&&error.status===401);
  }
  await assert.rejects(client({getToken:async()=>{throw Error('private-provider-token');}}).call(),error=>error.code==='AUTH_REQUIRED'&&!error.message.includes('private-provider-token'));
  assert.equal(requests,0);
});

test('401 and 403 remain actionable even when the gateway returns HTML',async()=>{
  for(const [status,code]of [[401,'AUTH_REQUIRED'],[403,'FORBIDDEN']]){
    const api=client({fetch:async()=>new Response('<html>Sign in</html>',{status})});
    await assert.rejects(api.call(),error=>error.status===status&&error.code===code);
    await assert.rejects(api.getVersion('2026-10-04',1),error=>error.status===status&&error.code===code);
  }
});

test('409 conflicts retain the current issue for the existing rebase flow',async()=>{
  const current={id:'2026-10-04',version:12,sermon:{title:'다른 편집자의 말씀'}};
  const api=client({fetch:async()=>json({error:'먼저 저장된 내용이 있습니다.',current},409)});
  await assert.rejects(api.call({op:'fields'}),error=>{assert.equal(error.status,409);assert.equal(error.code,'CONFLICT');assert.deepEqual(error.current,current);assert.equal(error.message,'먼저 저장된 내용이 있습니다.');return true;});
});

test('server errors and missing versions retain status and useful messages',async()=>{
  for(const [status,message]of [[404,'해당 기록을 찾을 수 없습니다.'],[429,'잠시 후 다시 저장해 주세요.'],[503,'서버 점검 중입니다.']]){
    const api=client({fetch:async()=>json({error:message},status)});
    await assert.rejects(api.call(),error=>error.status===status&&error.code==='HTTP_ERROR'&&error.message===message);
    await assert.rejects(api.getVersion('2026-10-04',1),error=>error.status===status&&error.code==='HTTP_ERROR'&&error.message===message);
  }
});

test('malformed or non-object JSON produces a controlled response error',async()=>{
  for(const body of ['<html>Unavailable</html>','null','[]','false','"OK"']){
    const api=client({fetch:async()=>new Response(body,{status:200})});
    await assert.rejects(api.call(),error=>error.code==='INVALID_RESPONSE');
    await assert.rejects(api.getVersion('2026-10-04',1),error=>error.code==='INVALID_RESPONSE');
  }
  await assert.rejects(client({fetch:async()=>new Response('<html>Unavailable</html>',{status:502})}).call(),error=>error.code==='INVALID_RESPONSE'&&error.status===502);
});

test('network and redirect failures are sanitized and never automatically retried',async()=>{
  let requests=0;
  const api=client({fetch:async(url,options)=>{requests++;assert.equal(options.redirect,'error');throw TypeError('Redirect failed for editor-token');}});
  await assert.rejects(api.call({op:'fields'}),error=>error.code==='NETWORK'&&!error.message.includes('editor-token')&&!error.cause);
  assert.equal(requests,1);
});

test('a real redirect never sends the token or command to a second origin',async t=>{
  const start=async handler=>{
    const server=createServer(handler);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  };
  let otherRequests=0,endpointRequests=0;
  const other=await start((request,response)=>{otherRequests++;response.end('{}');});
  const endpoint=await start((request,response)=>{
    endpointRequests++;assert.equal(request.headers.authorization,'Bearer editor-token');
    response.writeHead(307,{Location:other+'/unexpected'});response.end();
  });
  const api=client({baseUrl:endpoint+'/api/team',fetch:globalThis.fetch});
  await assert.rejects(api.call({op:'fields',changes:{'sermon.title':'Private draft'}}),error=>error.code==='NETWORK');
  assert.equal(endpointRequests,1);assert.equal(otherRequests,0);
});

test('request timeout aborts the fetch and reports a retryable timeout',async()=>{
  let signal;
  const api=client({timeoutMs:10,fetch:async(url,options)=>{signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});
  await assert.rejects(api.call(),error=>error.code==='TIMEOUT');
  assert.ok(signal.aborted);
});

test('token lookup timeout never starts a late network request',async()=>{
  let resolveToken,requests=0;
  const api=client({timeoutMs:10,getToken:()=>new Promise(resolve=>{resolveToken=resolve;}),fetch:async()=>{requests++;return json({});}});
  await assert.rejects(api.call(),error=>error.code==='TIMEOUT');
  resolveToken('late-token');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,0);
});

test('default team call remains relative and cookie-authenticated',async()=>{
  let request;
  const result=await T.call({op:'profile',name:'박태진 목사'},{fetch:async(url,options)=>{request={url,options};return json({profile:{name:'박태진 목사'}});}});
  assert.equal(result.profile.name,'박태진 목사');assert.equal(request.url,'/api/team');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.headers.Authorization,undefined);
});

test('default version read remains same-origin without a remote access token',async t=>{
  let request;
  t.mock.method(globalThis,'fetch',async(url,options)=>{request={url,options};return json({issue:{version:3}});});
  assert.deepEqual(await T.getVersion('2026-10-04',3),{issue:{version:3}});
  assert.equal(request.url,'/api/team?issue=2026-10-04&version=3');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.headers,undefined);
});
