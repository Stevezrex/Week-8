import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, editDistance, isFlagged, classify, cleanEmail } from '../netlify/functions/lib/identity.mjs';

const BASE = normalizeName('Adebayo Bello');
const learners = [{ id: 'L1', canonical_name: BASE, aliases: [BASE], emails: ['adebayo@example.com'] }];

// Section 10.4 table. Each entry is classified against "Adebayo Bello".
const CASES = [
  ['adebayo  bello', 'exact', 0],
  ['Bello, Adebayo', 'exact', 0],
  ['Adébayo Bello', 'exact', 0],
  ['Adebayo Belo', 'flagged', 1],
  ['Adebayo Bellow', 'flagged', 1],
  ['Adebayo B. Bello', 'flagged', 2],
  ['Adebayo Bello Jr', 'new', 3],
  ['Adeola Bello', 'new', 4],
  ['Ngozi Eze', 'new', null]
];

for (const [entry, kind, distance] of CASES) {
  test(`"${entry}" is ${kind}${distance === null ? '' : `, distance ${distance}`}`, () => {
    const n = normalizeName(entry);
    const r = classify(n, 'someone@example.com', learners);
    assert.equal(r.kind, kind);
    if (distance !== null) assert.equal(editDistance(n, BASE), distance);
  });
}

test('normalization strips accents, punctuation and sorts the words', () => {
  assert.equal(normalizeName("  O'Brien-Smith,  Seán  "), 'obrien sean smith');
  assert.equal(normalizeName('Eze/Ngozi'), 'eze ngozi');
  assert.equal(normalizeName('A_B'), 'a b');
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName(null), '');
});

test('short names: distance 1 flags a 5 to 7 character name, distance 2 does not', () => {
  assert.equal(isFlagged('ab eze', 'ab ezi'), true);
  assert.equal(isFlagged('ab eze', 'ac ezi'), false);
});

test('a matching email widens the flag to distance 3', () => {
  const n = normalizeName('Adebayo Bello Jr'); // distance 3
  assert.equal(classify(n, 'someone@example.com', learners).kind, 'new');
  const r = classify(n, 'adebayo@example.com', learners);
  assert.equal(r.kind, 'flagged');
  assert.equal(r.suspected.id, 'L1');
});

test('a merged learner alias still resolves to the same learner', () => {
  const merged = [{ id: 'L1', canonical_name: BASE, aliases: [BASE, normalizeName('Adebayo Belo')], emails: [] }];
  assert.equal(classify(normalizeName('Adebayo Belo'), 'x@example.com', merged).kind, 'exact');
});

test('email cleaning', () => {
  assert.equal(cleanEmail('  Ada@Example.COM '), 'ada@example.com');
  assert.equal(cleanEmail('not an email'), null);
  assert.equal(cleanEmail(''), null);
});
