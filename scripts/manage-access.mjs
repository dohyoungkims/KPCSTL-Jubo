import {chmod,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createAccessRecord} from '../worker/auth.mjs';

// Local bootstrap only. No cloud calls, terminal secrets, or overwrite behavior.
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--name'){
  console.error('Usage: node scripts/manage-access.mjs --name "Administrator display name"');
  process.exitCode=1;
}else{
  try{
    const access=await createAccessRecord(args[1],'admin');
    const directory=new URL('../work/access/',import.meta.url);
    await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
    const stem='admin-'+access.createdAt.replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
    const privateFile=new URL(stem+'.json',directory),sqlFile=new URL(stem+'.sql',directory);
    const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
    const sql=`-- Private admin bootstrap. Only the code hash is stored in the database.\nINSERT INTO members (id,name,created_at,updated_at) VALUES (${[access.id,access.name,access.createdAt,access.createdAt].map(quote).join(',')});\nINSERT INTO editor_access (id,role,code_hash,created_at,expires_at,revoked_at) VALUES (${[access.id,access.role,access.codeHash,access.createdAt,access.expiresAt].map(quote).join(',')},NULL);\n`;
    const privateData={id:access.id,name:access.name,role:access.role,code:access.code,createdAt:access.createdAt,expiresAt:access.expiresAt};
    await writeFile(privateFile,JSON.stringify(privateData,null,2)+'\n',{mode:0o600,flag:'wx'});
    await writeFile(sqlFile,sql,{mode:0o600,flag:'wx'});
    console.log('Private administrator access saved (not applied to any database).');
    console.log('Access file: '+fileURLToPath(privateFile));
    console.log('Seed SQL: '+fileURLToPath(sqlFile));
    console.log('Keep the access file private. Apply the seed SQL only to the intended church database.');
  }catch{
    console.error('Could not create administrator access. Check the display name and local output permissions.');
    process.exitCode=1;
  }
}
