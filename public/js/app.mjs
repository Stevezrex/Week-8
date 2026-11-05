// HarbourDesk learner app: hash router, workspace shell, countdown and shift closeout.
import { h, clear, icon, toast, announce, openDialog, initialsAvatar } from './ui.mjs';
import { api, ApiError } from './api.mjs';
import { store, hydrate, subscribe, setHandlers, flush, clearLocal, completeTicketCount, markMessagesRead } from './store.mjs';
import { startTimer, pillIcon, pillText } from './timer.mjs';

const appEl = document.getElementById('app');

// ---------- scenario data, loaded once ----------
let dataPromise = null;
export function loadData() {
  if (!dataPromise) {
    dataPromise = Promise.all(['contacts', 'customers', 'hub'].map((n) => fetch(`/data/${n}.json`).then((r) => r.json())))
      .then(([contacts, customers, hub]) => ({ contacts: contacts.contacts, customers, hub }));
  }
  return dataPromise;
}

// ---------- routes ----------
const VIEWS = {
  start: () => import('./views/start.mjs'),
  queue: () => import('./views/queue.mjs'),
  ticket: () => import('./views/ticket.mjs'),
  customers: () => import('./views/customers.mjs'),
  messages: () => import('./views/messages.mjs'),
  hub: () => import('./views/hub.mjs'),
  kb: () => import('./views/kb.mjs'),
  register: () => import('./views/register.mjs'),
  'shift-ended': () => import('./views/shift-ended.mjs')
};
const FULL_PAGE = new Set(['start', 'shift-ended']);

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || '', params: parts.slice(1), query: new URLSearchParams(query) };
}
export const navigate = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

// ---------- session state ----------
let serverState = null; // last state from the server, used by the start screen
export const getServerState = () => serverState;

async function refreshState() {
  try {
    const state = await api.state();
    if (state.ended) { serverState = null; await endShift(state.closeout); return null; }
    serverState = state;
    await hydrate(state);
    return state;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { serverState = null; return null; }
    throw err;
  }
}

export async function signedIn(state) {
  serverState = state;
  await hydrate(state);
}

// ---------- shift closeout ----------
let closing = false;
let stopTimer = null;

export async function requestLogout() {
  const choice = await openDialog({
    title: 'Log out now?',
    text: 'Your latest saved work will be recorded for the case record audit.',
    buttons: [{ label: 'Log out', cls: 'btn-danger' }, { label: 'Keep working', cls: 'btn-secondary', cancel: true }]
  });
  if (choice === 0) await closeout('logout');
}

