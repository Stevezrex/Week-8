// Shifts: start, resume, work save, submit and the deadline sweep (sections 10.4 to 10.6).
import { randomBytes, randomUUID } from 'node:crypto';
import catalog from './catalog.json' with { type: 'json' };
import key from './key.json' with { type: 'json' };
import { query, one, tx } from './db.mjs';
import { markWork } from './marking.mjs';

export const MAX_ATTEMPTS = 3;
export const SHIFT_MS = 60 * 60 * 1000;
const DEADLINE_GRACE_MS = 10 * 1000; // a browser may submit "deadline" a moment before its clock agrees

const httpError = (status, message, extra) => Object.assign(new Error(message), { status, extra });
const j = (v) => JSON.stringify(v);

// ---------- option groups and per attempt order ----------
// Lists with a natural order stay in that order. Every other dropdown and checkbox group is shuffled.
const KEEP_ORDER = new Set(['common.status', 'common.priority', 'a.tickets']);

function buildGroups() {
  const g = {};
  for (const [name, list] of Object.entries(catalog.common)) g[`common.${name}`] = list;
  for (const [n, t] of Object.entries(catalog.tickets)) for (const [f, list] of Object.entries(t)) g[`t${n}.${f}`] = list;
  for (const [f, list] of Object.entries(catalog.articles)) g[`a.${f}`] = list;
  return g;
}
const GROUPS = buildGroups();
const TEXT = Object.fromEntries(Object.entries(GROUPS).map(([k, list]) => [k, new Map(list.map((o) => [o.id, o.text]))]));
export const optionText = (group, id) => TEXT[group]?.get(id) ?? null;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeOptionOrders(seed = randomBytes(4).readUInt32BE(0)) {
  const rand = mulberry32(seed);
  const groups = {};
  for (const [name, list] of Object.entries(GROUPS)) {
    const ids = list.map((o) => o.id);
    if (!KEEP_ORDER.has(name)) {
      for (let i = ids.length - 1; i > 0; i--) {
        const k = Math.floor(rand() * (i + 1));
        [ids[i], ids[k]] = [ids[k], ids[i]];
      }
    }
    groups[name] = ids;
  }
  return { seed, groups };
}

// What the learner receives: option text in this attempt's order. No marks and no key.
export function optionsPayload(orders) {
  const list = (name) => orders.groups[name].map((id) => ({ id, text: TEXT[name].get(id) }));
  const out = { common: {}, tickets: {}, articles: {} };
  for (const name of Object.keys(catalog.common)) out.common[name] = list(`common.${name}`);
  for (const n of Object.keys(catalog.tickets)) {
    out.tickets[n] = {};
    for (const f of Object.keys(catalog.tickets[n])) out.tickets[n][f] = list(`t${n}.${f}`);
  }
  for (const f of Object.keys(catalog.articles)) out.articles[f] = list(`a.${f}`);
  return out;
}

// ---------- validating work ----------
const TICKET_SINGLE = {
  requester: () => 'common.requester',
  status: () => 'common.status',
  priority: () => 'common.priority',
  team: () => 'common.team',
  sla: (n) => `t${n}.sla`,
  finding: (n) => `t${n}.finding`,
  action: (n) => `t${n}.action`,
  ownerTime: (n) => `t${n}.ownerTime`
};
const ARTICLE_SINGLE = ['title', 'issue', 'environment', 'verification', 'stop'];

function pick(orders, group, value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !orders.groups[group]?.includes(value)) throw httpError(400, 'invalid_option');
  return value;
}
function pickMany(orders, group, value, max) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw httpError(400, 'invalid_selection');
  const seen = new Set();
  for (const v of value) {
    if (typeof v !== 'string' || !orders.groups[group]?.includes(v) || seen.has(v)) throw httpError(400, 'invalid_selection');
    seen.add(v);
  }
  return [...value];
}

export function normalizeTicket(n, raw, orders) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'invalid_ticket');
  const out = {};
  for (const [field, groupOf] of Object.entries(TICKET_SINGLE)) out[field] = pick(orders, groupOf(n), raw[field]);
  out.tags = pickMany(orders, 'common.tags', raw.tags, 3);
  return out;
}

