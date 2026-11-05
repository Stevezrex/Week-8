// #/register. All 12 tickets in a table with filters. A row opens its ticket.
import { h, icon, avatar, statusChip, priorityChip, teamLabel, emptyState, STATUS, TEAM } from '../ui.mjs';
import { getTicket, subscribe } from '../store.mjs';

export async function render(ctx) {
  const { contacts, customers } = await ctx.loadData();
  const O = ctx.store.active.options;
  const byCustomer = Object.fromEntries(customers.customers.map((c) => [c.id, c]));
  const slaText = (n, id) => O.tickets[String(n)].sla.find((o) => o.id === id)?.text || null;
  const tagText = Object.fromEntries(O.common.tags.map((t) => [t.id, t.text]));
  const f = { ticket: 'all', requester: 'all', status: 'all', priority: 'all', team: 'all', sla: 'all', tags: new Set() };

  const tbody = h('tbody');
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'tbl cards-sm' },
    h('caption', { class: 'visually-hidden', text: 'Ticket register' }),
    h('thead', {}, h('tr', {}, ['Ticket', 'Requester', 'Status', 'Priority', 'Team', 'SLA due time', 'Tags'].map((t) => h('th', { scope: 'col', text: t })))),
    tbody));
  const emptyBox = h('div', { hidden: true });
  const slaSel = h('select', { class: 'select', id: 'r-sla', onchange: (e) => { f.sla = e.target.value; draw(); } });

  function slaOptions() {
    const seen = new Set();
    for (let n = 1; n <= 12; n++) { const s = slaText(n, getTicket(n).sla); if (s) seen.add(s); }
    const times = [...seen].sort();
    slaSel.replaceChildren(h('option', { value: 'all', text: 'All times' }), ...times.map((t) => h('option', { value: t, selected: t === f.sla, text: t })), h('option', { value: 'none', selected: f.sla === 'none', text: 'Not set' }));
  }

  function matches(c) {
    const t = getTicket(c.n);
    if (f.ticket !== 'all' && String(c.n) !== f.ticket) return false;
    if (f.requester === 'none' ? !!t.requester : f.requester !== 'all' && t.requester !== f.requester) return false;
    if (f.status === 'none' ? !!t.status : f.status !== 'all' && t.status !== f.status) return false;
    if (f.priority === 'none' ? !!t.priority : f.priority !== 'all' && t.priority !== f.priority) return false;
    if (f.team === 'none' ? !!t.team : f.team !== 'all' && t.team !== f.team) return false;
    const s = slaText(c.n, t.sla);
    if (f.sla === 'none' ? !!s : f.sla !== 'all' && s !== f.sla) return false;
    for (const g of f.tags) if (!t.tags.includes(g)) return false;
    return true;
  }

  function draw() {
    slaOptions();
    const rows = contacts.filter(matches);
    tbody.replaceChildren(...rows.map((c) => {
      const t = getTicket(c.n);
      const req = t.requester ? byCustomer[t.requester] : null;
      const reqName = O.common.requester.find((o) => o.id === t.requester)?.text;
      return h('tr', { onclick: (e) => { if (!e.target.closest('a')) ctx.navigate(`#/ticket/${c.n}`); } },
        h('td', { class: 'cell-first' }, h('div', { class: 'cell-person' }, avatar(c.avatar, 24, { unverified: c.unverified }),
          h('div', {}, h('a', { href: `#/ticket/${c.n}`, text: `Ticket ${c.n}` }), h('span', { class: 't-caption num', text: c.id })))),
        h('td', { 'data-label': 'Requester' }, req ? h('span', { class: 'cell-person' }, avatar(req.avatar, 24), h('span', { text: reqName })) : h('span', { class: 'muted', text: 'Not set' })),
        h('td', { 'data-label': 'Status' }, t.status ? statusChip(t.status) : h('span', { class: 'muted', text: 'Not set' })),
        h('td', { 'data-label': 'Priority' }, t.priority ? priorityChip(t.priority) : h('span', { class: 'muted', text: 'Not set' })),
        h('td', { 'data-label': 'Team' }, t.team ? teamLabel(t.team) : h('span', { class: 'muted', text: 'Not set' })),
        h('td', { class: 'num', 'data-label': 'SLA due', text: slaText(c.n, t.sla) || 'Not set' }),
        h('td', { 'data-label': 'Tags' }, t.tags.length ? h('span', { class: 'row row-wrap' }, t.tags.map((g) => h('span', { class: 'chip chip-plan' }, tagText[g]))) : h('span', { class: 'muted', text: 'Not set' })));
    }));
    table.hidden = rows.length === 0;
    emptyBox.hidden = rows.length > 0;
    if (!rows.length) emptyBox.replaceChildren(emptyState('No tickets match these filters. Clear the filters to see all 12.',
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: clear }, 'Clear filters')));
  }

  function clear() {
    Object.assign(f, { ticket: 'all', requester: 'all', status: 'all', priority: 'all', team: 'all', sla: 'all' });
    f.tags.clear();
    for (const s of selects) s.value = 'all';
    for (const b of tagBoxes) b.checked = false;
    draw();
  }

  const mk = (id, label, key, options, extra = []) => {
    const s = h('select', { class: 'select', id, onchange: (e) => { f[key] = e.target.value; draw(); } },
      h('option', { value: 'all', text: `All` }), options.map((o) => h('option', { value: o.id, text: o.text })), extra.map((o) => h('option', { value: o.id, text: o.text })));
    return { s, wrap: h('div', { class: 'field' }, h('label', { for: id, text: label }), s) };
  };
  const NONE = [{ id: 'none', text: 'Not set' }];
  const fTicket = mk('r-ticket', 'Ticket', 'ticket', Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), text: `Ticket ${i + 1}` })));
  const fReq = mk('r-req', 'Requester', 'requester', O.common.requester, NONE);
  const fStatus = mk('r-status', 'Status', 'status', Object.entries(STATUS).map(([id, s]) => ({ id, text: s.text })), NONE);
  const fPri = mk('r-pri', 'Priority', 'priority', ['P1', 'P2', 'P3', 'P4'].map((id) => ({ id, text: id })), NONE);
  const fTeam = mk('r-team', 'Team', 'team', Object.entries(TEAM).filter(([id]) => id !== 'finance').map(([id, t]) => ({ id, text: t.text })), NONE);
  slaSel.value = 'all';
  const selects = [fTicket.s, fReq.s, fStatus.s, fPri.s, fTeam.s];

  const tagBoxes = [];
  const tagChips = h('fieldset', { class: 'field' }, h('legend', { class: 't-label', text: 'Tags' }),
    h('div', { class: 'reg-chips' }, O.common.tags.map((o) => {
      const input = h('input', { type: 'checkbox', value: o.id, onchange: () => { if (input.checked) f.tags.add(o.id); else f.tags.delete(o.id); draw(); } });
      tagBoxes.push(input);
      return h('label', { class: 'check-chip' }, input, h('span', {}, icon('tag'), o.text, icon('check', 'tick')));
    })));

  draw();
  const unsub = subscribe((t) => { if (t === 'work') draw(); });
  const el = h('div', {},
    h('div', { class: 'page-head' }, h('h1', { text: 'Ticket Register' })),
    h('div', { class: 'reg-filters', role: 'search', 'aria-label': 'Filter tickets' },
      h('div', { class: 'grid' }, fTicket.wrap, fReq.wrap, fStatus.wrap, fPri.wrap, fTeam.wrap,
        h('div', { class: 'field' }, h('label', { for: 'r-sla', text: 'SLA due time' }), slaSel)),
      tagChips),
    table, emptyBox);
  return { title: 'Ticket Register', el, crumbs: [{ label: 'Ticket Register' }], cleanup: unsub };
}
