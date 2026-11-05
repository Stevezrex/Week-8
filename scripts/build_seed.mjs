// Reads seed/authoring.json and writes netlify/functions/lib/catalog.json and key.json.
// Option IDs are opaque and come from a fixed seed, so every build is identical.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(join(root, 'seed/authoring.json'), 'utf8'));
const outDir = join(root, 'netlify/functions/lib');

const seen = new Map(); // field -> Set of ids, to prove uniqueness inside a field
function oid(field, text) {
  const id = 'o' + createHash('sha256').update(`${src.seed}|${field}|${text}`).digest('hex').slice(0, 10);
  if (!seen.has(field)) seen.set(field, new Map());
  const group = seen.get(field);
  if (group.has(id) && group.get(id) !== text) throw new Error(`ID clash in ${field}: ${text}`);
  group.set(id, text);
  return id;
}
const opt = (field, text) => ({ id: oid(field, text), text });
const fail = (msg) => { throw new Error(`authoring.json: ${msg}`); };

// ---------- catalog: common groups ----------
const catalog = {
  version: src.keyVersion,
  common: {
    requester: src.customers.map((c) => ({ id: c.id, text: c.name })),
    status: src.statuses,
    priority: src.priorities,
    team: src.teams,
    tags: src.tags
  },
  tickets: {},
  articles: {}
};

// ---------- key: tickets ----------
const key = {
  version: src.keyVersion,
  marks: { ticket: src.ticketMarks, article: src.articleMarks },
  tickets: {},
  articles: {}
};

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const ids = new Set(src.customers.map((c) => c.id));
const statusIds = new Set(src.statuses.map((s) => s.id));
const teamIds = new Set(src.teams.map((s) => s.id));
const tagIds = new Set(src.tags.map((s) => s.id));

if (src.tickets.length !== 12) fail('expected 12 tickets');

for (const t of src.tickets) {
  const n = String(t.n);
  const sla = src.sla[n];
  if (!sla) fail(`no SLA row for ticket ${n}`);
  if (!ids.has(t.requester)) fail(`ticket ${n} requester`);
  if (!statusIds.has(t.status)) fail(`ticket ${n} status`);
  for (const a of t.altStatuses) if (!statusIds.has(a)) fail(`ticket ${n} alternate status`);
  if (!PRIORITIES.includes(t.priority)) fail(`ticket ${n} priority`);
  if (!teamIds.has(t.team)) fail(`ticket ${n} team`);
  if (t.tags.length < 1 || t.tags.length > 3) fail(`ticket ${n} tag count`);
  for (const g of t.tags) if (!tagIds.has(g)) fail(`ticket ${n} tag ${g}`);
  for (const f of ['finding', 'action', 'ownerTime']) if (t[f].length !== 4) fail(`ticket ${n} ${f} needs 4 options`);

  const slaOpts = PRIORITIES.map((p) => ({ ...opt(`t${n}.sla`, sla[p]), priority: p }));
  const finding = t.finding.map((x) => opt(`t${n}.finding`, x));
  const action = t.action.map((x) => opt(`t${n}.action`, x));
  const ownerTime = t.ownerTime.map((x) => opt(`t${n}.ownerTime`, x));

  catalog.tickets[n] = {
    sla: slaOpts.map(({ id, text }) => ({ id, text })),
    finding, action, ownerTime
  };

  key.tickets[n] = {
    requester: t.requester,
    status: t.status,
    altStatuses: t.altStatuses,
    priority: t.priority,
    team: t.team,
    tags: t.tags,
    sla: slaOpts.find((o) => o.priority === t.priority).id,
    slaPriority: Object.fromEntries(slaOpts.map((o) => [o.id, o.priority])),
    finding: { full: finding[0].id, part: finding[1].id },
    action: { full: action[0].id, part: action[1].id },
    ownerTime: {
      full: ownerTime[0].id,
      ownerOnly: ownerTime[1].id,
      timeOnly: ownerTime[2].id,
      neither: ownerTime[3].id
    }
  };
}

// ---------- articles ----------
const A = src.articles;
const DROPS = ['title', 'issue', 'environment', 'verification', 'stop'];
const patterns = { A: { tickets: A.patterns.A.tickets }, B: { tickets: A.patterns.B.tickets } };

for (const f of DROPS) {
  const d = A.dropdowns[f];
  const optsA = d.A.map((x) => opt(`a.${f}`, x));
  const optsB = d.B.map((x) => opt(`a.${f}`, x));
  const other = d.other.map((x) => opt(`a.${f}`, x));
  if (d.A.length !== 2 || d.B.length !== 2 || d.other.length !== 2) fail(`dropdown ${f} needs 2+2+2`);
  catalog.articles[f] = [...optsA, ...optsB, ...other];
  patterns.A[f] = { full: optsA[0].id, part: optsA[1].id };
  patterns.B[f] = { full: optsB[0].id, part: optsB[1].id };
}

const stepsA = A.steps.A.map((x) => opt('a.steps', x));
const stepsB = A.steps.B.map((x) => opt('a.steps', x));
const stepsOther = A.steps.other.map((x) => opt('a.steps', x));
if (stepsA.length !== 6 || stepsB.length !== 6 || stepsOther.length !== 4) fail('steps need 6+6+4');
catalog.articles.steps = [...stepsA, ...stepsB, ...stepsOther];
patterns.A.steps = stepsA.map((o) => o.id);
patterns.B.steps = stepsB.map((o) => o.id);

const leaveCorrect = A.leaveOut.correct.map((x) => opt('a.leaveOut', x));
const leaveOther = A.leaveOut.other.map((x) => opt('a.leaveOut', x));
catalog.articles.leaveOut = [...leaveCorrect, ...leaveOther];
key.articles = { patterns, leaveOut: leaveCorrect.map((o) => o.id) };

// Ticket list for "tickets covered": one checkbox per ticket.
catalog.articles.tickets = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), text: `Ticket ${i + 1}` }));

writeFileSync(join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 1) + '\n');
writeFileSync(join(outDir, 'key.json'), JSON.stringify(key, null, 1) + '\n');
console.log(`catalog.json and key.json written (${src.keyVersion})`);
