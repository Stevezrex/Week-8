// Learner API: /api/enter, /api/state, /api/attempt/start, /api/work, /api/submit, /api/signout.
import {
  json, errorResponse, readJson, requireHeader, learnerIdFrom, learnerCookie, clearLearnerCookie
} from './lib/session.mjs';
import { enterLearner, resolveLearner } from './lib/identity.mjs';
import { getState, startAttempt, saveWork, submitAttempt, closeoutFor } from './lib/attempts.mjs';
import { one } from './lib/db.mjs';

async function currentLearner(req) {
  const id = learnerIdFrom(req);
  if (!id) throw Object.assign(new Error('not_signed_in'), { status: 401 });
  const learner = await resolveLearner(id);
  if (!learner) throw Object.assign(new Error('not_signed_in'), { status: 401 });
  return learner;
}

// A state that ended the shift also ends the session.
function respond(state, learner) {
  if (state.ended) return json({ ended: true, closeout: state.closeout }, 200, [clearLearnerCookie()]);
  return json(state, 200, [learnerCookie(learner.id)]);
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, '');
    const opts = { origin: url.origin };
    requireHeader(req);

    if (route === '/api/enter' && req.method === 'POST') {
      const body = await readJson(req);
      const { learner, outcome } = await enterLearner(body.name, body.email);
      const state = await getState(learner, opts);
      return json({ ...state, outcome }, 200, [learnerCookie(learner.id)]);
    }

    if (route === '/api/signout' && req.method === 'POST') {
      return json({ ok: true }, 200, [clearLearnerCookie()]);
    }

    const learner = await currentLearner(req);

    if (route === '/api/state' && req.method === 'GET') {
      return respond(await getState(learner, opts), learner);
    }

    if (route === '/api/attempt/start' && req.method === 'POST') {
      const state = await startAttempt(learner, opts);
      if (!state.ended && !state.active) return json({ ...state, noAttempts: true });
      return respond(state, learner);
    }

    if (route === '/api/work' && req.method === 'PUT') {
      const body = await readJson(req);
      const result = await saveWork(learner, body, opts);
      if (result.ended) return json({ ended: true, closeout: result.closeout }, 200, [clearLearnerCookie()]);
      return json(result);
    }

    if (route === '/api/submit' && req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body.attemptId !== 'string') throw Object.assign(new Error('invalid_request'), { status: 400 });
      const owned = await one(`SELECT id FROM attempts WHERE id = $1 AND learner_id = $2`, [body.attemptId, learner.id]);
      if (!owned) throw Object.assign(new Error('attempt_not_found'), { status: 404 });
      const attempt = await submitAttempt(body.attemptId, body.reason === 'deadline' ? 'deadline' : 'logout', opts);
      const closeout = await closeoutFor(learner.id, attempt.submit_reason);
      return json({ ended: true, closeout }, 200, [clearLearnerCookie()]);
    }

    return json({ error: 'not_found' }, 404);
  } catch (err) {
    return errorResponse(err);
  }
}

export const config = { path: ['/api/enter', '/api/state', '/api/attempt/start', '/api/work', '/api/submit', '/api/signout'] };
