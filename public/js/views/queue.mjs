// #/queue. Table of the 12 contacts with search, channel filter and status filter.
import { h, icon, avatar, statusChip, channelLabel, emptyState, STATUS, CHANNEL, announce } from '../ui.mjs';
import { getTicket, ticketProgress, completeTicketCount, subscribe } from '../store.mjs';

export async function render(ctx) {
  const { contacts } = await ctx.loadData();
  const { options } = { options: ctx.store.active.options };
  const statusText = Object.fromEntries(options.common.status.map((o) => [o.id, o.text]));
  const filter = { q: '', channel: 'all', status: 'all' };

  const meterText = h('span', { class: 'num' });
  const meterFill = h('span');
  const meter = h('div', { class: 'meter' }, meterText, h('div', { class: 'meter-bar', 'aria-hidden': 'true' }, meterFill));
  const tbody = h('tbody');
  const wrap = h('div', { class: 'table-wrap' },
    h('table', { class: 'tbl cards-sm' },
      h('caption', { class: 'visually-hidden', text: 'Contacts in your queue' }),
      h('thead', {}, h('tr', {}, ['Contact', 'Summary', 'Channel', 'Arrived', 'Status', 'Case record'].map((t) => h('th', { scope: 'col', text: t })))),
      tbody));
  const emptyBox = h('div', { hidden: true });

  function progressCell(n) {
    const p = ticketProgress(n);
    if (p.complete) return h('span', { class: 'prog prog-done' }, icon('circle-check', 'icon-20'), h('span', { class: 'visually-hidden', text: 'Complete' }));
    if (p.filled === 0) return h('span', { class: 'prog prog-none' }, icon('circle-dashed', 'icon-20'), h('span', { class: 'visually-hidden', text: 'Not started' }));
    return h('span', { class: 'prog prog-part' }, icon('circle-dot', 'icon-20'), `${p.filled} of 9`);
  }

  function matches(c) {
    if (filter.channel !== 'all' && c.channel !== filter.channel) return false;
    const st = getTicket(c.n).status;
    if (filter.status === 'none' ? !!st : filter.status !== 'all' && st !== filter.status) return false;
    const q = filter.q.trim().toLowerCase();
    if (q && !`${c.sender} ${c.summary} ${c.id} ${c.message}`.toLowerCase().includes(q)) return false;
    return true;
  }

  function draw() {
    const done = completeTicketCount();
    meterText.textContent = `${done} of 12 case records complete`;
    meterFill.style.width = `${(done / 12) * 100}%`;
    const list = contacts.filter(matches);
    tbody.replaceChildren(...list.map((c) => {
      const t = getTicket(c.n);
      const go = () => ctx.navigate(`#/ticket/${c.n}`);
      const tr = h('tr', { onclick: (e) => { if (!e.target.closest('a')) go(); } },
        h('td', { class: 'cell-first' }, h('div', { class: 'cell-person' },
          avatar(c.avatar, 24, { unverified: c.unverified }),
          h('div', {}, h('a', { href: `#/ticket/${c.n}`, text: c.sender }), h('span', { class: 't-caption num', text: c.id })))),
        h('td', { class: 'summary-cell', 'data-label': 'Summary', text: c.summary }),
        h('td', { 'data-label': 'Channel' }, channelLabel(c.channel)),
        h('td', { class: 'num', 'data-label': 'Arrived', text: c.arrival }),
        h('td', { 'data-label': 'Status' }, t.status ? statusChip(t.status) : h('span', { class: 'muted', text: 'Not set' })),
        h('td', { 'data-label': 'Case record' }, progressCell(c.n)));
      return tr;
    }));
    wrap.hidden = list.length === 0;
    emptyBox.hidden = list.length > 0;
    if (!list.length) {
      emptyBox.replaceChildren(emptyState('No contacts match these filters. Clear the filters to see all 12.',
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: clearFilters }, 'Clear filters')));
    }
  }

  function clearFilters() {
    filter.q = ''; filter.channel = 'all'; filter.status = 'all';
    search.value = ''; statusSel.value = 'all';
    syncSeg();
    draw();
    announce('Filters cleared.');
  }

  const search = h('input', { class: 'input', id: 'q-search', type: 'search', placeholder: 'Search contacts', autocomplete: 'off',
    oninput: (e) => { filter.q = e.target.value; draw(); } });
  const segBtns = [['all', 'All', null], ['email', CHANNEL.email.text, 'mail'], ['chat', CHANNEL.chat.text, 'message-circle'], ['call', CHANNEL.call.text, 'phone-incoming']]
    .map(([v, label, ic]) => h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(v === 'all'),
      onclick: () => { filter.channel = v; syncSeg(); draw(); } }, ic ? icon(ic) : null, label));
  function syncSeg() { for (const b of segBtns) b.setAttribute('aria-pressed', String(b.dataset.v === filter.channel)); }
  const statusSel = h('select', { class: 'select', id: 'q-status', onchange: (e) => { filter.status = e.target.value; draw(); } },
    h('option', { value: 'all', text: 'All statuses' }),
    Object.entries(STATUS).map(([id, s]) => h('option', { value: id, text: s.text })),
    h('option', { value: 'none', text: 'Not set' }));

  const el = h('div', {},
    h('div', { class: 'page-head' }, h('h1', { text: 'My Queue' }), meter),
    h('div', { class: 'filters', role: 'search' },
      h('div', { class: 'field search' }, h('label', { for: 'q-search', class: 'visually-hidden', text: 'Search contacts' }), icon('search', 'icon-20'), search),
      h('div', { class: 'field' }, h('span', { class: 't-label', id: 'seg-label', text: 'Channel' }), h('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'seg-label' }, segBtns)),
      h('div', { class: 'field' }, h('label', { for: 'q-status', text: 'Status' }), statusSel)),
    wrap, emptyBox);
  draw();
  const unsub = subscribe((t) => { if (t === 'work') draw(); });
  return { title: 'My Queue', el, crumbs: [{ label: 'My Queue' }], cleanup: unsub };
}
