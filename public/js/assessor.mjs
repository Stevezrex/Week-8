// Assessor page: Roster, Learner, Shift, Identity review, Key and rubric, Export.
import { h, clear, icon, toast, openDialog, initialsAvatar, fmtDateTime, emptyState } from './ui.mjs';

const appEl = document.getElementById('app');

// ---------- API ----------
async function call(method, path, body) {
  const res = await fetch(`/api/assessor${path}`, {
    method, credentials: 'same-origin',
    headers: { 'X-HarbourDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    const err = new Error(data.error || `http_${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return res;
}
const getJson = async (p) => (await call('GET', p)).json();

// ---------- small pieces ----------
const KIND = {
  entered: 'Entered', started: 'Started shift', resumed: 'Resumed shift', submitted_logout: 'Submitted at log out',
  submitted_deadline: 'Submitted at deadline', forms_submitted: 'Netlify Forms submission sent',
  forms_delivery_failed: 'Netlify Forms submission failed', merged: 'Merged learner'
};
const FORMS = { ok: ['circle-check', 'Logged'], failed: ['triangle-alert', 'Failed'], pending: ['hourglass', 'Pending'], none: ['circle-dashed', 'Not due'] };
const formsChip = (status, detail) => {
  const [ic, text] = FORMS[status] || FORMS.none;
  return h('span', { class: `chip forms-${status}`, title: detail || null }, icon(ic), text);
};
const fmtNum = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2).replace(/\.?0+$/, '') || '0');
const bar = (value, max) => h('span', { class: 'bar' }, h('span', { class: 'num', text: fmtNum(value) }),
  (() => { const s = h('span'); s.style.width = `${max ? Math.min(100, (value / max) * 100) : 0}%`; return h('span', { class: 'bar-track', 'aria-hidden': 'true' }, s); })());
const table = (head, rows, cls = '') => h('div', { class: 'table-wrap' }, h('table', { class: `tbl ${cls}` },
  h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col', text: t })))), h('tbody', {}, rows)));
const dash = (v) => (v === null || v === undefined || v === '' ? '-' : v);
const reasonText = (r) => (r === 'logout' ? 'Log out' : r === 'deadline' ? 'Deadline' : '-');

// ---------- shell ----------
const NAV = [
  ['roster', 'Roster', 'users'], ['learner', 'Learner', 'layout-list'], ['shift', 'Shift', 'table-2'],
  ['identity', 'Identity review', 'user-round-x'], ['key', 'Key and rubric', 'file-text'], ['export', 'Export', 'arrow-right']
];
let shell = null;

function mountShell() {
  if (shell) return shell;
  clear(appEl);
  const signOut = async () => { try { await call('POST', '/signout'); } catch { /* ignore */ } location.reload(); };
  const links = NAV.map(([key, label, ic]) => h('a', { class: 'rail-item', href: `#/${key}`, 'data-key': key, 'aria-label': label },
    icon(ic), h('span', { class: 'lbl', text: label }), h('span', { class: 'rail-tip', 'aria-hidden': 'true', text: label })));
  const rail = h('nav', { class: 'rail on-dark', 'aria-label': 'Assessor' },
    h('a', { class: 'brand', href: '#/roster', 'aria-label': 'HarbourDesk Assessor, Roster' }, h('img', { src: '/img/logo.svg', alt: '', width: 36, height: 36 }), h('span', { class: 'brand-name', text: 'HarbourDesk Assessor' })),
    h('div', { class: 'rail-group' }, links),
    h('div', { class: 'rail-spacer' }),
    h('div', { class: 'shift-card' }, h('button', { type: 'button', class: 'btn btn-logout', 'aria-label': 'Sign out', onclick: signOut }, icon('log-out', 'icon-20'), h('span', { class: 'lbl', text: 'Sign out' }))));
  const navSelect = h('select', { class: 'select a-nav-select', 'aria-label': 'Assessor view', onchange: (e) => { location.hash = `#/${e.target.value}`; } },
    NAV.map(([key, label]) => h('option', { value: key, text: label })));
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
  const main = h('main', { id: 'main', class: 'content', tabindex: '-1' });
  appEl.append(h('div', { class: 'shell' }, h('div', { class: 'rail-slot' }, rail),
    h('div', { class: 'main-col' }, h('header', { class: 'topbar' }, h('span', { class: 'topbar-mark' }, h('img', { src: '/img/logo.svg', alt: 'Harbourline', width: 32, height: 32 })), crumbs, h('div', { class: 'topbar-right' }, navSelect, h('button', { type: 'button', class: 'btn btn-quiet a-signout', 'aria-label': 'Sign out', onclick: signOut }, icon('log-out', 'icon-24')))), main)));
  shell = { links, crumbs, main, navSelect };
  return shell;
}

// ---------- views ----------
async function roster() {
  const { learners } = await getJson('/roster');
  const rows = learners.map((l) => h('tr', {},
    h('td', { class: 'cell-first' }, h('div', { class: 'cell-person' }, initialsAvatar(l.name, 24),
      h('div', {}, h('a', { href: `#/learner/${l.id}`, text: l.name }), h('span', { class: 't-caption', text: l.email || '' })))),
    h('td', {}, l.status === 'provisional' ? h('span', { class: 'chip ac-Unverified' }, icon('triangle-alert'), 'Provisional') : h('span', { class: 'muted', text: 'Active' })),
    h('td', { class: 'num', 'data-label': 'Shifts used', text: `${l.submitted} of 3${l.started > l.submitted ? ' (1 active)' : ''}` }),
    h('td', { class: 'num', 'data-label': 'Active shift deadline', text: l.activeDeadline ? fmtDateTime(l.activeDeadline) : '-' }),
    h('td', { class: 'num', 'data-label': 'Last activity', text: fmtDateTime(l.lastActivity) }),
    h('td', { 'data-label': 'Netlify Forms' }, formsChip(l.forms.status, `${l.forms.ok} logged, ${l.forms.failed} failed, ${l.forms.pending} pending`))));
  return { title: 'Roster', crumbs: [{ label: 'Roster' }], el: h('div', {}, h('div', { class: 'page-head' }, h('h1', { text: 'Roster' }), h('p', { class: 'muted', text: `${learners.length} learners` })),
    learners.length ? table(['Learner', 'Identity', 'Shifts used', 'Active shift deadline', 'Last activity', 'Netlify Forms logging'], rows, 'cards-sm') : emptyState('No learners have entered yet.')) };
}

async function learnerPicker() {
  const { learners } = await getJson('/roster');
  return { title: 'Learner', crumbs: [{ label: 'Learner' }], el: h('div', {}, h('div', { class: 'page-head' }, h('h1', { text: 'Learner' })),
    h('p', { class: 'muted', text: 'Choose a learner to see each shift, its event history and its form logging status.' }),
    learners.length ? h('div', { class: 'stack' }, h('ul', { class: 'stack' }, learners.map((l) => h('li', {}, h('a', { class: 'btn btn-secondary', href: `#/learner/${l.id}`, text: l.name }))))) : emptyState('No learners have entered yet.')) };
}

async function learnerView(id) {
  const d = await getJson(`/learner/${id}`);
  const shifts = d.attempts.map((a) => h('tr', {},
    h('td', { class: 'cell-first num', text: `Shift ${a.attemptNo}` }),
    h('td', { class: 'num', 'data-label': 'Start', text: fmtDateTime(a.startedAt) }),
    h('td', { class: 'num', 'data-label': 'Deadline', text: fmtDateTime(a.deadlineAt) }),
    h('td', { class: 'num', 'data-label': 'Submitted', text: a.submittedAt ? `${fmtDateTime(a.submittedAt)}, ${reasonText(a.reason)}` : a.status === 'active' ? 'Active' : '-' }),
    h('td', { 'data-label': 'Score' }, a.score === null ? '-' : bar(a.score, 100)),
    h('td', { 'data-label': 'Netlify Forms' }, formsChip(a.forms.status, a.forms.detail)),
    h('td', {}, a.status === 'submitted' ? h('a', { href: `#/shift/${a.id}`, text: 'View shift' }) : '')));
  const events = d.events.map((e) => h('li', { class: 'row row-wrap' }, h('span', { class: 'num muted', text: fmtDateTime(e.at) }), h('span', { class: 't-label', text: KIND[e.kind] || e.kind }),
    e.meta?.detail ? h('span', { class: 'muted', text: e.meta.detail }) : null));
  return { title: d.learner.name, crumbs: [{ label: 'Roster', href: '#/roster' }, { label: d.learner.name }], el: h('div', { class: 'stack-lg' },
    h('div', { class: 'page-head' }, h('div', { class: 'row' }, initialsAvatar(d.learner.name, 40), h('h1', { text: d.learner.name })),
      d.learner.status === 'provisional' ? h('span', { class: 'chip ac-Unverified' }, icon('triangle-alert'), 'Provisional identity') : null),
    h('dl', { class: 'kv panel' }, h('dt', { text: 'Emails' }), h('dd', { text: d.emails.map((e) => e.email).join(', ') || '-' }),
      h('dt', { text: 'Names entered' }), h('dd', { text: d.aliases.join(', ') || '-' })),
    h('section', {}, h('h2', { class: 't-section', text: 'Shifts' }), d.attempts.length ? table(['Shift', 'Start', 'Deadline', 'Submitted', 'Score', 'Netlify Forms logging', ''], shifts, 'cards-sm') : emptyState('No shifts started yet.')),
    h('section', {}, h('h2', { class: 't-section', text: 'Event history' }), h('ul', { class: 'panel stack' }, events))) };
}

async function shiftPicker() {
  const { shifts } = await getJson('/shifts');
  const rows = shifts.map((s) => h('tr', {},
    h('td', { class: 'cell-first' }, h('div', { class: 'cell-person' }, initialsAvatar(s.learner, 24), h('a', { href: s.status === 'submitted' ? `#/shift/${s.id}` : `#/learner/${s.learnerId}`, text: s.learner }))),
    h('td', { class: 'num', 'data-label': 'Shift', text: `Shift ${s.attemptNo}` }),
    h('td', { class: 'num', 'data-label': 'Submitted', text: s.submittedAt ? `${fmtDateTime(s.submittedAt)}, ${reasonText(s.reason)}` : 'Active' }),
    h('td', { 'data-label': 'Score' }, s.score === null ? '-' : bar(s.score, 100)),
    h('td', { 'data-label': 'Netlify Forms' }, formsChip(s.forms))));
  return { title: 'Shift', crumbs: [{ label: 'Shift' }], el: h('div', {}, h('div', { class: 'page-head' }, h('h1', { text: 'Shift' })),
    shifts.length ? table(['Learner', 'Shift', 'Submitted', 'Score', 'Netlify Forms logging'], rows, 'cards-sm') : emptyState('No shifts have started yet.')) };
}

function fieldTable(fields) {
  return table(['Field', 'Learner answer', 'Key', 'Mark'], fields.map((f) => h('tr', {},
    h('td', { class: 'cell-first t-label', text: f.label }),
    h('td', { 'data-label': 'Learner', class: f.mark < f.max ? 'mark-wrong' : '', text: dash(f.answer) }),
    h('td', { 'data-label': 'Key', text: dash(f.key) }),
    h('td', { 'data-label': 'Mark' }, h('span', { class: 'bar' }, bar(f.mark, f.max), h('span', { class: 'muted num', text: `of ${fmtNum(f.max)}` }))))), 'cards-sm');
}

async function shiftView(id) {
  const d = await getJson(`/shift/${id}`);
  const a = d.attempt;
  const tickets = d.tickets.map((t) => h('details', { class: 'ticket-acc' },
    h('summary', {}, h('span', { text: `Ticket ${t.n}` }), h('span', { class: 'bar' }, bar(t.total, 5), h('span', { class: 'muted num', text: 'of 5' }))),
    h('div', { class: 'inner stack' }, fieldTable(t.fields),
      h('dl', { class: 'kv' }, h('dt', { text: 'Assigned team' }), h('dd', { text: `${dash(t.team.answer)} (key: ${t.team.key}, not marked)` }),
        h('dt', { text: 'Case note' }), h('dd', { text: dash(t.note) })))));
  const articles = d.articles.map((r) => h('details', { class: 'article-acc' },
    h('summary', {}, h('span', { text: `Article ${r.n}` }), h('span', { class: 'bar' }, bar(r.total, 20), h('span', { class: 'muted num', text: 'of 20' })),
      r.pattern ? h('span', { class: 'chip chip-plan', text: `Marked as pattern ${r.pattern}` }) : null,
      r.duplicate ? h('span', { class: 'chip forms-failed', text: 'Duplicate pattern, scored 0' }) : null),
    h('div', { class: 'inner stack' }, fieldTable(r.fields),
      table(['Step slot', 'Learner answer', 'Key', 'Mark'], r.steps.map((s) => h('tr', {},
        h('td', { class: 'cell-first t-label num', text: `Step ${s.slot}` }), h('td', { 'data-label': 'Learner', class: s.mark < s.max ? 'mark-wrong' : '', text: dash(s.answer) }),
        h('td', { 'data-label': 'Key', text: s.key }), h('td', { 'data-label': 'Mark' }, bar(s.mark, s.max)))), 'cards-sm'))));
  const el = h('div', { class: 'stack-lg' },
    h('div', { class: 'page-head' }, h('h1', { text: `${a.learner}, shift ${a.attemptNo}` }), formsChip(a.forms.status, a.forms.detail)),
    h('dl', { class: 'kv panel' },
      h('dt', { text: 'Start' }), h('dd', { class: 'num', text: fmtDateTime(a.startedAt) }),
      h('dt', { text: 'Deadline' }), h('dd', { class: 'num', text: fmtDateTime(a.deadlineAt) }),
      h('dt', { text: 'Submitted' }), h('dd', { class: 'num', text: a.submittedAt ? `${fmtDateTime(a.submittedAt)}, ${reasonText(a.reason)}` : 'Not submitted' }),
      h('dt', { text: 'Score' }), h('dd', {}, d.scores ? h('span', { class: 'row row-wrap' }, h('strong', { class: 'num', text: `${fmtNum(d.scores.total)} of 100` }), h('span', { class: 'muted num', text: `Register ${fmtNum(d.scores.register)} of 60. Articles ${fmtNum(d.scores.articles)} of 40. Key ${d.scores.keyVersion}.` })) : 'Not marked'),
      h('dt', { text: 'Forms detail' }), h('dd', { text: dash(a.forms.detail) })),
    h('section', {}, h('h2', { class: 't-section', text: 'Register' }), h('div', { class: 'stack' }, tickets)),
    h('section', {}, h('h2', { class: 't-section', text: 'Articles' }), h('div', { class: 'stack' }, articles)));
  return { title: `Shift ${a.attemptNo}`, el, crumbs: [{ label: 'Roster', href: '#/roster' }, { label: a.learner, href: `#/learner/${a.learnerId}` }, { label: `Shift ${a.attemptNo}` }] };
}

async function identityView() {
  const { provisional } = await getJson('/identity');
  const cards = provisional.map((p) => {
    const s = p.suspected;
    const act = async (kind) => {
      const merge = kind === 'merge';
      const pick = await openDialog({
        title: merge ? 'Merge learners?' : 'Keep separate?',
        text: merge ? `${p.name} will be merged into ${s.name}. Attempts, names and emails move to ${s.name}.` : `${p.name} will stay a separate learner with their own three attempts.`,
        buttons: [{ label: merge ? 'Merge' : 'Keep separate', cls: 'btn-primary' }, { label: 'Cancel', cls: 'btn-secondary', cancel: true }]
      });
      if (pick !== 0) return;
      try {
        await call('POST', merge ? '/identity/merge' : '/identity/keep', merge ? { provisionalId: p.id, targetId: s.id } : { provisionalId: p.id });
        toast(merge ? 'Learners merged.' : 'Kept as a separate learner.', { kind: 'info', ic: 'circle-check' });
        renderRoute();
      } catch (err) {
        toast(err.data?.error === 'merge_exceeds_attempts' ? 'The merge is refused because the combined attempts exceed 3. Use Keep separate.' : `That could not be done (${err.message}).`, { kind: 'w10', ic: 'triangle-alert' });
      }
    };
    return h('article', { class: 'panel stack' },
      h('div', { class: 'row spread row-wrap' }, h('h2', { class: 't-section', text: p.name }), h('span', { class: 'chip ac-Unverified' }, icon('triangle-alert'), 'Provisional')),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Emails' }), h('dd', { text: p.emails.join(', ') || '-' }),
        h('dt', { text: 'Attempts' }), h('dd', { class: 'num', text: String(p.attempts) }),
        s ? [h('dt', { text: 'Suspected match' }), h('dd', {}, h('a', { href: `#/learner/${s.id}`, text: s.name }), ` (${s.attempts} attempts, edit distance ${s.distance}${s.sharedEmail ? ', shared email' : ''})`),
          h('dt', { text: 'Their emails' }), h('dd', { text: s.emails.join(', ') || '-' })] : null),
      h('div', { class: 'row row-wrap' },
        s ? h('button', { type: 'button', class: 'btn btn-primary', disabled: !s.canMerge, onclick: () => act('merge') }, 'Merge') : null,
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => act('keep') }, 'Keep separate'),
        s && !s.canMerge ? h('span', { class: 'help', text: 'Merge unavailable: the combined attempts exceed 3.' }) : null));
  });
  return { title: 'Identity review', crumbs: [{ label: 'Identity review' }], el: h('div', {}, h('div', { class: 'page-head' }, h('h1', { text: 'Identity review' })),
    cards.length ? h('div', { class: 'stack' }, cards) : emptyState('No provisional names to review.')) };
}

