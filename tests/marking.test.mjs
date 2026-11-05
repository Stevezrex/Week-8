import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markWork, resolvePattern } from '../netlify/functions/lib/marking.mjs';

const key = JSON.parse(readFileSync(new URL('../netlify/functions/lib/key.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../netlify/functions/lib/catalog.json', import.meta.url)));
const P = key.articles.patterns;

const clone = (x) => JSON.parse(JSON.stringify(x));

function perfectTicket(n) {
  const k = key.tickets[String(n)];
  return {
    requester: k.requester, status: k.status, priority: k.priority, team: k.team,
    sla: k.sla, tags: [...k.tags],
    finding: k.finding.full, action: k.action.full, ownerTime: k.ownerTime.full
  };
}
function perfectArticle(pat) {
  const p = P[pat];
  return {
    tickets: [...p.tickets], title: p.title.full, issue: p.issue.full, environment: p.environment.full,
    steps: [...p.steps], verification: p.verification.full, stop: p.stop.full, leaveOut: [...key.articles.leaveOut]
  };
}
function perfect() {
  const tickets = {};
  for (let n = 1; n <= 12; n++) tickets[n] = perfectTicket(n);
  return { tickets, articles: { 1: perfectArticle('A'), 2: perfectArticle('B') } };
}
const total = (w) => markWork(w, key).total;

test('rubric: register 60, articles 40, total 100', () => {
  const r = markWork(perfect(), key);
  assert.equal(r.register_total, 60);
  assert.equal(r.articles_total, 40);
  assert.equal(r.total, 100);
});

test('V1 every answer correct = 100', () => assert.equal(total(perfect()), 100));

test('V2 nothing answered = 0', () => {
  assert.equal(total({ tickets: {}, articles: {} }), 0);
  assert.equal(total({}), 0);
});

test('V3 partial marks everywhere = 56.00', () => {
  const w = perfect();
  const altStatus = { 1: 'waiting_internal', 5: 'waiting_customer', 10: 'waiting_internal' };
  for (let n = 1; n <= 12; n++) {
    const k = key.tickets[n];
    const t = w.tickets[n];
    t.requester = k.requester;
    t.status = altStatus[n] || k.altStatuses[0];
    const oneAway = { P1: 'P2', P2: 'P3', P3: 'P2', P4: 'P3' }[k.priority];
    t.priority = oneAway;
    t.sla = Object.entries(k.slaPriority).find(([, p]) => p === oneAway)[0];
    if (k.tags.length > 1) t.tags = k.tags.slice(1);
    else t.tags = [...k.tags, k.tags[0] === 'question' ? 'complaint' : 'question'];
    t.finding = k.finding.part;
    t.action = k.action.part;
    t.ownerTime = k.ownerTime.ownerOnly;
  }
  const swap = (s) => { const x = [...s]; [x[0], x[1]] = [x[1], x[0]]; [x[2], x[3]] = [x[3], x[2]]; [x[4], x[5]] = [x[4 + 1], x[4]]; return x; };
  for (const [i, pat] of [[1, 'A'], [2, 'B']]) {
    const a = perfectArticle(pat);
    a.tickets = a.tickets.slice(1);
    for (const f of ['title', 'issue', 'environment', 'verification', 'stop']) a[f] = P[pat][f].part;
    a.steps = swap(a.steps);
    a.leaveOut = a.leaveOut.slice(1);
    w.articles[i] = a;
  }
  const r = markWork(w, key);
  assert.equal(r.register_total, 36);
  assert.equal(r.articles_total, 20);
  assert.equal(r.total, 56);
});

test('V4 both articles resolve to pattern A = 80.00', () => {
  const w = perfect();
  w.articles[2] = perfectArticle('A');
  const r = markWork(w, key);
  assert.equal(r.total, 80);
  assert.equal(r.detail.articles[2].duplicate, true);
});

