// Assessor API under /api/assessor/*. Answer key, marks and scores are only returned here.
import catalog from './lib/catalog.json' with { type: 'json' };
import key from './lib/key.json' with { type: 'json' };
import {
  json, errorResponse, readJson, requireHeader, isAssessor, assessorSignIn, assessorCookie, clearAssessorCookie
} from './lib/session.mjs';
import { query, one } from './lib/db.mjs';
import { mergeLearners, keepSeparate, editDistance } from './lib/identity.mjs';
import { optionText } from './lib/attempts.mjs';
import { RUBRIC } from './lib/marking.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const num = (v) => (v === null || v === undefined ? null : Number(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);

// ---------- forms status ----------
// ok: a forms_submitted event exists. failed: only forms_delivery_failed. pending: neither.
async function formsByAttempt(attemptIds) {
  if (!attemptIds.length) return new Map();
  const rows = await query(
    `SELECT attempt_id, kind, meta, at FROM attempt_events
      WHERE attempt_id = ANY($1::uuid[]) AND kind IN ('forms_submitted','forms_delivery_failed') ORDER BY at`,
    [attemptIds]
  );
  const out = new Map();
  for (const r of rows) {
    const cur = out.get(r.attempt_id) || { status: 'pending', detail: '' };
    if (r.kind === 'forms_submitted') out.set(r.attempt_id, { status: 'ok', detail: r.meta?.detail || '' });
    else if (cur.status !== 'ok') out.set(r.attempt_id, { status: 'failed', detail: r.meta?.detail || '' });
  }
  return out;
}

// ---------- roster, learner ----------
async function roster() {
  const learners = await query(
    `SELECT l.id, l.display_name, l.status, l.created_at,
            (SELECT count(*)::int FROM attempts a WHERE a.learner_id = l.id) AS started,
            (SELECT count(*)::int FROM attempts a WHERE a.learner_id = l.id AND a.status = 'submitted') AS submitted,
            (SELECT a.deadline_at FROM attempts a WHERE a.learner_id = l.id AND a.status = 'active') AS active_deadline,
            (SELECT max(e.at) FROM attempt_events e WHERE e.learner_id = l.id) AS last_event,
            (SELECT e.email FROM learner_emails e WHERE e.learner_id = l.id ORDER BY e.last_seen DESC LIMIT 1) AS email
       FROM learners l WHERE l.status <> 'merged'`
  );
  const submitted = await query(`SELECT id, learner_id FROM attempts WHERE status = 'submitted'`);
  const forms = await formsByAttempt(submitted.map((a) => a.id));
  const byLearner = new Map();
  for (const a of submitted) {
    const f = forms.get(a.id)?.status || 'pending';
    const cur = byLearner.get(a.learner_id) || { ok: 0, failed: 0, pending: 0 };
    cur[f]++;
    byLearner.set(a.learner_id, cur);
  }
  return learners
    .map((l) => {
      const f = byLearner.get(l.id) || { ok: 0, failed: 0, pending: 0 };
      const formsStatus = f.failed ? 'failed' : f.pending ? 'pending' : f.ok ? 'ok' : 'none';
      return {
        id: l.id, name: l.display_name, email: l.email, status: l.status,
        started: l.started, submitted: l.submitted,
        activeDeadline: iso(l.active_deadline),
        lastActivity: iso(l.last_event || l.created_at),
        forms: { status: formsStatus, ok: f.ok, failed: f.failed, pending: f.pending }
      };
    })
    .sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));
}

