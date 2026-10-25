/* GitHub Pages stores this workspace in this browser only. No server identity or sync. */
export function createPagesStore({
  storage, locks, domain, B, key = 'kpcstl.github-pages.v1',
  id = () => crypto.randomUUID(), now = () => new Date().toISOString()
}) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = (message, status = 400, current) => {
    const error = new Error(message);
    Object.assign(error, {status, ...(current ? {current: copy(current)} : {})});
    return error;
  };
  const required = condition => { if (!condition) throw Error('Invalid browser workspace'); };
  const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
  const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

  function validateIssue(issue) {
    domain.validateIssue(issue);
    required(Number.isSafeInteger(issue.version) && issue.version > 0);
    required(validId(issue.coordinatorId) && validTime(issue.updatedAt));
    required(record(issue.tasks) && Object.keys(issue.tasks).length === Object.keys(domain.areas).length);
    for (const section of Object.keys(domain.areas)) {
      const task = issue.tasks[section];
      required(record(task) && ['todo', 'progress', 'done'].includes(task.status));
      required(task.assigneeId === null || validId(task.assigneeId));
    }
    required(Array.isArray(issue.activity) && Array.isArray(issue.publications) && Array.isArray(issue.appliedCommands));
    required(issue.appliedCommands.every(commandId => typeof commandId === 'string' && commandId.length > 0 && commandId.length <= 100));
    required(issue.publications.every(publication => record(publication) && Number.isSafeInteger(publication.version) && publication.version > 0 && publication.version <= issue.version));
    required(new Set(issue.publications.map(publication => publication.version)).size === issue.publications.length);
    required(['draft', 'finalized'].includes(issue.status));
    if (issue.finalization !== null) {
      required(record(issue.finalization) && issue.status === 'finalized');
      required(issue.publications.some(publication => publication.version === issue.finalization.version));
    } else required(issue.status !== 'finalized');
  }

  function validateState(state) {
    required(record(state) && state.schemaVersion === 1 && validId(state.userId));
    if (state.profile !== null) {
      required(record(state.profile) && state.profile.id === state.userId);
      required(domain.actorName(state.profile.name) === state.profile.name);
      required(validTime(state.profile.createdAt) && validTime(state.profile.updatedAt));
    }
    required(Array.isArray(state.issues) && record(state.versions));
    required(state.profile !== null || state.issues.length === 0);
    const ids = new Set();
    for (const issue of state.issues) {
      validateIssue(issue);
      required(!ids.has(issue.id));
      ids.add(issue.id);
      for (const publication of issue.publications) {
        required(Object.hasOwn(state.versions, issue.id) && Object.hasOwn(state.versions[issue.id], String(publication.version)));
      }
    }
    for (const [issueId, versions] of Object.entries(state.versions)) {
      required(B.validDate(issueId) && ids.has(issueId) && record(versions));
      const current = state.issues.find(issue => issue.id === issueId);
      for (const [version, snapshot] of Object.entries(versions)) {
        validateIssue(snapshot);
        required(snapshot.id === issueId && String(snapshot.version) === version);
        required(snapshot.finalization?.version === snapshot.version && snapshot.status === 'finalized');
        required(current.publications.some(publication => String(publication.version) === version));
      }
    }
    return state;
  }

  function readState() {
    let raw;
    try { raw = storage.getItem(key); }
    catch (cause) {
      const error = fail('이 브라우저의 저장소를 읽지 못했습니다. 저장소 사용 권한을 확인해 주세요.', 503);
      error.cause = cause;
      throw error;
    }
    if (raw === null) {
      const userId = typeof id === 'function' ? id() : id;
      required(validId(userId));
      return {state: {schemaVersion: 1, userId, profile: null, issues: [], versions: {}}, fresh: true};
    }
    try { return {state: validateState(JSON.parse(raw)), fresh: false}; }
    catch (cause) {
      const error = fail('이 브라우저의 저장 자료를 읽을 수 없습니다. 기존 자료는 보존했습니다. 브라우저 자료를 지우기 전에 백업을 확인해 주세요.', 422);
      error.cause = cause;
      throw error;
    }
  }

  function writeState(state) {
    try { storage.setItem(key, JSON.stringify(state)); }
    catch (cause) {
      const error = fail('저장하지 못했습니다. 이 브라우저의 저장 공간이나 저장소 사용 권한을 확인해 주세요. 이전 저장 자료는 유지됩니다.', 507);
      error.cause = cause;
      throw error;
    }
  }

  // The callback is synchronous: fallback transactions never yield between read and write.
  async function transaction(operation) {
    const run = () => {
      const {state, fresh} = readState();
      const {value, changed = false} = operation(state);
      if (fresh || changed) writeState(state);
      return copy(value);
    };
    return locks && typeof locks.request === 'function'
      ? locks.request('kpcstl-pages-store:' + key, {mode: 'exclusive'}, run)
      : run();
  }

  function existing(state, issueId) {
    const issue = state.issues.find(item => item.id === issueId);
    if (!issue) throw fail('주보를 찾을 수 없습니다.', 404);
    return issue;
  }

  function saveIssue(state, issue) {
    const index = state.issues.findIndex(item => item.id === issue.id);
    if (index < 0) state.issues.push(issue);
    else state.issues[index] = issue;
    // Keep immutable publication copies, not a full document for every autosave.
    if (issue.finalization?.version === issue.version) {
      if (!Object.hasOwn(state.versions, issue.id)) state.versions[issue.id] = Object.create(null);
      const versions = state.versions[issue.id];
      if (Object.hasOwn(versions, String(issue.version))) throw fail('이미 저장된 확정본은 덮어쓸 수 없습니다.');
      versions[String(issue.version)] = copy(issue);
    }
    return {value: {issue}, changed: true};
  }

  async function call(command) {
    try { return await transaction(state => {
      if (!command) return {value: {
        user: {id: state.userId, name: state.profile?.name || '', email: ''},
        profile: state.profile, members: state.profile ? [state.profile] : [],
        issues: [...state.issues].sort((a, b) => b.id.localeCompare(a.id))
      }};
      if (!record(command)) throw fail('잘못된 요청 형식입니다.');
      const at = now();
      if (command.op === 'profile') {
        const name = domain.actorName(command.name);
        state.profile = {id: state.userId, name, createdAt: state.profile?.createdAt || at, updatedAt: at};
        return {value: {profile: state.profile, members: [state.profile]}, changed: true};
      }
      const actor = state.profile;
      if (!actor) throw fail('먼저 표시 이름을 등록해 주세요.', 428);
      if (typeof command.commandId !== 'string' || !command.commandId || command.commandId.length > 100) throw fail('변경 식별자가 필요합니다.');
      if (command.op === 'import') {
        const issue = domain.initializeIssue(command.issue, actor, at);
        const previous = state.issues.find(item => item.id === issue.id);
        if (previous) throw fail('같은 날짜의 주보가 이미 있습니다. 기존 주보를 덮어쓰지 않았습니다.', 409, previous);
        return saveIssue(state, issue);
      }
      const previous = existing(state, command.issueId);
      if (command.op === 'new-week') {
        const duplicate = state.issues.find(item => item.id === command.date);
        if (duplicate) throw fail('이미 같은 주의 주보가 있습니다.', 409, duplicate);
        const temporary = {schemaVersion: 1, serial: 0, current: previous.id, issues: [previous]};
        const next = B.duplicate(temporary, previous.id, command.date).issues[1];
        const issue = domain.initializeIssue(next, actor, at);
        issue.coordinatorId = previous.coordinatorId;
        for (const section of Object.keys(issue.tasks)) issue.tasks[section].assigneeId = previous.tasks[section]?.assigneeId || null;
        return saveIssue(state, issue);
      }
      let result;
      try { result = domain.applyCommand(previous, command, actor, [actor], at); }
      catch (error) {
        if (error.status === 409) throw fail(error.message, 409, previous);
        throw error;
      }
      return result.duplicate ? {value: {issue: previous}} : saveIssue(state, result.issue);
    }); } catch (error) {
      if (!error.status) error.status = 400;
      throw error;
    }
  }

  const getVersion = (issueId, version) => transaction(state => {
    const versions = Object.hasOwn(state.versions, issueId) ? state.versions[issueId] : null;
    if (!Number.isSafeInteger(Number(version)) || Number(version) < 1 || !versions || !Object.hasOwn(versions, String(version))) throw fail('해당 확정 기록을 찾을 수 없습니다.', 404);
    return {value: {issue: versions[String(version)]}};
  });
  const getBackup = () => transaction(state => ({value: state}));
  return {call, getVersion, getBackup};
}
