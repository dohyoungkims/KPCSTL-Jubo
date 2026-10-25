import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import cloudConfig from '../frontend/cloud-config.mjs';

async function filesIn(directory){
  const files=[];
  async function visit(path){
    const entries=await readdir(path,{withFileTypes:true});
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const child=join(path,entry.name);
      if(entry.isDirectory())await visit(child);
      else if(entry.isFile())files.push(relative(directory,child).split(sep).join('/'));
      else throw Error('Browser assets must be regular files: '+entry.name);
    }
  }
  await visit(directory);return files.sort();
}

export async function buildPages({
  output=fileURLToPath(new URL('../.pages/',import.meta.url)),
  source=fileURLToPath(new URL('../frontend/',import.meta.url)),
  domainFile=fileURLToPath(new URL('../lib/team-domain.mjs',import.meta.url)),
  apiBaseUrl=process.env.KPCSTL_API_BASE_URL ?? cloudConfig.apiBaseUrl,
  openEditing=cloudConfig.openEditing===true,
  quiet=false,
}={}){
  if(apiBaseUrl){
    const url=new URL(apiBaseUrl);
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Cloud API must be an HTTPS origin (HTTP localhost is allowed for development).');
  }

  // Publish only browser assets. The server-backed build remains separate.
  await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
  await cp(source,output,{recursive:true});await rm(join(output,'package.json'));
  await writeFile(join(output,'cloud-config.mjs'),'export default Object.freeze('+JSON.stringify({apiBaseUrl,openEditing:openEditing===true})+');\n');
  const domain=await readFile(domainFile,'utf8'),coreImport="import B from '../frontend/core.js';";
  if(!domain.startsWith(coreImport))throw Error('Review the browser domain adapter: core import changed.');
  await writeFile(join(output,'team-domain.browser.mjs'),domain.replace(coreImport,'const B=globalThis.Bulletin;'));

  // Hash source bytes before creating any generated release directory. Every
  // entry script, transitive module and static PDF asset shares this namespace.
  // A new bootstrap can therefore never import a cached app from an old build.
  const files=await filesIn(output),hash=createHash('sha256');
  hash.update(await readFile(fileURLToPath(import.meta.url)));
  for(const file of files){hash.update('\0'+file+'\0');hash.update(await readFile(join(output,file)));}
  const revision=hash.digest('hex').slice(0,20),prefix='releases/'+revision+'/';
  for(const file of files){
    if(file.endsWith('.html'))continue;
    let bytes=await readFile(join(output,file));
    if(/\.(?:m?js)$/.test(file)&&!file.startsWith('vendor/')){
      // These paths resolve against document.baseURI, while imports resolve
      // against their own module URL and already stay inside the release.
      bytes=Buffer.from(bytes.toString('utf8')
        .replace(/(["'`])assets\//g,'$1'+prefix+'assets/')
        .replace(/(new URL\(\s*["'])vendor\//g,'$1'+prefix+'vendor/'));
    }
    if(file==='assets/print/font-metrics.json'){
      const metrics=JSON.parse(bytes.toString('utf8'));
      for(const value of Object.values(metrics)){
        if(typeof value.url!=='string'||!value.url.startsWith('assets/'))throw Error('Review the font asset URL before publishing.');
        value.url=prefix+value.url;
      }
      bytes=Buffer.from(JSON.stringify(metrics));
    }
    const destination=join(output,prefix,file);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);
  }

  let html=await readFile(join(output,'index.html'),'utf8');
  html=html.replace('<script src="app.js"></script>','<script type="module" src="pages-bootstrap.mjs"></script>')
    .replace('<link rel="stylesheet" href="styles.css">','<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="cloud.css"><meta name="referrer" content="no-referrer">')
    .replace('비공개 디자인 프로토타입','교회 주보 앱')
    .replace('이 프로토타입 안내 ↗','사용 안내 ↗');
  if(!apiBaseUrl)html=html.replace('공유 주보 연결 중…','이 브라우저의 주보 여는 중…')
    .replace('함께 준비하는 주보','이 브라우저에 저장')
    .replace('data-storage-label="공유 편집"','data-storage-label="기기 내 저장"')
    .replace('편집자 · 변경 기록 · 담당별 진행 상황','다른 기기·교인과 자동 공유되지 않습니다. PDF로 전달해 주세요.')
    .replace('팀 진행 보기','내 진행 보기');
  const assetFiles=new Set(files.filter(file=>!file.endsWith('.html')));
  html=html.replace(/\b(src|href)="([^"]+)"/g,(match,attribute,value)=>assetFiles.has(value)?`${attribute}="${prefix}${value}"`:match)
    .replace('</head>',`<meta name="kpcstl-build" content="${revision}"></head>`);
  await writeFile(join(output,'index.html'),html);await writeFile(join(output,'studio.html'),html);
  await writeFile(join(output,'build-info.json'),JSON.stringify({revision,apiBaseUrl,openEditing:openEditing===true})+'\n');
  await writeFile(join(output,'.nojekyll'),'');
  if(!quiet)console.log('GitHub Pages artifact prepared in .pages/ ('+(apiBaseUrl?'shared online storage':'browser-local saves')+', release '+revision+').');
  return {revision,prefix,output};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await buildPages();