async function learnerDetail(id) {
  const l = await one(`SELECT * FROM learners WHERE id = $1`, [id]);
  if (!l) throw fail(404, 'not_found');
  const emails = await query(`SELECT email, first_seen, last_seen FROM learner_emails WHERE learner_id = $1 ORDER BY last_seen DESC`, [id]);
  const aliases = await query(`SELECT DISTINCT entered_name FROM learner_aliases WHERE learner_id = $1`, [id]);
  const attempts = await query(
    `SELECT a.id, a.attempt_no, a.status, a.started_at, a.deadline_at, a.submitted_at, a.submit_reason, a.score
       FROM attempts a WHERE a.learner_id = $1 ORDER BY a.attempt_no`,
    [id]
  );
  const forms = await formsByAttempt(attempts.map((a) => a.id));
  const events = await query(`SELECT id, attempt_id, kind, meta, at FROM attempt_events WHERE learner_id = $1 ORDER BY at, id`, [id]);
  return {
    learner: { id: l.id, name: l.display_name, status: l.status, suspectedOf: l.suspected_of, mergedInto: l.merged_into },
    emails: emails.map((e) => ({ email: e.email, firstSeen: iso(e.first_seen), lastSeen: iso(e.last_seen) })),
    aliases: aliases.map((a) => a.entered_name),
    attempts: attempts.map((a) => ({
      id: a.id, attemptNo: a.attempt_no, status: a.status,
      startedAt: iso(a.started_at), deadlineAt: iso(a.deadline_at), submittedAt: iso(a.submitted_at),
      reason: a.submit_reason, score: num(a.score),
      forms: a.status === 'submitted' ? forms.get(a.id) || { status: 'pending', detail: '' } : { status: 'none', detail: '' }
    })),
    events: events.map((e) => ({ id: e.id, attemptId: e.attempt_id, kind: e.kind, meta: e.meta, at: iso(e.at) }))
  };
}

async function shiftList() {
  const rows = await query(
    `SELECT a.id, a.attempt_no, a.status, a.started_at, a.submitted_at, a.submit_reason, a.score, l.id AS learner_id, l.display_name
       FROM attempts a JOIN learners l ON l.id = a.learner_id WHERE l.status <> 'merged' ORDER BY a.started_at DESC`
  );
  const forms = await formsByAttempt(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, learnerId: r.learner_id, learner: r.display_name, attemptNo: r.attempt_no, status: r.status,
    startedAt: iso(r.started_at), submittedAt: iso(r.submitted_at), reason: r.submit_reason, score: num(r.score),
    forms: r.status === 'submitted' ? forms.get(r.id)?.status || 'pending' : 'none'
  }));
}

// ---------- shift view ----------
const TICKET_FIELDS = [
  ['requester', 'Requester', 'requester'],
  ['status', 'Status', 'status'],
  ['priority', 'Priority', 'priority'],
  ['sla', 'SLA due time', 'sla'],
  ['tags', 'Tags', 'tags'],
  ['finding', 'Finding', 'finding'],
  ['action', 'Next action', 'action'],
  ['ownerTime', 'Owner and due time', 'ownerTime']
];
const commonText = (list, id) => catalog.common[list].find((o) => o.id === id)?.text ?? null;

function ticketValueText(n, field, id) {
  if (id === null || id === undefined || id === '') return null;
  switch (field) {
    case 'requester': return commonText('requester', id);
    case 'status': return commonText('status', id);
    case 'priority': return commonText('priority', id);
    case 'team': return commonText('team', id);
    default: return optionText(`t${n}.${field}`, id);
  }
}

function noteText(n, w) {
  const f = ticketValueText(n, 'finding', w?.finding);
  const a = ticketValueText(n, 'action', w?.action);
  const o = ticketValueText(n, 'ownerTime', w?.ownerTime);
  if (!f && !a && !o) return '';
  const [owner, ...rest] = (o || '').split(', ');
  return `Finding: ${f || '-'} Next action: ${a || '-'} Owner: ${owner || '-'}. Due: ${rest.join(', ') || '-'}.`;
}

