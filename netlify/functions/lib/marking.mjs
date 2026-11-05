// All marking rules from section 8 and the SLA due time function.
// Marks are held as integer hundredths while summing, so no float error enters a total.

const h = (x) => Math.round(x * 100);
const out = (n) => n / 100;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const symDiff = (a, b) => a.filter((x) => !b.includes(x)).length + b.filter((x) => !a.includes(x)).length;

// ---------- SLA ----------
// Business hours: Monday to Friday, 08:00 to 18:00. P1 runs on clock time.
// Dates are "naive local" (WAT) values held in UTC fields; no zone conversion happens here.
const OPEN = 8 * 60;
const CLOSE = 18 * 60;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isBusinessDay(d) {
  const w = d.getUTCDay();
  return w >= 1 && w <= 5;
}
function mins(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function setMins(d, m) {
  const x = new Date(d.getTime());
  x.setUTCHours(Math.floor(m / 60), m % 60, 0, 0);
  return x;
}
function nextBusinessOpen(d) {
  let x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 8, 0));
  while (!isBusinessDay(x)) x = new Date(x.getTime() + 86400000);
  return x;
}
function addBusinessMinutes(d, add) {
  let x = new Date(d.getTime());
  if (!isBusinessDay(x) || mins(x) >= CLOSE) x = nextBusinessOpen(x);
  else if (mins(x) < OPEN) x = setMins(x, OPEN);
  let left = add;
  while (left > 0) {
    const room = CLOSE - mins(x);
    if (left <= room) return setMins(x, mins(x) + left);
    left -= room;
    x = nextBusinessOpen(x);
  }
  return x;
}
function addBusinessDay(d) {
  let x = new Date(d.getTime());
  if (!isBusinessDay(x) || mins(x) >= CLOSE || mins(x) < OPEN) {
    x = isBusinessDay(x) && mins(x) < OPEN ? setMins(x, OPEN) : nextBusinessOpen(x);
  }
  let next = new Date(x.getTime() + 86400000);
  while (!isBusinessDay(next)) next = new Date(next.getTime() + 86400000);
  return next;
}

export function slaDueDate(arrival, priority) {
  switch (priority) {
    case 'P1': return new Date(arrival.getTime() + 15 * 60000);
    case 'P2': return addBusinessMinutes(arrival, 60);
    case 'P3': return addBusinessMinutes(arrival, 240);
    case 'P4': return addBusinessDay(arrival);
    default: throw new Error(`unknown priority ${priority}`);
  }
}

// arrival: "HH:MM" on Monday 26 October 2026, or a naive Date. Returns "Mon 12:10".
export function slaDue(arrival, priority) {
  let d = arrival;
  if (typeof arrival === 'string') {
    const [hh, mm] = arrival.split(':').map(Number);
    d = new Date(Date.UTC(2026, 9, 26, hh, mm));
  }
  const due = slaDueDate(d, priority);
  const hh = String(due.getUTCHours()).padStart(2, '0');
  const mm = String(due.getUTCMinutes()).padStart(2, '0');
  return `${DAY[due.getUTCDay()]} ${hh}:${mm}`;
}

// ---------- ticket marking ----------
const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };

export function markTicket(work, k, M) {
  const w = work || {};
  const r = {};
  r.requester = w.requester && w.requester === k.requester ? h(M.requester) : 0;

  r.status = !w.status ? 0
    : w.status === k.status ? h(M.status)
    : k.altStatuses.includes(w.status) ? h(M.statusAlternate) : 0;

  r.priority = !w.priority ? 0
    : w.priority === k.priority ? h(M.priority)
    : Math.abs((PRIORITY_RANK[w.priority] || 99) - PRIORITY_RANK[k.priority]) === 1 ? h(M.priorityOneAway) : 0;

  r.sla = !w.sla ? 0
    : w.sla === k.sla ? h(M.sla)
    : (w.priority && k.slaPriority[w.sla] === w.priority) ? h(M.slaMatchesChosenPriority) : 0;

  const tags = Array.isArray(w.tags) ? w.tags : [];
  r.tags = tags.length === 0 ? 0
    : sameSet(tags, k.tags) ? h(M.tags)
    : symDiff(tags, k.tags) === 1 ? h(M.tagsOneOff) : 0;

  r.finding = w.finding === k.finding.full ? h(M.finding[0]) : w.finding === k.finding.part ? h(M.finding[1]) : 0;
  r.action = w.action === k.action.full ? h(M.action[0]) : w.action === k.action.part ? h(M.action[1]) : 0;

  const o = k.ownerTime;
  r.ownerTime = w.ownerTime === o.full ? h(M.ownerTime[0])
    : w.ownerTime === o.ownerOnly ? h(M.ownerTime[1])
    : w.ownerTime === o.timeOnly ? h(M.ownerTime[2]) : 0;

  r.total = Object.values(r).reduce((a, b) => a + b, 0);
  return r;
}

// ---------- article marking ----------
const DROPS = ['title', 'issue', 'environment', 'verification', 'stop'];

