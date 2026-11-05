// Runs hourly. Submits shifts that passed their deadline and had no further requests.
import { sweepExpired } from './lib/attempts.mjs';

export default async function handler() {
  const result = await sweepExpired({ origin: process.env.URL });
  console.log('sweep', JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
}

export const config = { schedule: '@hourly' };
