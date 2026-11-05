// Name normalization, fuzzy matching, entry and merge (section 10.4).
import { randomUUID } from 'node:crypto';
import { one, tx, isUniqueViolation } from './db.mjs';

// ---------- pure functions ----------

// Strip accents, lowercase, delete apostrophes and full stops, turn commas, hyphens,
// underscores and slashes into spaces, collapse spaces, then sort the words.
export function normalizeName(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’ʼ`.]/g, '')
    .replace(/[,\-_/‐-―]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Distance at most 2 for names of 8 or more characters, at most 1 for 5 to 7 characters.
// Also flagged when the email matches the existing learner and the distance is at most 3.
export function isFlagged(normA, normB, emailMatches = false) {
  const d = editDistance(normA, normB);
  if (d === 0) return false;
  const len = Math.min(normA.length, normB.length);
  if (len >= 8 && d <= 2) return true;
  if (len >= 5 && len <= 7 && d <= 1) return true;
  if (emailMatches && d <= 3) return true;
  return false;
}

export function cleanEmail(input) {
  const e = String(input ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

export function cleanDisplayName(input) {
  return String(input ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// learners: [{ id, canonical_name, aliases: [normalized...], emails: [email...] }] (not merged)
// Returns { kind: 'exact', learner } | { kind: 'flagged', suspected, distance } | { kind: 'new' }.
export function classify(normalized, email, learners) {
  const exact = learners.find((l) => l.canonical_name === normalized || l.aliases.includes(normalized));
  if (exact) return { kind: 'exact', learner: exact };
  let best = null;
  for (const l of learners) {
    const names = [l.canonical_name, ...l.aliases];
    const emailMatches = l.emails.includes(email);
    for (const nm of names) {
      if (isFlagged(normalized, nm, emailMatches)) {
        const distance = editDistance(normalized, nm);
        if (!best || distance < best.distance) best = { kind: 'flagged', suspected: l, distance };
      }
    }
  }
  return best || { kind: 'new' };
}

// ---------- database operations ----------

async function loadLearners(q) {
  const rows = await q(
    `SELECT l.id, l.canonical_name,
            COALESCE((SELECT array_agg(DISTINCT a.normalized_name) FROM learner_aliases a WHERE a.learner_id = l.id), '{}') AS aliases,
            COALESCE((SELECT array_agg(e.email) FROM learner_emails e WHERE e.learner_id = l.id), '{}') AS emails
       FROM learners l WHERE l.status <> 'merged'`
  );
  return rows;
}

async function recordEntry(q, learnerId, displayName, normalized, email) {
  const has = await q(`SELECT 1 FROM learner_aliases WHERE learner_id = $1 AND entered_name = $2`, [learnerId, displayName]);
  if (!has.length) {
    await q(`INSERT INTO learner_aliases (learner_id, entered_name, normalized_name) VALUES ($1, $2, $3)`, [learnerId, displayName, normalized]);
  }
  await q(
    `INSERT INTO learner_emails (learner_id, email) VALUES ($1, $2)
     ON CONFLICT (learner_id, email) DO UPDATE SET last_seen = now()`,
    [learnerId, email]
  );
}

// Section 10.4, "On entry". Returns { learner, outcome } where outcome is 'existing', 'provisional' or 'created'.
export async function enterLearner(rawName, rawEmail) {
  const displayName = cleanDisplayName(rawName);
  const normalized = normalizeName(displayName);
  const email = cleanEmail(rawEmail);
  if (!normalized) throw Object.assign(new Error('name_required'), { status: 400 });
  if (!email) throw Object.assign(new Error('email_invalid'), { status: 400 });

  for (let tries = 0; tries < 2; tries++) {
    try {
      return await tx(async (c) => {
        const learners = await loadLearners(c.query);
        const found = classify(normalized, email, learners);
        let learnerId;
        let outcome;
        if (found.kind === 'exact') {
          learnerId = found.learner.id;
          outcome = 'existing';
        } else {
          learnerId = randomUUID();
          const flagged = found.kind === 'flagged';
          await c.query(
            `INSERT INTO learners (id, canonical_name, display_name, status, suspected_of) VALUES ($1, $2, $3, $4, $5)`,
            [learnerId, normalized, displayName, flagged ? 'provisional' : 'active', flagged ? found.suspected.id : null]
          );
          outcome = flagged ? 'provisional' : 'created';
        }
        await recordEntry(c.query, learnerId, displayName, normalized, email);
        await c.query(
          `INSERT INTO attempt_events (learner_id, kind, meta) VALUES ($1, 'entered', $2)`,
          [learnerId, JSON.stringify({ entered_name: displayName, email, outcome })]
        );
        const learner = await c.one(`SELECT * FROM learners WHERE id = $1`, [learnerId]);
        return { learner, outcome };
      });
    } catch (err) {
      // Two people entering a new name at the same moment: the second insert loses, so read again.
      if (!isUniqueViolation(err) || tries === 1) throw err;
    }
  }
  throw new Error('unreachable');
}

// A cookie may carry the id of a learner who was later merged. Follow merged_into to the live record.
export async function resolveLearner(id) {
  let current = id;
  for (let i = 0; i < 5; i++) {
    const row = await one(`SELECT * FROM learners WHERE id = $1`, [current]);
    if (!row) return null;
    if (row.status !== 'merged') return row;
    current = row.merged_into;
  }
  return null;
}

// Merge a provisional learner into the chosen learner. Refused when combined attempts exceed 3.
export async function mergeLearners(provisionalId, targetId) {
  if (provisionalId === targetId) throw Object.assign(new Error('same_learner'), { status: 400 });
  return tx(async (c) => {
    const rows = await c.query(`SELECT * FROM learners WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[provisionalId, targetId]]);
    const prov = rows.find((r) => r.id === provisionalId);
    const target = rows.find((r) => r.id === targetId);
    if (!prov || !target) throw Object.assign(new Error('not_found'), { status: 404 });
    if (prov.status !== 'provisional') throw Object.assign(new Error('not_provisional'), { status: 409 });
    if (target.status === 'merged') throw Object.assign(new Error('target_merged'), { status: 409 });

    const attempts = await c.query(
      `SELECT id, learner_id, attempt_no, status, started_at FROM attempts WHERE learner_id = ANY($1::uuid[])`,
      [[provisionalId, targetId]]
    );
    if (attempts.length > 3) throw Object.assign(new Error('merge_exceeds_attempts'), { status: 409 });
    if (attempts.filter((a) => a.status === 'active').length > 1) {
      throw Object.assign(new Error('both_have_active_shift'), { status: 409 });
    }

    // Renumber by start time. Target attempts only move up, so move them from the highest down,
    // then place the provisional learner's attempts in the free slots.
    const ordered = [...attempts].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    const finalNo = new Map(ordered.map((a, i) => [a.id, i + 1]));
    const mine = attempts.filter((a) => a.learner_id === targetId).sort((a, b) => b.attempt_no - a.attempt_no);
    for (const a of mine) {
      await c.query(`UPDATE attempts SET attempt_no = $1 WHERE id = $2`, [finalNo.get(a.id), a.id]);
    }
    for (const a of attempts.filter((x) => x.learner_id === provisionalId)) {
      await c.query(`UPDATE attempts SET learner_id = $1, attempt_no = $2 WHERE id = $3`, [targetId, finalNo.get(a.id), a.id]);
    }

    await c.query(`UPDATE learner_aliases SET learner_id = $1 WHERE learner_id = $2`, [targetId, provisionalId]);
    await c.query(
      `INSERT INTO learner_emails (learner_id, email, first_seen, last_seen)
       SELECT $1, email, first_seen, last_seen FROM learner_emails WHERE learner_id = $2
       ON CONFLICT (learner_id, email) DO UPDATE SET last_seen = GREATEST(learner_emails.last_seen, EXCLUDED.last_seen)`,
      [targetId, provisionalId]
    );
    await c.query(`DELETE FROM learner_emails WHERE learner_id = $1`, [provisionalId]);
    await c.query(`UPDATE attempt_events SET learner_id = $1 WHERE learner_id = $2`, [targetId, provisionalId]);
    await c.query(`UPDATE learners SET status = 'merged', merged_into = $1 WHERE id = $2`, [targetId, provisionalId]);
    await c.query(
      `INSERT INTO attempt_events (learner_id, kind, meta) VALUES ($1, 'merged', $2)`,
      [targetId, JSON.stringify({ from: provisionalId, from_name: prov.display_name })]
    );
    return { merged: provisionalId, into: targetId, attempts: attempts.length };
  });
}

export async function keepSeparate(provisionalId) {
  const row = await one(
    `UPDATE learners SET status = 'active' WHERE id = $1 AND status = 'provisional' RETURNING *`,
    [provisionalId]
  );
  if (!row) throw Object.assign(new Error('not_provisional'), { status: 409 });
  return row;
}