async function keyView() {
  const k = await getJson('/key');
  const pat = (name, p) => h('div', { class: 'panel stack' }, h('h3', { class: 't-sub', text: `Pattern ${name}. Tickets ${p.tickets.join(', ')}` }),
    h('dl', { class: 'kv' }, ['title', 'issue', 'environment', 'verification', 'stop'].flatMap((f) => [h('dt', { text: f }), h('dd', {}, h('strong', { text: p[f].full }), h('br'), h('span', { class: 'muted', text: `Partly right: ${p[f].part}` }))])),
    h('ol', { class: 'stack' }, p.steps.map((s, i) => h('li', { class: 'num', text: `${i + 1}. ${s}` }))));
  const el = h('div', { class: 'stack-lg' },
    h('div', { class: 'page-head' }, h('h1', { text: 'Key and rubric' }), h('span', { class: 'chip chip-plan', text: `Key version ${k.version}` })),
    h('section', { class: 'stack' }, h('h2', { class: 't-section', text: `Rubric, ${k.rubric.total} points` }),
      h('h3', { class: 't-sub', text: `Register, ${k.rubric.register_total ?? 60} points (12 tickets, 5 each)` }),
      table(['Field', 'Marks', 'Part marks'], k.rubric.register.map(([f, m, p]) => h('tr', {}, h('td', { text: f }), h('td', { class: 'num', text: String(m) }), h('td', { text: p })))),
      h('h3', { class: 't-sub', text: 'Articles, 40 points (2 articles, 20 each)' }),
      table(['Field', 'Marks', 'Part marks'], k.rubric.articles.map(([f, m, p]) => h('tr', {}, h('td', { text: f }), h('td', { class: 'num', text: String(m) }), h('td', { text: p }))))),
    h('section', { class: 'stack' }, h('h2', { class: 't-section', text: 'Ticket key' }),
      table(['Ticket', 'Requester', 'Status', 'Priority', 'Team', 'SLA due', 'Tags'], k.tickets.map((t) => h('tr', {},
        h('td', { class: 'num', text: String(t.n) }), h('td', { text: t.requester }), h('td', { text: `${t.status}${t.alternates.length ? ` (0.5: ${t.alternates.join(', ')})` : ''}` }),
        h('td', { text: t.priority }), h('td', { text: t.team }), h('td', { class: 'num', text: t.sla }), h('td', { text: t.tags.join(', ') }))))),
    h('section', { class: 'stack' }, h('h2', { class: 't-section', text: 'Article key' }), pat('A', k.articles.A), pat('B', k.articles.B),
      h('div', { class: 'panel' }, h('h3', { class: 't-sub', text: 'Details to leave out' }), h('p', { text: k.articles.leaveOut.join(', ') }))));
  return { title: 'Key and rubric', el, crumbs: [{ label: 'Key and rubric' }] };
}

