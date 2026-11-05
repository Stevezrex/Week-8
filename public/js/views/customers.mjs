// #/customers. Search by name, phone, email, account or address.
import { h, icon, avatar, accountChip, emptyState } from '../ui.mjs';

const digits = (s) => String(s).replace(/\D/g, '');

export async function render(ctx) {
  const { customers } = await ctx.loadData();
  const list = customers.customers;
  const results = h('div', { 'aria-live': 'polite' });

  function card(c) {
    const row = (ic, label, value) => [h('dt', {}, icon(ic), h('span', { text: label })), h('dd', { class: 'num', text: value })];
    return h('article', { class: 'panel cust-card' },
      h('div', { class: 'cust-head' },
        avatar(c.avatar, 56, { business: c.business }),
        h('div', { class: 'stack' },
          h('h2', { text: c.name }),
          h('div', { class: 'row row-wrap' }, accountChip(c.status), h('span', { class: 'chip chip-plan' }, c.plan),
            c.business ? h('span', { class: 'chip chip-business' }, icon('building-2'), 'Business') : null))),
      h('dl', { class: 'deflist' },
        row('phone', 'Phone', c.phone), row('mail', 'Email', c.email), row('map-pin', 'Address', c.address),
        row('id-card', 'Account', c.account), row('calendar', 'Renewal', c.renewal)));
  }

  function draw(q) {
    const text = q.trim();
    if (!text) { results.replaceChildren(emptyState('Search for a customer to see their record.')); return; }
    const low = text.toLowerCase();
    const d = digits(text);
    const hits = list.filter((c) =>
      [c.name, c.email, c.account, c.address, c.plan].some((v) => v.toLowerCase().includes(low)) ||
      (d.length >= 3 && digits(c.phone).includes(d)) || c.phone.includes(text));
    if (!hits.length) { results.replaceChildren(emptyState(`No customer matches “${text}”. Search by name, phone, email, account or address.`)); return; }
    results.replaceChildren(h('div', { class: 'cards' }, hits.map(card)));
  }

  const input = h('input', { class: 'input', id: 'c-search', type: 'search', autocomplete: 'off', placeholder: 'Name, phone, email, account or address', oninput: (e) => draw(e.target.value) });
  draw('');
  const el = h('div', {},
    h('div', { class: 'page-head' }, h('h1', { text: 'Customer Search' }), h('p', { class: 'muted', text: `Records shown as at ${customers.asAt}` })),
    h('div', { class: 'field search search-lg', role: 'search' }, h('label', { for: 'c-search', class: 'visually-hidden', text: 'Search customers' }), icon('search'), input),
    h('div', { class: 'stack' }, results));
  return { title: 'Customer Search', el, crumbs: [{ label: 'Customer Search' }] };
}
