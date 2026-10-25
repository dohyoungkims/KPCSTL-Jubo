const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Read only: the original browser workspaces remain available after transfer.
export function readLocalIssues({storage, B, directory}) {
  const sources = [
    {key: 'kpcstl.bulletin.study.v1', legacy: true},
    {key: 'kpcstl.github-pages.v1:' + directory.pathname, legacy: false},
  ];
  const found = new Map(), errors = [], fingerprints = [];
  for (const source of sources) {
    try {
      const raw = storage.getItem(source.key);
      if (!raw) continue;
      fingerprints.push(source.key + ':' + raw);
      const data = JSON.parse(raw);
      if (data.schemaVersion !== 1 || !Array.isArray(data.issues)) throw Error('format');
      if (source.legacy && !B.validStore(data)) throw Error('format');
      for (const issue of data.issues) {
        if (!B.validStore({schemaVersion:1, serial:0, current:issue?.id, issues:[issue]})) throw Error('format');
      }
      // Pages contains the more recent editing workspace when both keys exist.
      for (const issue of data.issues) found.set(issue.id, B.clone(issue));
    } catch {
      errors.push(source.key);
    }
  }
  return {issues:[...found.values()].sort((a,b)=>b.date.localeCompare(a.date)), errors, fingerprint: fingerprints.join('\n')};
}

export function planMigration(localIssues, sharedIssues) {
  const existing = new Set(sharedIssues.map(issue => issue.id));
  return {
    available: localIssues.filter(issue => !existing.has(issue.id)),
    conflicts: localIssues.filter(issue => existing.has(issue.id)),
  };
}

export async function prepareCloudMigration({remote, B, directory, storage, force = false}) {
  const shared = await remote.call();
  const local = readLocalIssues({storage, B, directory});
  const {available, conflicts} = planMigration(local.issues, shared.issues);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(local.fingerprint)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const decisionKey = 'kpcstl.cloud-transfer.v1:' + directory.pathname;
  let reviewed = false;
  try { reviewed = storage.getItem(decisionKey) === digest; } catch {}
  if (shared.issues.length && ((!available.length && !local.errors.length) || (reviewed && !force))) return [];

  return new Promise(resolve => {
    const panel = document.createElement('dialog');
    panel.className = 'cloud-dialog';
    panel.setAttribute('aria-labelledby', 'migration-title');
    panel.innerHTML = `<div class="cloud-card"><p class="cloud-eyebrow">온라인 공유 시작</p><h2 id="migration-title">${available.length ? '이 기기의 주보를 옮길까요?' : '공유 보관함 준비'}</h2>
      <p>선택한 주보를 온라인 보관함에 초안으로 등록합니다. 이 브라우저의 원본은 그대로 남습니다. 공개하려면 검토 후 주보를 확정해 주세요.</p>
      ${local.errors.length ? '<p class="cloud-error" role="alert">일부 기기 자료를 읽지 못했습니다. 원본은 보존했습니다. 필요한 자료를 백업한 뒤 다시 확인해 주세요.</p>' : ''}
      ${available.length ? `<fieldset><legend>옮길 주보</legend>${available.map(i=>`<label class="cloud-choice"><input type="checkbox" name="migration-issue" value="${escape(i.id)}" checked><span>${escape(i.date)} · ${escape(i.sermon?.title || '제목 없음')}</span></label>`).join('')}</fieldset>` : ''}
      ${conflicts.length ? `<p>같은 날짜의 온라인 주보 ${conflicts.length}개는 덮어쓰지 않습니다: ${conflicts.map(i=>escape(i.date)).join(', ')}</p>` : ''}
      <div class="cloud-actions">${available.length ? '<button type="button" class="btn primary" data-transfer="selected">선택한 주보 옮기기</button>' : ''}
      ${shared.issues.length ? '<button type="button" class="btn" data-transfer="skip">공유 보관함 열기</button>' : '<button type="button" class="btn" data-transfer="example">예시 주보로 시작</button>'}
      <a class="btn" href="./">공개 주보 보기</a></div><p class="cloud-help">예시 이름: 박태진 목사 · 온라인 저장 후 다른 기기의 편집자도 같은 내용을 볼 수 있습니다.</p></div>`;
    const complete = (issues, skip = false) => {
      // A selected transfer is not complete until the server accepts it. Leaving
      // it unmarked allows retries after offline or partially successful imports.
      if (skip) try { storage.setItem(decisionKey, digest); } catch {}
      panel.close(); panel.remove(); resolve(issues);
    };
    panel.addEventListener('cancel', event => event.preventDefault());
    panel.addEventListener('click', event => {
      const action = event.target.closest('[data-transfer]')?.dataset.transfer;
      if (action === 'skip') complete([], true);
      if (action === 'example') complete(B.createStore().issues);
      if (action === 'selected') {
        const selected = new Set([...panel.querySelectorAll('input:checked')].map(input => input.value));
        const issues = available.filter(issue => selected.has(issue.id));
        if (issues.length) complete(issues);
      }
    });
    document.body.append(panel);
    panel.showModal();
  });
}