function shiftView(work, detail) {
  const M = key.marks.ticket;
  const maxOf = { requester: M.requester, status: M.status, priority: M.priority, sla: M.sla, tags: M.tags, finding: M.finding[0], action: M.action[0], ownerTime: M.ownerTime[0] };
  const tickets = [];
  for (let n = 1; n <= 12; n++) {
    const k = key.tickets[String(n)];
    const w = work.tickets?.[String(n)] || {};
    const d = detail?.tickets?.[String(n)] || {};
    const keyText = {
      requester: commonText('requester', k.requester),
      status: [commonText('status', k.status), ...k.altStatuses.map((s) => `${commonText('status', s)} (0.5)`)].join('; '),
      priority: k.priority,
      sla: optionText(`t${n}.sla`, k.sla),
      tags: k.tags.join(', '),
      finding: optionText(`t${n}.finding`, k.finding.full),
      action: optionText(`t${n}.action`, k.action.full),
      ownerTime: optionText(`t${n}.ownerTime`, k.ownerTime.full)
    };
    tickets.push({
      n,
      fields: TICKET_FIELDS.map(([field, label]) => ({
        field, label,
        answer: field === 'tags' ? (w.tags || []).join(', ') || null : ticketValueText(n, field, w[field]),
        key: keyText[field],
        mark: d[field] ?? 0,
        max: maxOf[field]
      })),
      team: { answer: ticketValueText(n, 'team', w.team), key: commonText('team', k.team) },
      note: noteText(n, w),
      total: d.total ?? 0
    });
  }

  const P = key.articles.patterns;
  const articles = [1, 2].map((i) => {
    const a = work.articles?.[String(i)] || {};
    const d = detail?.articles?.[String(i)] || {};
    const pat = P[d.pattern || 'A'];
    const A = key.marks.article;
    const drop = (f, label) => ({
      field: f, label,
      answer: a[f] ? optionText(`a.${f}`, a[f]) : null,
      key: optionText(`a.${f}`, pat[f].full),
      mark: d[f] ?? 0, max: A.dropdownFull
    });
    return {
      n: i,
      pattern: d.pattern || null,
      duplicate: !!d.duplicate,
      total: d.total ?? 0,
      fields: [
        { field: 'tickets', label: 'Tickets covered', answer: (a.tickets || []).join(', ') || null, key: pat.tickets.join(', '), mark: d.tickets ?? 0, max: A.tickets },
        drop('title', 'Title'), drop('issue', 'Issue'), drop('environment', 'Environment'),
        drop('verification', 'Verification'),
        drop('stop', 'Stop condition'),
        { field: 'leaveOut', label: 'Details to leave out', answer: (a.leaveOut || []).map((id) => optionText('a.leaveOut', id)).join(', ') || null, key: key.articles.leaveOut.map((id) => optionText('a.leaveOut', id)).join(', '), mark: d.leaveOut ?? 0, max: A.leaveOut }
      ],
      steps: Array.from({ length: 6 }, (_, s) => ({
        slot: s + 1,
        answer: a.steps?.[s] ? optionText('a.steps', a.steps[s]) : null,
        key: optionText('a.steps', pat.steps[s]),
        mark: d.stepMarks?.[s] ?? 0,
        max: A.stepCorrect
      })),
      stepsTotal: d.steps ?? 0
    };
  });
  return { tickets, articles };
}

async function shiftDetail(attemptId) {
  const a = await one(
    `SELECT a.*, l.display_name FROM attempts a JOIN learners l ON l.id = a.learner_id WHERE a.id = $1`,
    [attemptId]
  );
  if (!a) throw fail(404, 'not_found');
  const w = await one(`SELECT revision, tickets, articles FROM attempt_work WHERE attempt_id = $1`, [attemptId]);
  const s = await one(`SELECT * FROM attempt_scores WHERE attempt_id = $1`, [attemptId]);
  const forms = (await formsByAttempt([attemptId])).get(attemptId) || { status: a.status === 'submitted' ? 'pending' : 'none', detail: '' };
  return {
    attempt: {
      id: a.id, learnerId: a.learner_id, learner: a.display_name, attemptNo: a.attempt_no, status: a.status,
      startedAt: iso(a.started_at), deadlineAt: iso(a.deadline_at), submittedAt: iso(a.submitted_at), reason: a.submit_reason,
      score: num(a.score), forms
    },
    scores: s ? { total: num(s.total), register: num(s.register_total), articles: num(s.articles_total), keyVersion: s.key_version, markedAt: iso(s.marked_at) } : null,
    ...shiftView({ tickets: w?.tickets || {}, articles: w?.articles || {} }, s?.detail)
  };
}

