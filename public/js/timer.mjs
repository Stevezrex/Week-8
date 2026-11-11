// Shift countdown. The deadline comes from the server; serverOffset corrects the browser clock.
import { serverTime } from './api.mjs';
import { fmtClock } from './ui.mjs';

const MIN = 60 * 1000;
export const WARNINGS = [
  { level: 'w20', at: 20 * MIN, text: 'Your shift ends in 20 minutes.', kind: 'w20', ic: 'timer', assertive: false },
  { level: 'w10', at: 10 * MIN, text: 'Your shift ends in 10 minutes.', kind: 'w10', ic: 'timer', assertive: false },
  { level: 'w5', at: 5 * MIN, text: 'Your shift ends in 5 minutes. Saved work will be recorded at closeout.', kind: 'w5', ic: 'triangle-alert', assertive: true }
];

export function levelFor(remaining) {
  if (remaining <= 5 * MIN) return 'w5';
  if (remaining <= 10 * MIN) return 'w10';
  if (remaining <= 20 * MIN) return 'w20';
  return 'normal';
}
export const pillIcon = (level) => (level === 'w5' ? 'triangle-alert' : level === 'normal' ? 'clock' : 'timer');
export const pillText = (remaining) => `Your shift ends in ${fmtClock(remaining)}`;

// onTick(remainingMs, level), onWarn(warning), onExpire(). Warnings fire once, when the time is crossed.
export function startTimer(deadlineAt, { onTick, onWarn, onExpire }) {
  const deadline = new Date(deadlineAt).getTime();
  const fired = new Set();
  let expired = false;
  let first = true;
  function tick() {
    const remaining = deadline - serverTime();
    const level = levelFor(remaining);
    if (first) {
      // On resume, earlier warnings are not repeated.
      for (const w of WARNINGS) if (remaining <= w.at) fired.add(w.level);
      first = false;
    } else {
      for (const w of WARNINGS) {
        if (remaining <= w.at && !fired.has(w.level)) { fired.add(w.level); onWarn(w); }
      }
    }
    onTick(Math.max(0, remaining), level);
    if (remaining <= 0 && !expired) { expired = true; stop(); onExpire(); }
  }
  const id = setInterval(tick, 1000);
  const stop = () => clearInterval(id);
  tick();
  return stop;
}
