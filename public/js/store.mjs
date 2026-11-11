// Working state for the active shift, device storage and the autosave engine (plan section 10.6).
// IndexedDB holds answers (key learnerId:attemptId) and the Messages unread flag. Nothing else is stored.
import { api, ApiError } from './api.mjs';

const DB_NAME = 'harbourdesk';
const WORK = 'work';
const META = 'meta';

// ---------- IndexedDB, with a memory fallback when the browser blocks it ----------
let dbPromise = null;
const memory = new Map();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(WORK);
        req.result.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}
async function idbGet(storeName, key) {
  const db = await openDb();
  if (!db) return memory.get(`${storeName}:${key}`) ?? null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(storeName).objectStore(storeName).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function idbPut(storeName, key, value) {
  const db = await openDb();
  if (!db) { memory.set(`${storeName}:${key}`, value); return; }
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    } catch { memory.set(`${storeName}:${key}`, value); resolve(); }
  });
}
async function idbDelete(storeName, key) {
  const db = await openDb();
  if (!db) { memory.delete(`${storeName}:${key}`); return; }
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    } catch { resolve(); }
  });
}

// ---------- state ----------
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (type) => listeners.forEach((fn) => { try { fn(type); } catch (e) { console.error(e); } });

export const store = {
  learner: null,
  attempts: null,
  active: null, // { attemptId, attemptNo, startedAt, deadlineAt, revision, options }
  work: { tickets: {}, articles: {} },
  saveState: 'saved', // device | syncing | saved | offline
  messagesRead: false
};

let handlers = { onEnded: () => {}, onReplaced: () => {} };
export const setHandlers = (h) => { handlers = { ...handlers, ...h }; };

const dirty = new Map(); // "t:3" -> version counter
let version = 0;
let timer = null;
let inflight = null;
let failures = 0;

