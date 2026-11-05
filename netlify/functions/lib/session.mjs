// Signed cookies, request guards, JSON helpers and the assessor sign in throttle.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { query, one } from './db.mjs';

const LEARNER_COOKIE = 'hd_learner';
const ASSESSOR_COOKIE = 'hd_assessor';
const LEARNER_MAX_AGE = 14 * 24 * 3600;
const ASSESSOR_MAX_AGE = 8 * 3600;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw Object.assign(new Error('SESSION_SECRET is not set'), { status: 500 });
  return s;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
const mac = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function sign(data, maxAgeSeconds) {
  const payload = b64(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds }));
  return `${payload}.${mac(payload)}`;
}

export function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = mac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(unb64(payload));
    return data.exp > Math.floor(Date.now() / 1000) ? data : null;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const cookieAttrs = (maxAge) => `Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export const learnerCookie = (learnerId) => `${LEARNER_COOKIE}=${sign({ lid: learnerId }, LEARNER_MAX_AGE)}; ${cookieAttrs(LEARNER_MAX_AGE)}`;
export const clearLearnerCookie = () => `${LEARNER_COOKIE}=; ${cookieAttrs(0)}`;
export const assessorCookie = () => `${ASSESSOR_COOKIE}=${sign({ role: 'assessor' }, ASSESSOR_MAX_AGE)}; ${cookieAttrs(ASSESSOR_MAX_AGE)}`;
export const clearAssessorCookie = () => `${ASSESSOR_COOKIE}=; ${cookieAttrs(0)}`;

export function learnerIdFrom(req) {
  const data = verify(parseCookies(req)[LEARNER_COOKIE]);
  return data?.lid || null;
}
export function isAssessor(req) {
  return verify(parseCookies(req)[ASSESSOR_COOKIE])?.role === 'assessor';
}

// Every API call needs the custom header, which a plain cross site form post cannot set.
export function requireHeader(req) {
  if (req.headers.get('x-harbourdesk') !== '1') throw Object.assign(new Error('missing_header'), { status: 400 });
}

export function json(body, status = 200, cookies = []) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(err) {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error(err);
  return json({ error: status >= 500 ? 'server_error' : err.message, ...(err.extra || {}) }, status);
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw Object.assign(new Error('bad_json'), { status: 400 });
  }
}

// ---------- assessor sign in ----------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function passcodeMatches(given) {
  const real = process.env.ASSESSOR_PASSCODE || '';
  const a = createHash('sha256').update(String(given ?? '')).digest();
  const b = createHash('sha256').update(real).digest();
  return real.length >= 16 && timingSafeEqual(a, b);
}

// Returns true when the passcode is right. Throws 429 when locked, 401 when wrong, 503 when unset.
export async function assessorSignIn(passcode) {
  if ((process.env.ASSESSOR_PASSCODE || '').length < 16) {
    throw Object.assign(new Error('assessor_not_configured'), { status: 503 });
  }
  await query(`INSERT INTO assessor_throttle (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  const row = await one(`SELECT * FROM assessor_throttle WHERE id = 1`);
  const now = Date.now();
  if (row.locked_until && new Date(row.locked_until).getTime() > now) {
    const wait = Math.ceil((new Date(row.locked_until).getTime() - now) / 1000);
    throw Object.assign(new Error('locked'), { status: 429, extra: { retryAfterSeconds: wait } });
  }
  if (passcodeMatches(passcode)) {
    await query(`UPDATE assessor_throttle SET failures = 0, window_start = now(), locked_until = NULL WHERE id = 1`);
    return true;
  }
  const inWindow = now - new Date(row.window_start).getTime() < WINDOW_MS && !row.locked_until;
  const failures = inWindow ? row.failures + 1 : 1;
  const lock = failures >= MAX_FAILURES;
  await query(
    `UPDATE assessor_throttle
        SET failures = $1,
            window_start = CASE WHEN $2 THEN window_start ELSE now() END,
            locked_until = CASE WHEN $3 THEN now() + interval '15 minutes' ELSE NULL END
      WHERE id = 1`,
    [lock ? 0 : failures, inWindow, lock]
  );
  throw Object.assign(new Error(lock ? 'locked' : 'wrong_passcode'), {
    status: lock ? 429 : 401,
    extra: lock ? { retryAfterSeconds: 900 } : {}
  });
}
