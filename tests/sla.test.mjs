import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slaDue } from '../netlify/functions/lib/marking.mjs';

const authoring = JSON.parse(readFileSync(new URL('../seed/authoring.json', import.meta.url)));
const key = JSON.parse(readFileSync(new URL('../netlify/functions/lib/key.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../netlify/functions/lib/catalog.json', import.meta.url)));

// Section 5.1, typed out independently of authoring.json.
const TABLE = {
  1: ['08:10', 'Mon 08:25', 'Mon 09:10', 'Mon 12:10', 'Tue 08:10'],
  2: ['08:20', 'Mon 08:35', 'Mon 09:20', 'Mon 12:20', 'Tue 08:20'],
  3: ['08:35', 'Mon 08:50', 'Mon 09:35', 'Mon 12:35', 'Tue 08:35'],
  4: ['09:05', 'Mon 09:20', 'Mon 10:05', 'Mon 13:05', 'Tue 09:05'],
  5: ['09:15', 'Mon 09:30', 'Mon 10:15', 'Mon 13:15', 'Tue 09:15'],
  6: ['09:40', 'Mon 09:55', 'Mon 10:40', 'Mon 13:40', 'Tue 09:40'],
  7: ['10:00', 'Mon 10:15', 'Mon 11:00', 'Mon 14:00', 'Tue 10:00'],
  8: ['10:30', 'Mon 10:45', 'Mon 11:30', 'Mon 14:30', 'Tue 10:30'],
  9: ['11:00', 'Mon 11:15', 'Mon 12:00', 'Mon 15:00', 'Tue 11:00'],
  10: ['11:20', 'Mon 11:35', 'Mon 12:20', 'Mon 15:20', 'Tue 11:20'],
  11: ['11:45', 'Mon 12:00', 'Mon 12:45', 'Mon 15:45', 'Tue 11:45'],
  12: ['12:10', 'Mon 12:25', 'Mon 13:10', 'Mon 16:10', 'Tue 12:10']
};
const KEY_PRIORITY = { 1: 'P3', 2: 'P3', 3: 'P3', 4: 'P3', 5: 'P3', 6: 'P3', 7: 'P2', 8: 'P4', 9: 'P4', 10: 'P3', 11: 'P4', 12: 'P1' };

test('slaDue matches all 48 times in section 5.1', () => {
  let count = 0;
  for (const [n, row] of Object.entries(TABLE)) {
    ['P1', 'P2', 'P3', 'P4'].forEach((p, i) => {
      assert.equal(slaDue(row[0], p), row[i + 1], `ticket ${n} ${p}`);
      count++;
    });
  }
  assert.equal(count, 48);
});

test('authoring.json SLA rows equal the section 5.1 table', () => {
  for (const [n, row] of Object.entries(TABLE)) {
    const a = authoring.sla[n];
    assert.equal(a.arrival, row[0]);
    assert.deepEqual([a.P1, a.P2, a.P3, a.P4], row.slice(1));
  }
});

test('the key SLA option for each ticket is the section 6.1 priority time', () => {
  for (const [n, p] of Object.entries(KEY_PRIORITY)) {
    const k = key.tickets[n];
    assert.equal(k.priority, p);
    const text = catalog.tickets[n].sla.find((o) => o.id === k.sla).text;
    assert.equal(text, TABLE[n][['P1', 'P2', 'P3', 'P4'].indexOf(p) + 1]);
  }
});

test('business hours roll over the end of the day and the weekend', () => {
  // Friday 30 Oct 2026, 16:00 + 4 business hours = Monday 10:00.
  const fri = new Date(Date.UTC(2026, 9, 30, 16, 0));
  assert.equal(slaDue(fri, 'P3'), 'Mon 10:00');
  // P4 on Friday lands on Monday.
  assert.equal(slaDue(new Date(Date.UTC(2026, 9, 30, 9, 30)), 'P4'), 'Mon 09:30');
  // P1 runs on clock time, even after hours.
  assert.equal(slaDue(new Date(Date.UTC(2026, 9, 26, 17, 55)), 'P1'), 'Mon 18:10');
});