async function closeout(reason) {
  if (closing || !store.active) return;
  closing = true;
  const attemptId = store.active.attemptId;
  for (;;) {
    await flush(reason === 'deadline' ? 3000 : 4000);
    try {
      const res = await api.submit(attemptId, reason);
      closing = false;
      await endShift(res.closeout);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { closing = false; await endShift(null); return; }
      toast('HarbourDesk could not complete that request. Your local work is saved and will sync when the connection returns.', { kind: 'w5', ic: 'triangle-alert', timeout: 8000 });
      if (reason !== 'deadline') { closing = false; return; }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function endShift(closeoutInfo) {
  stopTimer?.();
  stopTimer = null;
  await clearLocal();
  serverState = null;
  unmountShell();
  if (!closeoutInfo) { navigate('#/start'); return; }
  navigate(`#/shift-ended?left=${closeoutInfo.attemptsRemaining}`);
}

setHandlers({
  onEnded: (c) => endShift(c),
  onReplaced: (kind) => {
    toast(kind === 'error'
      ? 'HarbourDesk could not complete that request. Your local work is saved and will sync when the connection returns.'
      : 'This shift was updated on another device. Your screen now shows the latest saved version.', { kind: 'info', ic: 'info' });
    route();
  }
});

// ---------- workspace shell ----------
let shell = null;

const NAV = [
  { group: 'Work', items: [
    { href: '#/queue', key: 'queue', label: 'My Queue', ic: 'inbox', count: true },
    { href: '#/register', key: 'register', label: 'Ticket Register', ic: 'table-2' }] },
  { group: 'Customers', items: [{ href: '#/customers', key: 'customers', label: 'Customer Search', ic: 'users' }] },
  { group: 'Team', items: [{ href: '#/messages', key: 'messages', label: 'Messages', ic: 'message-square', badge: true }] },
  { group: 'Reference', items: [
    { href: '#/hub', key: 'hub', label: 'Harbourline Hub', ic: 'building-2' },
    { href: '#/kb', key: 'kb', label: 'Knowledge Base', ic: 'book-open' }] }
];
const TABS = [
  { href: '#/queue', key: 'queue', label: 'My Queue', ic: 'inbox' },
  { href: '#/customers', key: 'customers', label: 'Customers', ic: 'users' },
  { href: '#/messages', key: 'messages', label: 'Messages', ic: 'message-square', badge: true },
  { href: '#/hub', key: 'hub', label: 'Hub', ic: 'building-2' }
];

function mountShell() {
  if (shell) return shell;
  clear(appEl);
  const l = store.learner;

  const railLinks = [];
  const railEl = h('nav', { class: 'rail on-dark', 'aria-label': 'Primary', id: 'rail' },
    h('div', { class: 'row spread' },
      h('a', { class: 'brand', href: '#/queue', 'aria-label': 'HarbourDesk, My Queue' },
        h('img', { src: '/img/logo.svg', alt: '', width: 36, height: 36 }), h('span', { class: 'brand-name', text: 'HarbourDesk' })),
      h('button', { type: 'button', class: 'btn btn-quiet rail-close', 'aria-label': 'Close menu', onclick: () => closeRail() }, icon('x', 'icon-24'))),
    NAV.map((g) => h('div', { class: 'rail-group' },
      h('p', { class: 'rail-label', text: g.group }),
      g.items.map((it) => {
        const a = h('a', { class: 'rail-item', href: it.href, 'data-key': it.key, 'aria-label': it.label, onclick: () => closeRail() },
          icon(it.ic), h('span', { class: 'lbl', text: it.label }),
          it.count ? h('span', { class: 'rail-count', 'data-role': 'count' }) : null,
          it.badge ? h('span', { class: 'rail-badge', 'data-role': 'badge', 'aria-label': '1 unread message', text: '1' }) : null,
          h('span', { class: 'rail-tip', 'aria-hidden': 'true', text: it.label }));
        railLinks.push(a);
        return a;
      }))),
    h('div', { class: 'rail-spacer' }),
    h('div', { class: 'shift-card' },
      h('div', { class: 'who' }, initialsAvatar(l.name, 32),
        h('div', { class: 'who-text' }, h('div', { class: 'who-name', text: l.name }),
          h('div', { class: 'who-sub', 'data-role': 'attempt', text: `Monday shift. Attempt ${store.active.attemptNo} of 3` }))),
      h('button', { type: 'button', class: 'btn btn-logout', 'aria-label': 'Log out', onclick: () => requestLogout() }, icon('log-out', 'icon-20'), h('span', { class: 'lbl', text: 'Log out' }))));

  const scrim = h('div', { class: 'rail-scrim', onclick: () => closeRail() });

  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
  const pill = h('span', { class: 'pill pill-normal', 'data-role': 'pill' });
  const save = h('span', { class: 'savestat', 'data-role': 'save' });
  const topbar = h('header', { class: 'topbar' },
    h('button', { type: 'button', class: 'btn btn-quiet menu-btn', 'aria-label': 'Open menu', 'aria-controls': 'rail', onclick: () => openRail() }, icon('menu', 'icon-24')),
    h('span', { class: 'topbar-mark' }, h('img', { src: '/img/logo.svg', alt: 'Harbourline', width: 32, height: 32 })),
    crumbs,
    h('div', { class: 'topbar-right' }, pill, save, initialsAvatar(l.name, 32)));

  const main = h('main', { id: 'main', class: 'content', tabindex: '-1' });
  const tabLinks = [];
  const tabbar = h('nav', { class: 'tabbar on-dark', 'aria-label': 'Primary' },
    TABS.map((t) => {
      const a = h('a', { class: 'tab', href: t.href, 'data-key': t.key }, icon(t.ic), t.label,
        t.badge ? h('span', { class: 'rail-badge', 'data-role': 'badge', 'aria-label': '1 unread message', text: '1' }) : null);
      tabLinks.push(a);
      return a;
    }),
    h('button', { type: 'button', class: 'tab', 'data-key': 'more', onclick: () => openMore() }, icon('menu'), 'More'));

  appEl.append(h('div', { class: 'shell' }, h('div', { class: 'rail-slot' }, railEl), h('div', { class: 'main-col' }, topbar, main)), scrim, tabbar);
  shell = { railEl, scrim, crumbs, pill, save, main, railLinks, tabLinks, tabbar, unsub: null };
  updateRailState();
  updateSave();

  shell.unsub = subscribe((type) => {
    if (type === 'save') updateSave();
    if (type === 'work' || type === 'state') updateRailState();
    if (type === 'messages') updateRailState();
  });

  stopTimer = startTimer(store.active.deadlineAt, {
    onTick: (remaining, level) => {
      if (!shell) return;
      shell.pill.className = `pill pill-${level}`;
      shell.pill.replaceChildren(icon(pillIcon(level)), pillText(remaining));
    },
    onWarn: (w) => {
      toast(w.text, { kind: w.kind, ic: w.ic, timeout: w.level === 'w5' ? 0 : 10000 });
      announce(w.text, w.assertive);
    },
    onExpire: () => { closeout('deadline'); }
  });
  document.addEventListener('keydown', onEsc);
  return shell;
}

function unmountShell() {
  if (!shell) return;
  shell.unsub?.();
  document.removeEventListener('keydown', onEsc);
  shell = null;
  clear(appEl);
}

function onEsc(e) { if (e.key === 'Escape' && shell?.railEl.classList.contains('is-open')) closeRail(); }
function openRail() { shell.railEl.classList.add('is-open'); shell.scrim.classList.add('is-open'); shell.railEl.querySelector('a, button')?.focus(); }
function closeRail() {
  if (!shell) return;
  const wasOpen = shell.railEl.classList.contains('is-open');
  shell.railEl.classList.remove('is-open'); shell.scrim.classList.remove('is-open');
  if (wasOpen) document.querySelector('.menu-btn')?.focus();
}

function openMore() {
  const opener = document.activeElement;
  const close = () => { scrim.remove(); sheet.remove(); document.removeEventListener('keydown', onKey, true); opener?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'More' },
    h('a', { class: 'rail-item', href: '#/kb', onclick: close }, icon('book-open'), 'Knowledge Base'),
    h('a', { class: 'rail-item', href: '#/register', onclick: close }, icon('table-2'), 'Ticket Register'),
    h('button', { type: 'button', class: 'rail-item', onclick: () => { close(); requestLogout(); } }, icon('log-out'), 'Log out'),
    h('button', { type: 'button', class: 'btn btn-secondary', onclick: close }, 'Close'));
  const scrim = h('div', { class: 'scrim', onclick: close });
  document.body.append(scrim, sheet);
  document.addEventListener('keydown', onKey, true);
  sheet.querySelector('a').focus();
}

function updateSave() {
  if (!shell) return;
  const s = store.saveState;
  const map = {
    device: ['cloud-upload', 'Saved on this device'],
    syncing: ['cloud-upload', 'Syncing'],
    saved: ['cloud-check', 'Saved to HarbourDesk'],
    offline: ['wifi-off', 'Connection unavailable. Local changes will sync when the connection returns.']
  };
  const [ic, text] = map[s];
  shell.save.className = `savestat${s === 'offline' ? ' is-offline' : ''}`;
  shell.save.setAttribute('role', 'status');
  shell.save.replaceChildren(icon(ic, 'icon-20'), h('span', { class: 'st-text', text }));
  if (s === 'offline') shell.save.setAttribute('aria-label', text); else shell.save.removeAttribute('aria-label');
}

function updateRailState() {
  if (!shell) return;
  const left = 12 - completeTicketCount();
  for (const el of shell.railEl.querySelectorAll('[data-role="count"]')) {
    el.textContent = String(left);
    el.setAttribute('aria-label', `${left} case records not yet complete`);
  }
  for (const el of document.querySelectorAll('[data-role="badge"]')) el.hidden = store.messagesRead;
}

function markCurrent(name) {
  if (!shell) return;
  const key = name === 'ticket' ? 'queue' : name;
  for (const a of [...shell.railLinks, ...shell.tabLinks]) {
    if (a.dataset.key === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const more = shell.tabbar.querySelector('[data-key="more"]');
  if (more) { if (key === 'kb' || key === 'register') more.setAttribute('aria-current', 'page'); else more.removeAttribute('aria-current'); }
}

function setCrumbs(list) {
  shell.crumbs.replaceChildren(...list.flatMap((c, i) => {
    const last = i === list.length - 1;
    const node = last ? h('span', { 'aria-current': 'page', text: c.label }) : h('a', { href: c.href, text: c.label });
    return last ? [node] : [node, icon('chevron-right')];
  }));
}

// ---------- router ----------
let routeToken = 0;
let firstRoute = true;
let cleanup = null;
const runCleanup = () => { try { cleanup?.(); } catch (e) { console.error(e); } cleanup = null; };

export async function route() {
  const token = ++routeToken;
  const { name, params, query } = parseHash();

  if (!name) { navigate(store.active ? '#/queue' : '#/start'); return; }
  if (!VIEWS[name]) { navigate(store.active ? '#/queue' : '#/start'); return; }

  const full = FULL_PAGE.has(name);
  if (!full && !store.active) { navigate('#/start'); return; }

  const mod = await VIEWS[name]();
  if (token !== routeToken) return;
  const ctx = { store, navigate, loadData, params, query, requestLogout, signedIn, refreshState, getServerState, markMessagesRead };

  if (full) {
    runCleanup();
    unmountShell();
    stopTimer?.(); stopTimer = null;
    clear(appEl);
    const view = await mod.render(ctx);
    if (token !== routeToken) return;
    document.title = `${view.title} | HarbourDesk`;
    appEl.append(view.el);
    cleanup = view.cleanup || null;
    firstRoute = false;
    view.afterMount?.();
    return;
  }

  mountShell();
  closeRail();
  const view = await mod.render(ctx);
  if (token !== routeToken) return;
  runCleanup();
  cleanup = view.cleanup || null;
  shell.main.replaceChildren(view.el);
  shell.main.classList.remove('view-in'); void shell.main.offsetWidth; shell.main.classList.add('view-in');
  document.title = `${view.title} | HarbourDesk`;
  setCrumbs(view.crumbs);
  markCurrent(name);
  if (!firstRoute) { shell.main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  firstRoute = false;
  view.afterMount?.();
}

window.addEventListener('hashchange', route);

// The skip link needs a focus target on the start screen too.
async function boot() {
  try { await refreshState(); } catch { /* start screen handles a failed state call */ }
  await route();
}
boot();
