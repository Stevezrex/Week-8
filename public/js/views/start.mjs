// #/start. Name and email, the shift brief, attempt pips and Begin or Resume.
import { h, icon, mountScene, plural, fmtClock } from '../ui.mjs';
import { api, ApiError, serverTime } from '../api.mjs';

const BRIEF = {
  intro: 'You are the customer support agent on the Monday shift at Harbourline Broadband Ltd., a fictional internet provider in Lagos. Handle 12 customer contacts in HarbourDesk. Complete the ticket register and create two knowledge base articles based on repeat issues in the queue.',
  records: 'Available records: 10 customer records, 12 contacts from email, chat and call notes, internal messages, and the Harbourline Hub with the company’s statuses, priorities, response targets, tags, teams and policies.',
  attempts: 'Attempts: You have 3 attempts. Logging out ends your shift and uses one attempt.'
};

function pips(used) {
  return h('span', { class: 'pip-set', 'aria-hidden': 'true' },
    [0, 1, 2].map((i) => h('span', { class: `pip ${i < used ? 'pip-off' : 'pip-on'}` })));
}

export async function render(ctx) {
  const root = h('div', { class: 'start' });
  const left = h('main', { id: 'main', class: 'start-left', tabindex: '-1' });
  const scene = h('div', { class: 'scene' });
  root.append(left, h('div', { class: 'start-right', 'aria-hidden': 'true' }, scene,
    h('div', { class: 'desk-card' },
      h('span', { class: 'where num', text: 'Lagos, Monday 26 October 2026, 08:00 WAT' }),
      h('span', { class: 'live-dot', text: 'Support desk open' }))));

  function draw() {
    const state = ctx.getServerState();
    const att = state?.attempts || { used: 0, remaining: 3, submitted: 0 };
    const active = state?.active;
    left.replaceChildren(content(state, att, active));
    if (left.isConnected) focusFirst();
  }
  function focusFirst() {
    const first = left.querySelector('input, button.btn-primary');
    if (first && (document.activeElement === document.body || !left.contains(document.activeElement))) first.focus({ preventScroll: true });
  }

  function content(state, att, active) {
    const wrap = h('div', { class: 'start-inner view-in' });
    wrap.append(
      h('div', { class: 'start-brand' }, h('img', { src: '/img/logo.svg', alt: 'Harbourline', width: 40, height: 40 }), 'Harbourline'),
      h('div', {}, h('h1', { text: 'HarbourDesk' }),
        h('p', { class: 'sub', text: 'Harbourline Broadband support desk practical' })));

    const timeFact = active
      ? `${fmtClock(new Date(active.deadlineAt).getTime() - serverTime())} remaining`
      : '60 minute shift';
    wrap.append(h('ul', { class: 'facts' },
      h('li', {}, icon('clock'), h('span', { class: 'num', text: timeFact })),
      h('li', {}, icon('layout-list'), '12 contacts to work'),
      h('li', {}, icon('user-round'), '10 customer records'),
      h('li', {}, icon('file-text'), 'Ticket register and two knowledge base articles')));

    wrap.append(h('div', { class: 'stack muted', 'data-role': 'brief' },
      h('p', { text: BRIEF.intro }), h('p', { text: BRIEF.records }), h('p', { text: BRIEF.attempts })));

    if (state) wrap.append(signedInBlock(state, att, active));
    else wrap.append(formBlock());
    wrap.append(h('p', { class: 't-caption', text: 'Your name and email are stored for assessment records.' }));
    return wrap;
  }

  // ---------- not signed in ----------
  function formBlock() {
    const name = h('input', { class: 'input', id: 'f-name', name: 'name', type: 'text', autocomplete: 'name', required: true, 'aria-describedby': 'f-name-help f-name-err', maxlength: 120 });
    const email = h('input', { class: 'input', id: 'f-email', name: 'email', type: 'email', autocomplete: 'email', required: true, 'aria-describedby': 'f-email-err', maxlength: 254 });
    const nameErr = h('p', { class: 'err', id: 'f-name-err', hidden: true });
    const emailErr = h('p', { class: 'err', id: 'f-email-err', hidden: true });
    const formErr = h('p', { class: 'err', role: 'alert', hidden: true });
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Begin shift');
    const form = h('form', { class: 'stack', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'f-name', text: 'Name' }), name,
        h('p', { class: 'help', id: 'f-name-help', text: 'Use the same name each time so your saved work is found.' }), nameErr),
      h('div', { class: 'field' }, h('label', { for: 'f-email', text: 'Email' }), email, emailErr),
      h('div', { class: 'pips' }, pips(0), h('span', { class: 't-label', text: '3 attempts available' })),
      formErr, btn);

    const show = (el, input, msg) => { el.textContent = msg; el.hidden = !msg; input.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      formErr.hidden = true;
      const n = name.value.trim();
      const m = email.value.trim();
      show(nameErr, name, n ? '' : 'Enter your name.');
      show(emailErr, email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m) ? '' : 'Enter a valid email address.');
      if (!n || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) { (n ? email : name).focus(); return; }
      btn.disabled = true;
      try {
        let state = await api.enter(n, m);
        await ctx.signedIn(state);
        // A learner with no earlier shift goes straight in. Anyone else chooses what to do next.
        if (!state.active && state.attempts.submitted === 0 && state.attempts.remaining > 0) {
          state = await api.start();
          await ctx.signedIn(state);
          ctx.navigate('#/queue');
        } else {
          draw();
        }
      } catch (err) {
        btn.disabled = false;
        formErr.textContent = err instanceof ApiError && err.status === 400
          ? 'Check your name and email address and try again.'
          : 'HarbourDesk could not complete that request. Try again in a moment.';
        formErr.hidden = false;
      }
    });
    return form;
  }

  // ---------- signed in ----------
  function signedInBlock(state, att, active) {
    const remaining = att.remaining;
    const box = h('div', { class: 'stack' });
    box.append(h('p', {}, 'Signed in as ', h('strong', { text: state.learner.name }), '. ',
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: async () => { try { await api.signout(); } catch { /* the cookie expires on its own */ } location.reload(); } }, 'Not you? Sign out')));
    const statusText = active
      ? `Shift in progress. ${plural(remaining, 'attempt', 'attempts')} remaining after this one.`
      : remaining > 0
        ? `You have ${plural(remaining, 'attempt', 'attempts')} remaining.`
        : 'You have no attempts remaining.';
    box.append(h('div', { class: 'pips' }, pips(att.used), h('span', { class: 't-label', text: statusText })));

    if (active) {
      box.append(h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await ctx.signedIn(await api.start()); ctx.navigate('#/queue'); } catch { e.currentTarget.disabled = false; }
      } }, 'Resume shift'));
    } else if (remaining > 0) {
      box.append(h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await ctx.signedIn(await api.start()); ctx.navigate('#/queue'); } catch { e.currentTarget.disabled = false; }
      } }, 'Begin shift'));
    } else {
      box.append(h('p', { class: 't-sub', text: 'Your shift has ended. Your work has been recorded. You have no attempts remaining.' }));
    }
    return box;
  }

  draw();
  mountScene(scene, 'hero-dawn.svg');
  return { title: 'Start', el: root, afterMount: focusFirst };
}