export function normalizeArticle(raw, orders) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, 'invalid_article');
  const out = {};
  const t = raw.tickets ?? [];
  if (!Array.isArray(t) || t.length > 12) throw httpError(400, 'invalid_tickets');
  const nums = t.map(Number);
  if (nums.some((x) => !Number.isInteger(x) || x < 1 || x > 12) || new Set(nums).size !== nums.length) throw httpError(400, 'invalid_tickets');
  out.tickets = nums.sort((a, b) => a - b);
  for (const f of ARTICLE_SINGLE) out[f] = pick(orders, `a.${f}`, raw[f]);
  const steps = raw.steps ?? [];
  if (!Array.isArray(steps) || steps.length > 6) throw httpError(400, 'invalid_steps');
  const padded = Array.from({ length: 6 }, (_, i) => pick(orders, 'a.steps', steps[i]));
  const used = padded.filter(Boolean);
  if (new Set(used).size !== used.length) throw httpError(400, 'duplicate_step');
  out.steps = padded;
  out.leaveOut = pickMany(orders, 'a.leaveOut', raw.leaveOut, 8);
  return out;
}

export function validateChanges(changes, orders) {
  if (!changes || typeof changes !== 'object') throw httpError(400, 'invalid_changes');
  const out = { tickets: {}, articles: {} };
  for (const [n, v] of Object.entries(changes.tickets || {})) {
    if (!/^(?:[1-9]|1[0-2])$/.test(n)) throw httpError(400, 'invalid_ticket');
    out.tickets[n] = normalizeTicket(n, v, orders);
  }
  for (const [n, v] of Object.entries(changes.articles || {})) {
    if (n !== '1' && n !== '2') throw httpError(400, 'invalid_article');
    out.articles[n] = normalizeArticle(v, orders);
  }
  return out;
}

// ---------- reads ----------
async function attemptsCount(learnerId, q = query) {
  const rows = await q(`SELECT count(*)::int AS n FROM attempts WHERE learner_id = $1 AND status = 'submitted'`, [learnerId]);
  return rows[0].n;
}

export async function closeoutFor(learnerId, reason) {
  const submitted = await attemptsCount(learnerId);
  return {
    status: 'submitted',
    reason: reason ?? null,
    attemptsUsed: submitted,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - submitted),
    noAttempts: submitted >= MAX_ATTEMPTS
  };
}

