import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPages} from '../scripts/build-pages.mjs';

const source=fileURLToPath(new URL('../frontend/',import.meta.url));
const apiBaseUrl='https://shared.church.test';
const refs=html=>[...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(match=>match[1]).filter(value=>/\.(?:m?js|css)$/.test(value));
async function workspace(t){const root=await mkdtemp(join(tmpdir(),'kpcstl-pages-build-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('all HTML entry points and their module graph share one content-addressed release',async t=>{
  const root=await workspace(t),output=join(root,'pages');
  const {revision,prefix}=await buildPages({output,apiBaseUrl,quiet:true});
  const html=await readFile(join(output,'studio.html'),'utf8');
  assert.equal(html,await readFile(join(output,'index.html'),'utf8'));
  assert.match(html,new RegExp('name="kpcstl-build" content="'+revision+'"'));
  assert.doesNotMatch(html,/<base\b/);
  const entryRefs=refs(html);assert.ok(entryRefs.length>=8);
  for(const ref of entryRefs){assert.ok(ref.startsWith(prefix),ref);await access(join(output,ref));}
  const origin='https://church.github.io/KPCSTL-Jubo/';
  const visited=new Set(),queue=entryRefs.filter(ref=>/\.m?js$/.test(ref));
  while(queue.length){
    const file=queue.shift();if(visited.has(file))continue;visited.add(file);
    const body=await readFile(join(output,file),'utf8');
    const specifiers=[...body.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)|\bfrom\s*['"]([^'"]+)['"]/g)].map(match=>match[1]||match[2]);
    for(const specifier of specifiers){
      if(!specifier.startsWith('.'))continue;
      const url=new URL(specifier,new URL(file,origin));
      assert.ok(url.href.startsWith(origin+prefix),file+' -> '+specifier);
      const target=url.href.slice(origin.length);await access(join(output,target));queue.push(target);
    }
  }
  for(const name of ['app.js','pages-bootstrap.mjs','pages-store.mjs','cloud-config.mjs','cloud-session.mjs','cloud-migration.mjs','public-view.js','vendor/pdf.min.mjs'])assert.ok(visited.has(prefix+name),name+' must be in the versioned graph');
  const config=await readFile(join(output,prefix,'cloud-config.mjs'),'utf8');assert.ok(config.includes(apiBaseUrl));
  const app=await readFile(join(output,prefix,'app.js'),'utf8');assert.match(app,/SHARED ONLINE WORKSPACE/);assert.match(app,/T\.initialIssues/);
});

test('PDF templates, font metrics, fonts, workers and image URLs are pinned to the same release',async t=>{
  const root=await workspace(t),output=join(root,'pages');const {prefix}=await buildPages({output,apiBaseUrl,quiet:true});
  const print=await readFile(join(output,prefix,'print.js'),'utf8');
  for(const path of ['assets/print/template.pdf','assets/print/font-metrics.json']){assert.ok(print.includes("read('"+prefix+path+"')"));await access(join(output,prefix,path));}
  const metrics=JSON.parse(await readFile(join(output,prefix,'assets/print/font-metrics.json'),'utf8'));
  assert.ok(Object.keys(metrics).length>=4);
  for(const font of Object.values(metrics)){assert.ok(font.url.startsWith(prefix+'assets/print/'));await access(join(output,font.url));}
  for(const name of ['print-view.js','public-view.js']){
    const body=await readFile(join(output,prefix,name),'utf8');assert.ok(body.includes("new URL('"+prefix+"vendor/pdf.worker.min.mjs',document.baseURI)"));
  }
  await access(join(output,prefix,'vendor/pdf.worker.min.mjs'));
  const app=await readFile(join(output,prefix,'app.js'),'utf8');assert.ok(app.includes('src="'+prefix+'assets/fixed-staff.png"'));assert.ok(app.includes('src="'+prefix+'assets/source-${n}.png"'));
  const bootstrap=await readFile(join(output,prefix,'pages-bootstrap.mjs'),'utf8');assert.ok(bootstrap.includes("new URL('.',location.href)"));assert.ok(bootstrap.includes("new URL('studio.html',directory)"));
});

test('unchanged builds are deterministic and source/config changes invalidate the entire graph',async t=>{
  const root=await workspace(t),copy=join(root,'frontend');await cp(source,copy,{recursive:true});
  const first=await buildPages({source:copy,output:join(root,'first'),apiBaseUrl,quiet:true});
  const same=await buildPages({source:copy,output:join(root,'same'),apiBaseUrl,quiet:true});assert.equal(first.revision,same.revision);
  const app=join(copy,'app.js');await writeFile(app,(await readFile(app,'utf8'))+'\n// A new editor release.\n');
  const changed=await buildPages({source:copy,output:join(root,'changed'),apiBaseUrl,quiet:true});assert.notEqual(first.revision,changed.revision);
  const oldRefs=refs(await readFile(join(first.output,'studio.html'),'utf8')),newRefs=refs(await readFile(join(changed.output,'studio.html'),'utf8'));
  assert.equal(oldRefs.some(ref=>newRefs.includes(ref)),false,'every entry asset must change URL together');
  const local=await buildPages({source:copy,output:join(root,'local'),apiBaseUrl:'',quiet:true});assert.notEqual(changed.revision,local.revision);
  assert.match(await readFile(join(local.output,'studio.html'),'utf8'),/이 브라우저에 저장/);
});
