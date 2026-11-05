// Database access. All queries are parameterized ($1, $2 ...). User input never enters SQL text.
// The Netlify Database client exposes a pg compatible pool for both of its drivers.
import { getDatabase } from '@netlify/database';

let conn = null;

export function db() {
  if (!conn) conn = getDatabase();
  return conn;
}

// Tests inject an adapter shaped like { pool: { query, connect } }.
export function setDatabase(adapter) {
  conn = adapter;
}

export async function query(text, params = []) {
  const res = await db().pool.query(text, params);
  return res.rows;
}

export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

// Run fn(client) inside one transaction. client.query(text, params) returns { rows }.
export async function tx(fn) {
  const client = await db().pool.connect();
  const q = async (text, params = []) => (await client.query(text, params)).rows;
  try {
    await client.query('BEGIN');
    const result = await fn({ query: q, one: async (t, p) => (await q(t, p))[0] || null });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

export const isUniqueViolation = (err) => err && err.code === '23505';