function initialsOf(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Builds the learner state. When the active shift is past its deadline, it is submitted first
// and the closeout is returned instead (the caller clears the session).
export async function getState(learner, opts = {}) {
  const now = new Date();
  const active = await one(`SELECT * FROM attempts WHERE learner_id = $1 AND status = 'active'`, [learner.id]);
  if (active && now >= new Date(active.deadline_at)) {
    await submitAttempt(active.id, 'deadline', opts);
    return { ended: true, closeout: await closeoutFor(learner.id, 'deadline') };
  }
  const submitted = await attemptsCount(learner.id);
  const used = submitted + (active ? 1 : 0);
  const state = {
    serverNow: now.toISOString(),
    learner: { id: learner.id, name: learner.display_name, initials: initialsOf(learner.display_name), status: learner.status },
    attempts: { max: MAX_ATTEMPTS, submitted, used, remaining: Math.max(0, MAX_ATTEMPTS - used) },
    active: null
  };
  if (active) {
    const w = await one(`SELECT revision, tickets, articles FROM attempt_work WHERE attempt_id = $1`, [active.id]);
    state.active = {
      attemptId: active.id,
      attemptNo: active.attempt_no,
      startedAt: new Date(active.started_at).toISOString(),
      deadlineAt: new Date(active.deadline_at).toISOString(),
      revision: w.revision,
      work: { tickets: w.tickets, articles: w.articles },
      options: optionsPayload(active.option_orders)
    };
  }
  return state;
}

// ---------- start and resume ----------
export async function startAttempt(learner, opts = {}) {
  const result = await tx(async (c) => {
    await c.query(`SELECT id FROM learners WHERE id = $1 FOR UPDATE`, [learner.id]);
    const active = await c.one(`SELECT * FROM attempts WHERE learner_id = $1 AND status = 'active'`, [learner.id]);
    if (active) {
      if (Date.now() >= new Date(active.deadline_at).getTime()) return { expired: active.id };
      await c.query(`INSERT INTO attempt_events (learner_id, attempt_id, kind) VALUES ($1, $2, 'resumed')`, [learner.id, active.id]);
      return { resumed: active.id };
    }
    const rows = await c.query(`SELECT count(*)::int AS n, COALESCE(max(attempt_no), 0)::int AS top FROM attempts WHERE learner_id = $1`, [learner.id]);
    if (rows[0].n >= MAX_ATTEMPTS) return { none: true };
    const no = rows[0].top + 1;
    const startedAt = new Date();
    const deadline = new Date(startedAt.getTime() + SHIFT_MS);
    const id = randomUUID();
    await c.query(
      `INSERT INTO attempts (id, learner_id, attempt_no, started_at, deadline_at, option_orders)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [id, learner.id, no, startedAt, deadline, j(makeOptionOrders())]
    );
    await c.query(`INSERT INTO attempt_work (attempt_id) VALUES ($1)`, [id]);
    await c.query(`INSERT INTO attempt_events (learner_id, attempt_id, kind, meta) VALUES ($1, $2, 'started', $3::jsonb)`, [learner.id, id, j({ attempt_no: no })]);
    return { started: id };
  });
  if (result.expired) {
    await submitAttempt(result.expired, 'deadline', opts);
    return { ended: true, closeout: await closeoutFor(learner.id, 'deadline') };
  }
  return getState(learner, opts);
}

// ---------- autosave ----------
export async function saveWork(learner, body, opts = {}) {
  const { attemptId, baseRevision, changes } = body || {};
  if (typeof attemptId !== 'string' || !Number.isInteger(baseRevision)) throw httpError(400, 'invalid_request');

  const outcome = await tx(async (c) => {
    const a = await c.one(`SELECT * FROM attempts WHERE id = $1 AND learner_id = $2 FOR UPDATE`, [attemptId, learner.id]);
    if (!a) throw httpError(404, 'attempt_not_found');
    if (a.status === 'submitted') return { submitted: true };
    if (Date.now() >= new Date(a.deadline_at).getTime()) return { expired: true };

    const clean = validateChanges(changes, a.option_orders);
    const w = await c.one(`SELECT revision, tickets, articles FROM attempt_work WHERE attempt_id = $1 FOR UPDATE`, [attemptId]);
    if (w.revision !== baseRevision) return { conflict: { revision: w.revision, work: { tickets: w.tickets, articles: w.articles } } };
    const tickets = { ...w.tickets, ...clean.tickets };
    const articles = { ...w.articles, ...clean.articles };
    const rows = await c.query(
      `UPDATE attempt_work SET tickets = $1::jsonb, articles = $2::jsonb, revision = revision + 1, updated_at = now()
        WHERE attempt_id = $3 AND revision = $4 RETURNING revision`,
      [j(tickets), j(articles), attemptId, baseRevision]
    );
    if (!rows.length) return { conflict: { revision: w.revision, work: { tickets: w.tickets, articles: w.articles } } };
    return { saved: { revision: rows[0].revision, deadlineAt: new Date(a.deadline_at).toISOString() } };
  });

  const serverNow = new Date().toISOString();
  if (outcome.conflict) throw httpError(409, 'conflict', { ...outcome.conflict, serverNow });
  if (outcome.expired) {
    await submitAttempt(attemptId, 'deadline', opts);
    return { ended: true, closeout: await closeoutFor(learner.id, 'deadline') };
  }
  if (outcome.submitted) return { ended: true, closeout: await closeoutFor(learner.id, null) };
  return { ...outcome.saved, serverNow };
}

// ---------- submit ----------
export async function submitAttempt(attemptId, requestedReason, opts = {}) {
  if (requestedReason !== 'logout' && requestedReason !== 'deadline') throw httpError(400, 'invalid_reason');
  const now = new Date();
  const result = await tx(async (c) => {
    const a = await c.one(`SELECT * FROM attempts WHERE id = $1 FOR UPDATE`, [attemptId]);
    if (!a) throw httpError(404, 'attempt_not_found');
    if (a.status === 'submitted') return { already: true, attempt: a };

    const deadline = new Date(a.deadline_at);
    const expired = now >= deadline;
    if (requestedReason === 'deadline' && !expired && deadline - now > DEADLINE_GRACE_MS) throw httpError(409, 'not_yet');
    const reason = expired || requestedReason === 'deadline' ? 'deadline' : 'logout';

    const w = await c.one(`SELECT tickets, articles FROM attempt_work WHERE attempt_id = $1`, [attemptId]);
    const work = { tickets: w.tickets, articles: w.articles };
    const marked = markWork(work, key);
    await c.query(
      `INSERT INTO attempt_scores (attempt_id, total, register_total, articles_total, detail, key_version)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [attemptId, marked.total, marked.register_total, marked.articles_total, j(marked.detail), key.version]
    );
    await c.query(
      `UPDATE attempts SET status = 'submitted', submitted_at = $1, submit_reason = $2, score = $3 WHERE id = $4`,
      [now, reason, marked.total, attemptId]
    );
    await c.query(
      `INSERT INTO attempt_events (learner_id, attempt_id, kind, meta) VALUES ($1, $2, $3, $4::jsonb)`,
      [a.learner_id, attemptId, reason === 'deadline' ? 'submitted_deadline' : 'submitted_logout', j({ total: marked.total })]
    );
    return { already: false, attempt: { ...a, submitted_at: now, submit_reason: reason }, marked, work };
  });

  if (!result.already) await deliverToForms(result, opts);
  return result.attempt;
}

// One Netlify Forms submission per marked shift. The outcome goes to the event log.
async function deliverToForms({ attempt, marked, work }, opts) {
  let ok = false;
  let detail = '';
  try {
    const origin = opts.origin || Netlify.env.get('URL');
    if (!origin) throw new Error('no site URL');
    const learner = await one(`SELECT display_name FROM learners WHERE id = $1`, [attempt.learner_id]);
    const mail = await one(`SELECT email FROM learner_emails WHERE learner_id = $1 ORDER BY last_seen DESC LIMIT 1`, [attempt.learner_id]);
    const body = new URLSearchParams({
      'form-name': 'week8-shift-results',
      learner_id: attempt.learner_id,
      learner_name: learner?.display_name || '',
      learner_email: mail?.email || '',
      attempt_id: attempt.id,
      attempt_no: String(attempt.attempt_no),
      started_at: new Date(attempt.started_at).toISOString(),
      deadline_at: new Date(attempt.deadline_at).toISOString(),
      submitted_at: new Date(attempt.submitted_at).toISOString(),
      submit_reason: attempt.submit_reason,
      total_score: marked.total.toFixed(2),
      register_score: marked.register_total.toFixed(2),
      articles_score: marked.articles_total.toFixed(2),
      field_marks_json: j(marked.detail),
      ticket_work_json: j(work.tickets),
      article_work_json: j(work.articles),
      key_version: key.version
    });
    const res = await fetch(`${origin.replace(/\/$/, '')}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000)
    });
    ok = res.status >= 200 && res.status < 400;
    detail = `HTTP ${res.status}`;
  } catch (err) {
    detail = String(err?.message || err).slice(0, 200);
  }
  try {
    await query(
      `INSERT INTO attempt_events (learner_id, attempt_id, kind, meta) VALUES ($1, $2, $3, $4::jsonb)`,
      [attempt.learner_id, attempt.id, ok ? 'forms_submitted' : 'forms_delivery_failed', j({ detail })]
    );
  } catch (err) {
    console.error('could not record forms outcome', err);
  }
}

// ---------- deadline sweep ----------
export async function sweepExpired(opts = {}) {
  const rows = await query(`SELECT id FROM attempts WHERE status = 'active' AND deadline_at < now()`);
  let submitted = 0;
  for (const r of rows) {
    try {
      await submitAttempt(r.id, 'deadline', opts);
      submitted++;
    } catch (err) {
      console.error('sweep could not submit', r.id, err);
    }
  }
  return { checked: rows.length, submitted };
}
