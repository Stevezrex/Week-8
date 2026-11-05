// #/ticket/1 to #/ticket/12. Contact evidence, nine field controls, case note preview, Previous and Next.
import { h, icon, avatar, channelLabel, accountChip, caseNote, selectEl } from '../ui.mjs';
import { getTicket, updateTicket, ticketProgress, subscribe } from '../store.mjs';

export async function render(ctx) {
  const n = Number(ctx.params[0]);
  if (!Number.isInteger(n) || n < 1 || n > 12) { ctx.navigate('#/queue'); return { title: 'My Queue', el: h('div'), crumbs: [] }; }
  const { contacts } = await ctx.loadData();
  const c = contacts[n - 1];
  const O = ctx.store.active.options;
  const T = O.tickets[String(n)];
  const textOf = (list, id) => list.find((o) => o.id === id)?.text || null;

  // ---------- evidence ----------
  const evidence = () => {
    const who = h('div', { class: 'who-block' },
      avatar(c.avatar, 56, { unverified: c.unverified }),
      h('div', {}, h('p', { class: 't-sub', text: c.sender }), h('p', { class: 't-caption num', text: c.id }),
        c.senderAddress && c.channel === 'chat'
          ? h('p', { class: 'row row-wrap num' }, icon('phone'), c.senderAddress, c.unverified ? accountChip('Unverified') : null)
          : null));
    const incident = c.incident ? h('p', {}, h('span', { class: 'chip chip-incident' }, icon('siren'), c.incident)) : null;
    let body;
    if (c.channel === 'email') {
      body = h('div', { class: 'stack' },
        h('dl', { class: 'mail-head' }, h('dt', { text: 'From' }), h('dd', { text: c.senderAddress ? `${c.sender} <${c.senderAddress}>` : c.sender }),
          h('dt', { text: 'Arrived' }), h('dd', { class: 'num', text: c.arrival })),
        h('div', { class: 'msg-box' }, h('p', { text: c.message })));
    } else if (c.channel === 'chat') {
      body = h('div', { class: 'stack' },
        h('p', { class: 'row t-caption' }, icon('message-circle'), h('span', { class: 'num', text: `Chat at ${c.arrival}` })),
        h('div', { class: 'bubble' }, h('p', { text: c.message })));
    } else {
      body = h('div', { class: 'note-block stack' },
        h('p', { class: 'row t-label' }, icon('phone'), h('span', { class: 'num', text: `Call note logged at ${c.arrival}` })),
        h('p', { text: c.message }));
    }
    return h('div', { class: 'evidence-card' },
      h('h2', { class: 't-section', text: 'Contact evidence' }), who, incident, body,
      h('div', { class: 'inset desk-notes' },
        h('h3', {}, icon('lock'), 'Desk notes'),
        h('dl', {}, h('dt', { text: 'Checked' }), h('dd', { text: c.checked }),
          h('dt', { text: 'Promised update' }), h('dd', { class: 'promised' }, icon('clock'), h('span', { class: 'num', text: c.promised })))));
  };

  const fold = h('details', { class: 'evidence-fold', open: true }, h('summary', {}, 'Contact evidence'), evidence());
  const mq = window.matchMedia('(min-width: 880px)');
  const syncFold = () => { if (mq.matches) fold.open = true; };
  mq.addEventListener('change', syncFold); syncFold();
  const aside = h('aside', { class: 'evidence', 'aria-label': 'Contact evidence' }, fold);

  // ---------- fields ----------
  const t0 = getTicket(n);
  const dd = (key, label, list, extra = {}) => {
    const { wrap } = selectEl({ id: `f-${key}`, label, options: list, value: t0[key],
      onChange: (v) => { updateTicket(n, { [key]: v }); refresh(); }, ...extra });
    return wrap;
  };

  const tagBoxes = new Map();
  const tagCount = h('span', { class: 'tag-count num', 'aria-live': 'polite' });
  const tagGroup = h('fieldset', { class: 'field' },
    h('legend', { class: 'visually-hidden', text: 'Tags' }),
    h('div', { class: 'row row-wrap' }, h('p', { class: 'help', text: 'Select up to three.' }), tagCount),
    h('div', { class: 'chip-row' }, O.common.tags.map((o) => {
      const input = h('input', { type: 'checkbox', value: o.id, checked: t0.tags.includes(o.id),
        onchange: () => {
          const cur = getTicket(n).tags;
          const next = input.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id);
          if (next.length > 3) { input.checked = false; return; }
          updateTicket(n, { tags: next });
          refresh();
        } });
      tagBoxes.set(o.id, input);
      return h('label', { class: 'check-chip' }, input, h('span', {}, icon('tag'), o.text, icon('check', 'tick')));
    })));

  const preview = h('p', { class: 'note-preview' });
  const previewBox = h('div', { class: 'inset', 'aria-live': 'off' }, h('p', { class: 't-label', text: 'Case note preview' }), preview);

  const form = h('div', { class: 'panel' },
    h('div', { class: 'row spread row-wrap' },
      h('h2', { class: 't-section', text: 'Case record' }), h('span', { class: 't-caption num', text: c.id })),
    h('section', { class: 'group', 'aria-labelledby': 'g-who' },
      h('h3', { class: 't-sub', id: 'g-who', text: 'Who and when' }),
      h('div', { class: 'form-grid' },
        dd('requester', 'Requester', O.common.requester),
        dd('status', 'Status', O.common.status),
        dd('priority', 'Priority', O.common.priority),
        dd('team', 'Assigned team', O.common.team),
        dd('sla', 'SLA due time', T.sla, { help: 'First response due time for the priority chosen.' }))),
    h('section', { class: 'group', 'aria-labelledby': 'g-tags' }, h('h3', { class: 't-sub', id: 'g-tags', text: 'Tags' }), tagGroup),
    h('section', { class: 'group', 'aria-labelledby': 'g-note' },
      h('h3', { class: 't-sub', id: 'g-note', text: 'Case note' }),
      h('div', { class: 'form-grid' },
        dd('finding', 'Finding', T.finding, { full: true }),
        dd('action', 'Next action', T.action, { full: true }),
        dd('ownerTime', 'Owner and due time', T.ownerTime, { full: true })),
      h('div', { class: 'stack' }, previewBox)));

  // ---------- jump strip ----------
  const stripBtns = [];
  const prevBtn = (cls = '') => h('button', { type: 'button', class: `btn btn-secondary ${cls}`, disabled: n === 1, 'aria-label': 'Previous ticket', onclick: () => ctx.navigate(`#/ticket/${n - 1}`) }, icon('chevron-left', 'icon-20'), h('span', { class: 'btn-nav-label', text: 'Previous' }));
  const nextBtn = (cls = '') => h('button', { type: 'button', class: `btn btn-secondary ${cls}`, disabled: n === 12, 'aria-label': 'Next ticket', onclick: () => ctx.navigate(`#/ticket/${n + 1}`) }, h('span', { class: 'btn-nav-label', text: 'Next' }), icon('chevron-right', 'icon-20'));
  const jumpSel = h('select', { class: 'select strip-sel', 'aria-label': 'Ticket', onchange: (e) => ctx.navigate(`#/ticket/${e.target.value}`) });
  const strip = h('nav', { class: 'strip', 'aria-label': 'Tickets' },
    prevBtn(),
    h('div', { class: 'strip-nums' }, Array.from({ length: 12 }, (_, i) => {
      const k = i + 1;
      const b = h('a', { class: 'strip-btn', href: `#/ticket/${k}` }, h('span'));
      stripBtns.push(b);
      return b;
    })),
    jumpSel,
    h('span', { class: 'strip-label num', text: `Ticket ${n} of 12` }),
    nextBtn());

  function refreshStrip() {
    stripBtns.forEach((b, i) => {
      const k = i + 1;
      const done = ticketProgress(k).complete;
      b.className = `strip-btn${done ? ' is-complete' : ''}${k === n ? ' is-current' : ''}`;
      b.setAttribute('aria-label', `Ticket ${k}${done ? ', complete' : ''}`);
      if (k === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.firstChild.replaceChildren(done ? icon('check') : String(k));
    });
    jumpSel.replaceChildren(...Array.from({ length: 12 }, (_, i) =>
      h('option', { value: String(i + 1), selected: i + 1 === n, text: `Ticket ${i + 1}${ticketProgress(i + 1).complete ? ' (complete)' : ''}` })));
  }

  function refresh() {
    const t = getTicket(n);
    const note = caseNote(textOf(T.finding, t.finding), textOf(T.action, t.action), textOf(T.ownerTime, t.ownerTime));
    preview.textContent = note || 'Choose a finding, next action and owner to build the case note.';
    preview.classList.toggle('muted', !note);
    tagCount.textContent = `${t.tags.length} of 3`;
    for (const [id, input] of tagBoxes) input.disabled = t.tags.length >= 3 && !t.tags.includes(id);
    refreshStrip();
  }
  refresh();

  const unsub = subscribe((type) => { if (type === 'work') refreshStrip(); });
  const el = h('div', {},
    h('div', { class: 'page-head' }, h('h1', { text: `Ticket ${n}` }),
      h('p', { class: 'row' }, channelLabel(c.channel), h('span', { class: 'muted num', text: `arrived ${c.arrival}` }))),
    strip,
    h('div', { class: 'ticket-layout' }, form, aside));
  return {
    title: `Ticket ${n}`, el,
    crumbs: [{ label: 'My Queue', href: '#/queue' }, { label: `Ticket ${n}` }],
    cleanup: () => { unsub(); mq.removeEventListener('change', syncFold); }
  };
}
