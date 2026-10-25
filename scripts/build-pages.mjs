import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import cloudConfig from '../frontend/cloud-config.mjs';

const apiBaseUrl=process.env.KPCSTL_API_BASE_URL ?? cloudConfig.apiBaseUrl;
if(apiBaseUrl){
  const url=new URL(apiBaseUrl);
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Cloud API must be an HTTPS origin (HTTP localhost is allowed for development).');
}

// Publish only browser assets. The server-backed build remains separate.
const output=new URL('../.pages/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(new URL('../frontend/',import.meta.url),output,{recursive:true});
await rm(new URL('package.json',output));
await writeFile(new URL('cloud-config.mjs',output),'export default Object.freeze('+JSON.stringify({apiBaseUrl})+');\n');

const domain=await readFile(new URL('../lib/team-domain.mjs',import.meta.url),'utf8');
const coreImport="import B from '../frontend/core.js';";
if(!domain.startsWith(coreImport))throw Error('Review the browser domain adapter: core import changed.');
await writeFile(new URL('team-domain.browser.mjs',output),domain.replace(coreImport,'const B=globalThis.Bulletin;'));

let html=await readFile(new URL('index.html',output),'utf8');
html=html.replace('<script src="app.js"></script>','<script type="module" src="pages-bootstrap.mjs"></script>')
  .replace('<link rel="stylesheet" href="styles.css">','<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="cloud.css"><meta name="referrer" content="no-referrer">')
  .replace('비공개 디자인 프로토타입','교회 주보 앱')
  .replace('이 프로토타입 안내 ↗','사용 안내 ↗');
if(!apiBaseUrl)html=html.replace('공유 주보 연결 중…','이 브라우저의 주보 여는 중…')
  .replace('함께 준비하는 주보','이 브라우저에 저장')
  .replace('data-storage-label="공유 편집"','data-storage-label="기기 내 저장"')
  .replace('편집자 · 변경 기록 · 담당별 진행 상황','다른 기기·교인과 자동 공유되지 않습니다. PDF로 전달해 주세요.')
  .replace('팀 진행 보기','내 진행 보기');
await writeFile(new URL('index.html',output),html);
await writeFile(new URL('studio.html',output),html);
await writeFile(new URL('.nojekyll',output),'');
console.log('GitHub Pages artifact prepared in .pages/ ('+(apiBaseUrl?'shared online storage':'browser-local saves')+').');
