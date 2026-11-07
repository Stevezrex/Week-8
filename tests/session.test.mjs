import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setDatabase } from '../netlify/functions/lib/db.mjs';
import { learnerCookie, learnerIdFrom, assessorSignIn, sign, verify } from '../netlify/functions/lib/session.mjs';

function runtime(t, values) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Netlify');
  Object.defineProperty(globalThis, 'Netlify', {
    configurable: true,
    value: { env: { get: (name) => values[name] } }
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'Netlify', previous);
    else delete globalThis.Netlify;
  });
}

test('learner session uses the Netlify runtime secret and rejects altered cookies', (t) => {
  runtime(t, { SESSION_SECRET: randomBytes(32).toString('hex') });
  const cookie = learnerCookie('learner-123');
  const req = new Request('https://example.com/api/state', { headers: { cookie } });
  assert.equal(learnerIdFrom(req), 'learner-123');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const token = sign({ lid: 'learner-123' }, 60);
  assert.equal(verify(`${token}changed`), null);
  assert.equal(verify(sign({ lid: 'learner-123' }, -1)), null);
});

test('session signing fails closed when the runtime secret is missing or too short', (t) => {
  const values = {};
  runtime(t, values);
  assert.throws(() => learnerCookie('learner-123'), { status: 500 });
  values.SESSION_SECRET = 'short';
  assert.throws(() => learnerCookie('learner-123'), { status: 500 });
});

test('assessor sign-in uses the Netlify runtime passcode and preserves rejection of wrong passcodes', async (t) => {
  const passcode = randomBytes(24).toString('hex');
  runtime(t, { ASSESSOR_PASSCODE: passcode });
  setDatabase({ pool: { query: async () => ({ rows: [{
    failures: 0, window_start: new Date(), locked_until: null
  }] }) } });
  t.after(() => setDatabase(null));
  assert.equal(await assessorSignIn(passcode), true);
  await assert.rejects(assessorSignIn('incorrect'), { status: 401 });
});
