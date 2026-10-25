import * as domain from './team-domain.browser.mjs';
import {createPagesStore} from './pages-store.mjs';

try {
  const directory=new URL('.',location.href);
  const local=createPagesStore({
    storage:localStorage,
    locks:navigator.locks,
    domain,
    B:globalThis.Bulletin,
    key:'kpcstl.github-pages.v1:'+directory.pathname,
  });
  Object.assign(globalThis.BulletinTeam,local,{
    storageMode:'local',
    shareUrl:directory.href,
  });
  await import('./app.js');
} catch(error) {
  document.querySelector('#save-status').textContent='기기 저장소 확인 필요';
  const banner=document.querySelector('#connection-banner');
  banner.hidden=false;
  banner.textContent='이 브라우저의 저장소를 열지 못했습니다. 브라우저 저장 권한을 확인해 주세요. 기존 자료는 삭제하지 않았습니다.';
  console.error(error);
}