// ---------- identity review ----------
async function identityReview() {
  const rows = await query(
    `SELECT p.id, p.display_name, p.canonical_name, p.created_at, p.suspected_of,
            s.display_name AS suspected_name, s.canonical_name AS suspected_canonical, s.status AS suspected_status,
            (SELECT count(*)::int FROM attempts a WHERE a.learner_id = p.id) AS attempts,
            (SELECT count(*)::int FROM attempts a WHERE a.learner_id = s.id) AS suspected_attempts,
            COALESCE((SELECT array_agg(e.email) FROM learner_emails e WHERE e.learner_id = p.id), '{}') AS emails,
            COALESCE((SELECT array_agg(e.email) FROM learner_emails e WHERE e.learner_id = s.id), '{}') AS suspected_emails
       FROM learners p LEFT JOIN learners s ON s.id = p.suspected_of
      WHERE p.status = 'provisional' ORDER BY p.created_at`
  );
  return rows.map((r) => ({
    id: r.id, name: r.display_name, createdAt: iso(r.created_at), attempts: r.attempts, emails: r.emails,
    suspected: r.suspected_of ? {
      id: r.suspected_of, name: r.suspected_name, attempts: r.suspected_attempts, emails: r.suspected_emails,
      status: r.suspected_status,
      distance: editDistance(r.canonical_name, r.suspected_canonical),
      sharedEmail: r.emails.some((e) => r.suspected_emails.includes(e)),
      canMerge: r.suspected_status !== 'merged' && r.attempts + r.suspected_attempts <= 3
    } : null
  }));
}

// ---------- key and rubric ----------
function keyView() {
  const P = key.articles.patterns;
  const tickets = Object.entries(key.tickets).map(([n, k]) => ({
    n: Number(n),
    requester: commonText('requester', k.requester),
    status: commonText('status', k.status),
    alternates: k.altStatuses.map((s) => commonText('status', s)),
    priority: k.priority,
    team: commonText('team', k.team),
    sla: optionText(`t${n}.sla`, k.sla),
    tags: k.tags,
    finding: { full: optionText(`t${n}.finding`, k.finding.full), part: optionText(`t${n}.finding`, k.finding.part) },
    action: { full: optionText(`t${n}.action`, k.action.full), part: optionText(`t${n}.action`, k.action.part) },
    ownerTime: optionText(`t${n}.ownerTime`, k.ownerTime.full)
  }));
  const pattern = (p) => ({
    tickets: P[p].tickets,
    ...Object.fromEntries(['title', 'issue', 'environment', 'verification', 'stop'].map((f) => [f, { full: optionText(`a.${f}`, P[p][f].full), part: optionText(`a.${f}`, P[p][f].part) }])),
    steps: P[p].steps.map((id) => optionText('a.steps', id))
  });
  return {
    version: key.version,
    rubric: {
      ...RUBRIC,
      register: [
        ['Requester', 1, 'The correct customer'], ['Status', 1, '0.5 for an accepted alternate'], ['Priority', 1, '0.5 for one level away'],
        ['SLA due time', 0.5, '0.25 when the time matches the priority the learner chose'], ['Tags', 0.5, '0.25 when one tag is missing or one is extra'],
        ['Finding', 0.5, '0.25 for the partly right option'], ['Next action', 0.25, '0.1 for the partly right option'], ['Owner and due time', 0.25, '0.15 owner right, 0.10 time right']
      ],
      articles: [
        ['Tickets covered', 2, '1 for one missing or one extra'], ['Title', 2, '1 for the partly right option'], ['Issue', 2, '1 for the partly right option'],
        ['Environment', 2, '1 for the partly right option'], ['Six steps', 6, '1 each in the correct slot, 0.5 one slot away'], ['Verification', 2, '1 for the partly right option'],
        ['Stop condition', 2, '1 for the partly right option'], ['Details to leave out', 2, '1 for one error, 0 for two or more']
      ]
    },
    tickets,
    articles: { A: pattern('A'), B: pattern('B'), leaveOut: key.articles.leaveOut.map((id) => optionText('a.leaveOut', id)) }
  };
}

// ---------- export ----------
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function exportRows() {
  const rows = await query(
    `SELECT l.id AS learner_id, l.display_name, l.status AS learner_status,
            (SELECT string_agg(e.email, '; ' ORDER BY e.last_seen DESC) FROM learner_emails e WHERE e.learner_id = l.id) AS emails,
            a.id AS attempt_id, a.attempt_no, a.status, a.started_at, a.deadline_at, a.submitted_at, a.submit_reason,
            s.total, s.register_total, s.articles_total, s.detail, s.key_version, w.tickets, w.articles
       FROM learners l
       LEFT JOIN attempts a ON a.learner_id = l.id
       LEFT JOIN attempt_scores s ON s.attempt_id = a.id
       LEFT JOIN attempt_work w ON w.attempt_id = a.id
      WHERE l.status <> 'merged' ORDER BY l.display_name, a.attempt_no`
  );
  const forms = await formsByAttempt(rows.map((r) => r.attempt_id).filter(Boolean));
  return rows.map((r) => ({ ...r, forms: r.attempt_id ? forms.get(r.attempt_id)?.status || (r.status === 'submitted' ? 'pending' : 'none') : '' }));
}