async function exportView() {
  const download = async (path, name, type) => {
    try {
      const res = await call('GET', path);
      const url = URL.createObjectURL(new Blob([await res.text()], { type }));
      const a = h('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { toast('The export could not be created. Try again.', { kind: 'w10', ic: 'triangle-alert' }); }
  };
  return { title: 'Export', crumbs: [{ label: 'Export' }], el: h('div', { class: 'stack-lg' }, h('div', { class: 'page-head' }, h('h1', { text: 'Export' })),
    h('div', { class: 'cards' },
      h('div', { class: 'panel stack' }, h('h2', { class: 't-section', text: 'Learners and scores' }), h('p', { class: 'muted', text: 'CSV with one row per shift: times, reason, total, register, articles and Netlify Forms logging status.' }),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => download('/export/csv', 'harbourdesk-scores.csv', 'text/csv') }, icon('arrow-right', 'icon-20'), 'Download CSV')),
      h('div', { class: 'panel stack' }, h('h2', { class: 't-section', text: 'Submitted work and field marks' }), h('p', { class: 'muted', text: 'JSON with each shift’s tickets, articles and the mark for every field.' }),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => download('/export/json', 'harbourdesk-work.json', 'application/json') }, icon('arrow-right', 'icon-20'), 'Download JSON')))) };
}

