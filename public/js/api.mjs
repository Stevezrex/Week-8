// Fetch wrapper. Every call carries the X-HarbourDesk header. serverNow keeps the countdown honest.

let offsetMs = 0; // server time minus browser time

export const serverOffset = () => offsetMs;
export const serverTime = () => Date.now() + offsetMs;

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `http_${status}`);
    this.status = status;
    this.data = data || {};
    this.network = status === 0;
  }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-HarbourDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (data?.serverNow) offsetMs = new Date(data.serverNow).getTime() - Date.now();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  enter: (name, email) => call('POST', '/api/enter', { name, email }),
  state: () => call('GET', '/api/state'),
  start: () => call('POST', '/api/attempt/start'),
  save: (attemptId, baseRevision, changes) => call('PUT', '/api/work', { attemptId, baseRevision, changes }),
  submit: (attemptId, reason) => call('POST', '/api/submit', { attemptId, reason }),
  signout: () => call('POST', '/api/signout')
};