test('V5 ticket 12 priority P2 with SLA Mon 13:10 = 99.25', () => {
  const w = perfect();
  const k = key.tickets[12];
  w.tickets[12].priority = 'P2';
  w.tickets[12].sla = Object.entries(k.slaPriority).find(([, p]) => p === 'P2')[0];
  assert.equal(total(w), 99.25);
});

test('V6 one adjacent step swap in one article = 99.00', () => {
  const w = perfect();
  const s = w.articles[1].steps;
  [s[2], s[3]] = [s[3], s[2]];
  assert.equal(total(w), 99);
});

test('V7 tie on tickets, title from pattern B, so article 1 is marked as B', () => {
  const w = perfect();
  const a = perfectArticle('B');
  a.tickets = [1, 2];
  w.articles[1] = a;
  w.articles[2] = perfectArticle('A');
  assert.equal(resolvePattern(a, key, key.marks.article), 'B');
  const r = markWork(w, key);
  assert.equal(r.detail.articles[1].pattern, 'B');
  assert.equal(r.detail.articles[2].pattern, 'A');
  // Article 1 loses 2 ticket marks (two off) and nothing else.
  assert.equal(r.detail.articles[1].total, 18);
});

test('rule 3 and 4: steps decide when the title is of neither pattern; then the free pattern', () => {
  const a = perfectArticle('B');
  a.tickets = [];
  a.title = catalog.articles.title.find((o) => o.id !== P.A.title.full && o.id !== P.A.title.part && o.id !== P.B.title.full && o.id !== P.B.title.part).id;
  assert.equal(resolvePattern(a, key, key.marks.article), 'B');
  assert.equal(resolvePattern({}, key, key.marks.article), null);
  const r = markWork({ tickets: {}, articles: { 1: {}, 2: {} } }, key);
  assert.equal(r.detail.articles[1].pattern, 'A');
  assert.equal(r.detail.articles[2].pattern, 'B');
});

test('every mark is a multiple of 0.05 and totals have at most two decimals', () => {
  const w = perfect();
  w.tickets[3].finding = key.tickets[3].finding.part;
  w.tickets[4].ownerTime = key.tickets[4].ownerTime.timeOnly;
  const r = markWork(w, key);
  assert.equal(Math.round(r.total * 100) / 100, r.total);
  for (const t of Object.values(r.detail.tickets)) {
    for (const [f, v] of Object.entries(t)) assert.equal(Math.round(v * 20) / 20, v, f);
  }
});

test('unanswered tag set scores 0, not the one-missing part mark', () => {
  const w = perfect();
  w.tickets[1].tags = [];
  const r = markWork(w, key);
  assert.equal(r.detail.tickets[1].tags, 0);
});

test('option integrity: key ids exist in the catalog, each dropdown holds the needed options', () => {
  for (let n = 1; n <= 12; n++) {
    const c = catalog.tickets[n];
    const k = key.tickets[n];
    const has = (list, id) => list.some((o) => o.id === id);
    assert.ok(has(c.sla, k.sla));
    assert.ok(has(c.finding, k.finding.full) && has(c.finding, k.finding.part));
    assert.ok(has(c.action, k.action.full) && has(c.action, k.action.part));
    for (const v of Object.values(k.ownerTime)) assert.ok(has(c.ownerTime, v));
    for (const g of ['sla', 'finding', 'action', 'ownerTime']) assert.equal(c[g].length, 4);
  }
  for (const f of ['title', 'issue', 'environment', 'verification', 'stop']) {
    assert.equal(catalog.articles[f].length, 6);
    for (const pat of ['A', 'B']) {
      assert.ok(catalog.articles[f].some((o) => o.id === P[pat][f].full));
      assert.ok(catalog.articles[f].some((o) => o.id === P[pat][f].part));
    }
  }
  assert.equal(catalog.articles.steps.length, 16);
  assert.equal(catalog.articles.leaveOut.length, 8);
  for (const id of key.articles.leaveOut) assert.ok(catalog.articles.leaveOut.some((o) => o.id === id));
  for (const pat of ['A', 'B']) for (const id of P[pat].steps) assert.ok(catalog.articles.steps.some((o) => o.id === id));
});