async function exportCsv() {
  const head = ['learner', 'emails', 'learner_status', 'attempt_no', 'attempt_status', 'started_at', 'deadline_at', 'submitted_at', 'submit_reason', 'total', 'register', 'articles', 'forms_logging', 'key_version', 'attempt_id'];
  const lines = [head.join(',')];
  for (const r of await exportRows()) {
    lines.push([
      r.display_name, r.emails, r.learner_status, r.attempt_no, r.status, iso(r.started_at), iso(r.deadline_at), iso(r.submitted_at), r.submit_reason,
      num(r.total), num(r.register_total), num(r.articles_total), r.forms, r.key_version, r.attempt_id
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

async function exportJson() {
  const rows = await exportRows();
  return {
    exportedAt: new Date().toISOString(),
    keyVersion: key.version,
    shifts: rows.filter((r) => r.attempt_id).map((r) => ({
      learner: { id: r.learner_id, name: r.display_name, emails: r.emails },
      attempt: { id: r.attempt_id, no: r.attempt_no, status: r.status, startedAt: iso(r.started_at), deadlineAt: iso(r.deadline_at), submittedAt: iso(r.submitted_at), reason: r.submit_reason },
      scores: r.total === null ? null : { total: num(r.total), register: num(r.register_total), articles: num(r.articles_total) },
      formsLogging: r.forms,
      work: { tickets: r.tickets, articles: r.articles },
      fieldMarks: r.detail
    }))
  };
}

// ---------- routing ----------
export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\/assessor/, '').replace(/\/+$/, '') || '/';
    requireHeader(req);

    if (route === '/signin' && req.method === 'POST') {
      const body = await readJson(req);
      await assessorSignIn(body.passcode);
      return json({ ok: true }, 200, [assessorCookie()]);
    }
    if (route === '/signout' && req.method === 'POST') return json({ ok: true }, 200, [clearAssessorCookie()]);
    if (route === '/me') return isAssessor(req) ? json({ signedIn: true }) : json({ signedIn: false }, 401);

    if (!isAssessor(req)) throw fail(401, 'not_signed_in');
    let m;

    if (route === '/roster' && req.method === 'GET') return json({ learners: await roster(), now: new Date().toISOString() });
    if ((m = route.match(/^\/learner\/([0-9a-f-]{36})$/)) && req.method === 'GET') return json(await learnerDetail(m[1]));
    if ((m = route.match(/^\/shift\/([0-9a-f-]{36})$/)) && req.method === 'GET') return json(await shiftDetail(m[1]));
    if (route === '/shifts' && req.method === 'GET') return json({ shifts: await shiftList() });
    if (route === '/identity' && req.method === 'GET') return json({ provisional: await identityReview() });
    if (route === '/identity/merge' && req.method === 'POST') {
      const b = await readJson(req);
      if (typeof b.provisionalId !== 'string' || typeof b.targetId !== 'string') throw fail(400, 'invalid_request');
      return json(await mergeLearners(b.provisionalId, b.targetId));
    }
    if (route === '/identity/keep' && req.method === 'POST') {
      const b = await readJson(req);
      if (typeof b.provisionalId !== 'string') throw fail(400, 'invalid_request');
      await keepSeparate(b.provisionalId);
      return json({ ok: true });
    }
    if (route === '/key' && req.method === 'GET') return json(keyView());
    if (route === '/export/csv' && req.method === 'GET') {
      return new Response(await exportCsv(), {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="harbourdesk-scores.csv"', 'cache-control': 'no-store' }
      });
    }
    if (route === '/export/json' && req.method === 'GET') {
      return new Response(JSON.stringify(await exportJson(), null, 1), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="harbourdesk-work.json"', 'cache-control': 'no-store' }
      });
    }
    return json({ error: 'not_found' }, 404);
  } catch (err) {
    return errorResponse(err);
  }
}

export const config = { path: '/api/assessor/*' };
