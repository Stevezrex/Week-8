// #/shift-ended. Closeout message, signed out state and remaining attempts. No score or mark appears.
import { h, icon, plural } from '../ui.mjs';

export async function render(ctx) {
  const raw = ctx.query.get('left');
  const left = raw !== null && /^[0-3]$/.test(raw) ? Number(raw) : null;

  let message;
  if (left === null) message = 'Your shift has ended. Your work has been recorded. You are signed out. Sign in to see how many attempts remain.';
  else if (left > 0) message = `Your shift has ended. Your work has been recorded. You are signed out. You have ${plural(left, 'attempt', 'attempts')} remaining. Sign in to start another shift when you are ready.`;
  else message = 'Your shift has ended. Your work has been recorded. You are signed out. You have no attempts remaining.';

  const pips = left === null ? null : h('span', { class: 'pip-set', 'aria-hidden': 'true' },
    [0, 1, 2].map((i) => h('span', { class: `pip ${i < 3 - left ? 'pip-off' : 'pip-on'}` })));

  const el = h('main', { id: 'main', class: 'ended', tabindex: '-1' },
    h('div', { class: 'scene', 'aria-hidden': 'true' }, h('img', { src: '/img/hero-dusk.svg', alt: '', width: 1600, height: 1200 })),
    h('div', { class: 'ended-card view-in' },
      icon('circle-check'),
      h('h1', { class: 't-title', text: 'Shift ended' }),
      h('p', { text: message }),
      pips,
      left === null || left > 0 ? h('a', { class: 'btn btn-primary', href: '#/start' }, 'Sign in') : null));
  return { title: 'Shift ended', el };
}