function markStepsAgainst(steps, patternSteps, M) {
  const marks = [];
  for (let i = 0; i < 6; i++) {
    const s = steps?.[i];
    if (!s) { marks.push(0); continue; }
    if (patternSteps[i] === s) { marks.push(h(M.stepCorrect)); continue; }
    const j = patternSteps.indexOf(s);
    marks.push(j !== -1 && Math.abs(j - i) === 1 ? h(M.stepAdjacent) : 0);
  }
  return marks;
}

function markArticleAgainst(art, pat, key, M) {
  const a = art || {};
  const r = {};
  const t = Array.isArray(a.tickets) ? a.tickets.map(Number) : [];
  r.tickets = t.length === 0 ? 0
    : sameSet(t, pat.tickets) ? h(M.tickets)
    : symDiff(t, pat.tickets) === 1 ? h(M.ticketsOneOff) : 0;
  for (const f of DROPS) {
    r[f] = a[f] === pat[f].full ? h(M.dropdownFull) : a[f] === pat[f].part ? h(M.dropdownPart) : 0;
  }
  const stepMarks = markStepsAgainst(a.steps, pat.steps, M);
  r.steps = stepMarks.reduce((x, y) => x + y, 0);
  r.stepMarks = stepMarks;
  const lo = Array.isArray(a.leaveOut) ? a.leaveOut : [];
  const err = symDiff(lo, key.articles.leaveOut);
  r.leaveOut = lo.length === 0 ? 0 : err === 0 ? h(M.leaveOut) : err === 1 ? h(M.leaveOutOneError) : 0;
  r.total = r.tickets + DROPS.reduce((x, f) => x + r[f], 0) + r.steps + r.leaveOut;
  return r;
}

// Section 8.3. Returns 'A', 'B' or null (still tied after rules 1 to 3).
export function resolvePattern(art, key, M) {
  const a = art || {};
  const P = key.articles.patterns;
  const t = Array.isArray(a.tickets) ? a.tickets.map(Number) : [];
  const nA = t.filter((x) => P.A.tickets.includes(Number(x))).length;
  const nB = t.filter((x) => P.B.tickets.includes(Number(x))).length;
  if (nA > nB) return 'A';
  if (nB > nA) return 'B';
  if (a.title) {
    if (a.title === P.A.title.full || a.title === P.A.title.part) return 'A';
    if (a.title === P.B.title.full || a.title === P.B.title.part) return 'B';
  }
  const sA = markStepsAgainst(a.steps, P.A.steps, M).reduce((x, y) => x + y, 0);
  const sB = markStepsAgainst(a.steps, P.B.steps, M).reduce((x, y) => x + y, 0);
  if (sA > sB) return 'A';
  if (sB > sA) return 'B';
  return null;
}

export function markArticles(articles, key) {
  const M = key.marks.article;
  const P = key.articles.patterns;
  const a1 = articles?.['1'];
  const a2 = articles?.['2'];
  let p1 = resolvePattern(a1, key, M);
  let p2 = resolvePattern(a2, key, M);
  // Rule 4: use the pattern the other article has not taken, otherwise A.
  if (p1 === null && p2 === null) { p1 = 'A'; p2 = 'B'; }
  else if (p1 === null) p1 = p2 === 'A' ? 'B' : 'A';
  else if (p2 === null) p2 = p1 === 'A' ? 'B' : 'A';

  const m1 = markArticleAgainst(a1, P[p1], key, M);
  const m2 = markArticleAgainst(a2, P[p2], key, M);
  m1.pattern = p1;
  m2.pattern = p2;
  m1.duplicate = false;
  m2.duplicate = false;
  if (p1 === p2) {
    // The higher scoring article is marked as usual. The other scores 0. Equal scores: article 2 scores 0.
    if (m1.total >= m2.total) { m2.total = 0; m2.duplicate = true; }
    else { m1.total = 0; m1.duplicate = true; }
  }
  return { 1: m1, 2: m2 };
}

// ---------- whole shift ----------
export function markWork(work, key) {
  const M = key.marks.ticket;
  const tickets = {};
  let reg = 0;
  for (let n = 1; n <= 12; n++) {
    const m = markTicket(work?.tickets?.[String(n)], key.tickets[String(n)], M);
    tickets[n] = m;
    reg += m.total;
  }
  const articles = markArticles(work?.articles, key);
  const art = articles[1].total + articles[2].total;
  return {
    total: out(reg + art),
    register_total: out(reg),
    articles_total: out(art),
    detail: { tickets: toDecimal(tickets), articles: toDecimal(articles) }
  };
}

// Convert integer hundredths to marks for storage and export. Non-numeric entries pass through.
function toDecimal(obj) {
  if (Array.isArray(obj)) return obj.map(toDecimal);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toDecimal(v)]));
  }
  return typeof obj === 'number' ? out(obj) : obj;
}

export const RUBRIC = { register: 60, articles: 40, total: 100 };