// ---------- sign in ----------
function signIn(message) {
  shell = null;
  clear(appEl);
  const input = h('input', { class: 'input', id: 'a-pass', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'err', role: 'alert', hidden: !message, text: message || '' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Sign in');
  const form = h('form', { class: 'panel stack', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; err.hidden = true;
    try { await call('POST', '/signin', { passcode: input.value }); location.hash = '#/roster'; await start(); }
    catch (ex) {
      btn.disabled = false;
      err.textContent = ex.status === 429 ? `Too many attempts. Try again in ${Math.ceil((ex.data.retryAfterSeconds || 900) / 60)} minutes.`
        : ex.status === 503 ? 'The assessor passcode is not set on the server.' : 'That passcode is not right.';
      err.hidden = false; input.select();
    }
  } },
    h('div', { class: 'row' }, h('img', { src: '/img/logo.svg', alt: 'Harbourline', width: 40, height: 40 }), h('h1', { class: 't-title', text: 'HarbourDesk Assessor' })),
    h('div', { class: 'field' }, h('label', { for: 'a-pass', text: 'Passcode' }), input), err, btn);
  appEl.append(h('main', { id: 'main', class: 'a-signin', tabindex: '-1' }, form));
  document.title = 'Sign in | HarbourDesk Assessor';
  input.focus();
}

// ---------- router ----------
let token = 0;
async function renderRoute() {
  const my = ++token;
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  const key = name || 'roster';
  let loader;
  try {
    mountShell();
    if (key === 'roster') loader = roster();
    else if (key === 'learner') loader = id ? learnerView(id) : learnerPicker();
    else if (key === 'shift') loader = id ? shiftView(id) : shiftPicker();
    else if (key === 'identity') loader = identityView();
    else if (key === 'key') loader = keyView();
    else if (key === 'export') loader = exportView();
    else { location.hash = '#/roster'; return; }
    const view = await loader;
    if (my !== token) return;
    shell.main.replaceChildren(h('div', { class: 'view-in' }, view.el));
    document.title = `${view.title} | HarbourDesk Assessor`;
    shell.crumbs.replaceChildren(...view.crumbs.flatMap((c, i) => {
      const last = i === view.crumbs.length - 1;
      const node = last ? h('span', { 'aria-current': 'page', text: c.label }) : h('a', { href: c.href, text: c.label });
      return last ? [node] : [node, icon('chevron-right')];
    }));
    for (const a of shell.links) { if (a.dataset.key === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    shell.navSelect.value = key;
    shell.main.focus({ preventScroll: true });
  } catch (err) {
    if (err.status === 401) { signIn(); return; }
    if (my !== token) return;
    shell?.main.replaceChildren(h('div', { class: 'panel stack' }, h('h1', { class: 't-title', text: 'Could not load this view' }),
      h('p', { text: err.status === 404 ? 'That record was not found.' : 'HarbourDesk could not complete that request.' }), h('a', { class: 'btn btn-secondary', href: '#/roster', text: 'Back to roster' })));
  }
}
window.addEventListener('hashchange', renderRoute);

async function start() {
  try { await call('GET', '/me'); await renderRoute(); } catch { signIn(); }
}
start();