const localKey = () => `${store.learner.id}:${store.active.attemptId}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

// Reapply only locally dirty records over a newer server snapshot. This keeps local
// unsynced answers while retaining unrelated work saved by another tab/device.
function overlayDirtyWork(target, source, keys) {
  for (const key of keys) {
    const [kind, n] = key.split(':');
    const section = kind === 't' ? 'tickets' : kind === 'a' ? 'articles' : null;
    if (!section || !Object.hasOwn(source?.[section] || {}, n)) continue;
    target[section][n] = clone(source[section][n]);
  }
  return target;
}

function persist() {
  if (!store.active) return Promise.resolve();
  return idbPut(WORK, localKey(), { revision: store.active.revision, work: store.work, dirty: [...dirty.keys()], at: Date.now() });
}

export function setSaveState(s) {
  if (store.saveState === s) return;
  store.saveState = s;
  emit('save');
}

// Called with the server state at sign in and on every page load.
export async function hydrate(state) {
  store.learner = state.learner;
  store.attempts = state.attempts;
  store.messagesRead = !!(await idbGet(META, `messagesRead:${state.learner.id}`));
  dirty.clear();
  if (!state.active) { store.active = null; store.work = { tickets: {}, articles: {} }; emit('state'); return; }
  const a = state.active;
  store.active = { attemptId: a.attemptId, attemptNo: a.attemptNo, startedAt: a.startedAt, deadlineAt: a.deadlineAt, revision: a.revision, options: a.options };
  store.work = { tickets: a.work.tickets || {}, articles: a.work.articles || {} };

  const local = await idbGet(WORK, localKey());
  if (local?.dirty?.length && local.work) {
    // Recover unsynced edits even if another device advanced the server revision.
    // The local dirty records are replayed on top of current server work and saved
    // against the server's latest revision by the normal optimistic sync flow.
    overlayDirtyWork(store.work, local.work, local.dirty);
    for (const k of local.dirty) {
      if (/^[ta]:(?:[1-9]|1[0-2])$/.test(k) || k === 'a:1' || k === 'a:2') dirty.set(k, ++version);
    }
    if (dirty.size) {
      setSaveState('device');
      await persist();
      scheduleSync(0);
    } else {
      setSaveState('saved');
      await persist();
    }
  } else {
    setSaveState('saved');
    await persist();
  }
  emit('state');
}

export async function clearLocal() {
  clearTimeout(timer);
  if (store.learner && store.active) await idbDelete(WORK, localKey());
  dirty.clear();
  store.active = null;
  store.work = { tickets: {}, articles: {} };
  setSaveState('saved');
}

// ---------- reading work ----------
export const emptyTicket = () => ({ requester: null, status: null, priority: null, team: null, sla: null, tags: [], finding: null, action: null, ownerTime: null });
export const emptyArticle = () => ({ tickets: [], title: null, issue: null, environment: null, steps: [null, null, null, null, null, null], verification: null, stop: null, leaveOut: [] });
export const getTicket = (n) => ({ ...emptyTicket(), ...(store.work.tickets[String(n)] || {}) });
export const getArticle = (n) => {
  const a = { ...emptyArticle(), ...(store.work.articles[String(n)] || {}) };
  a.steps = Array.from({ length: 6 }, (_, i) => a.steps?.[i] ?? null);
  return a;
};

export function ticketProgress(n) {
  const t = getTicket(n);
  const filled = ['requester', 'status', 'priority', 'team', 'sla', 'finding', 'action', 'ownerTime'].filter((f) => t[f]).length + (t.tags.length ? 1 : 0);
  return { filled, total: 9, complete: filled === 9 };
}
export function completeTicketCount() {
  let c = 0;
  for (let n = 1; n <= 12; n++) if (ticketProgress(n).complete) c++;
  return c;
}
export function articleParts(n) {
  const a = getArticle(n);
  return [
    ['tickets', 'Tickets covered', a.tickets.length >= 1],
    ['title', 'Title', !!a.title],
    ['issue', 'Issue', !!a.issue],
    ['environment', 'Environment', !!a.environment],
    ['steps', 'Steps', a.steps.every(Boolean)],
    ['verification', 'Verification', !!a.verification],
    ['stop', 'Stop condition', !!a.stop],
    ['leaveOut', 'Details to leave out', a.leaveOut.length >= 1]
  ];
}

// ---------- changing work ----------
export function updateTicket(n, patch) {
  const next = { ...getTicket(n), ...patch };
  store.work.tickets[String(n)] = next;
  touch(`t:${n}`);
}
export function updateArticle(n, patch) {
  const next = { ...getArticle(n), ...patch };
  store.work.articles[String(n)] = next;
  touch(`a:${n}`);
}
function touch(key) {
  dirty.set(key, ++version);
  setSaveState('device');
  persist();
  emit('work');
  scheduleSync(1500);
}

// ---------- sync ----------
const RETRY = [2000, 4000, 8000];
function scheduleSync(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => { sync(); }, ms);
}

export async function sync() {
  if (inflight) return inflight;
  if (!store.active || dirty.size === 0) { if (store.saveState !== 'offline') setSaveState('saved'); return; }
  inflight = (async () => {
    const sent = new Map(dirty);
    const changes = { tickets: {}, articles: {} };
    for (const k of sent.keys()) {
      const [kind, n] = k.split(':');
      if (kind === 't') changes.tickets[n] = clone(getTicket(n));
      else changes.articles[n] = clone(getArticle(n));
    }
    setSaveState('syncing');
    try {
      const res = await api.save(store.active.attemptId, store.active.revision, changes);
      if (res.ended) { handlers.onEnded(res.closeout); return; }
      failures = 0;
      store.active.revision = res.revision;
      for (const [k, v] of sent) if (dirty.get(k) === v) dirty.delete(k);
      await persist();
      if (dirty.size) { setSaveState('device'); scheduleSync(0); } else setSaveState('saved');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Refresh from the newer server revision, but do not discard locally dirty
        // answers. Replay those records through the regular save path instead.
        store.active.revision = err.data.revision;
        const serverWork = {
          tickets: err.data.work?.tickets || {},
          articles: err.data.work?.articles || {}
        };
        store.work = overlayDirtyWork(serverWork, store.work, dirty.keys());
        await persist();
        failures = 0;
        setSaveState('device');
        emit('work');
        scheduleSync(0);
      } else if (err instanceof ApiError && err.status === 401) {
        handlers.onEnded(null);
      } else if (err instanceof ApiError && err.status === 400) {
        // Keep rejected local work for recovery; do not silently discard student answers.
        await persist();
        setSaveState('offline');
        handlers.onReplaced('error');
      } else {
        setSaveState('offline');
        // Retry after 2, 4 and 8 seconds, then every 15 seconds.
        scheduleSync(failures < RETRY.length ? RETRY[failures] : 15000);
        failures++;
      }
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

// Finish pending sync before closeout. Gives up after a short wait if the connection is down.
export async function flush(maxMs = 4000) {
  clearTimeout(timer);
  const end = Date.now() + maxMs;
  while (dirty.size && Date.now() < end && store.active) {
    await sync();
    if (store.saveState === 'offline') break;
  }
}

export function onLeave() {
  if (dirty.size) sync();
}
window.addEventListener('blur', onLeave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onLeave(); });
window.addEventListener('online', () => { if (dirty.size) scheduleSync(0); });
window.addEventListener('offline', () => { if (store.active) setSaveState('offline'); });

// ---------- messages unread flag ----------
export async function markMessagesRead() {
  if (store.messagesRead || !store.learner) return;
  store.messagesRead = true;
  await idbPut(META, `messagesRead:${store.learner.id}`, true);
  emit('messages');
}
