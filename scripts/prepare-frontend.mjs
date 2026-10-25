import { cp, mkdir, rename, rm } from 'node:fs/promises';
await rm('public',{recursive:true,force:true});
await mkdir('public',{recursive:true});
await cp('frontend','public',{recursive:true});
await rename('public/index.html','public/studio.html');
await rm('public/package.json',{force:true});
