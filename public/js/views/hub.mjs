// #/hub. Harbourline Hub: statuses, priorities, tags, teams, verification, payment rules, router lights.
import { h, icon, banner, statusChip, priorityChip, teamTile } from '../ui.mjs';

export async function render(ctx) {
  const { hub } = await ctx.loadData();
  const table = (head, rows) => {
    for (const tr of rows) [...tr.children].forEach((td, i) => td.setAttribute('data-label', head[i]));
    return h('table', { class: 'hub-table' },
      h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, rows));
  };

  const sections = {
    statuses: () => table(['Status', 'Use'], hub.statuses.map((s) => h('tr', {}, h('td', {}, statusChip(s.id)), h('td', { text: s.use })))),
    priorities: () => h('div', { class: 'stack' },
      table(['Priority', 'Definition', 'First response target'], hub.priorities.map((p) =>
        h('tr', {}, h('td', {}, priorityChip(p.id)), h('td', { text: p.definition }), h('td', { class: 'num', text: p.target })))),
      h('p', { class: 'prose', text: hub.slaIntro }), h('p', { class: 'prose', text: hub.slaNote })),
    tags: () => h('div', { class: 'stack' }, h('p', { text: hub.tagsIntro }),
      table(['Tag', 'Use when'], hub.tags.map((t) => h('tr', {}, h('td', {}, h('span', { class: 'chip chip-plan' }, icon('tag'), t.id)), h('td', { text: t.use }))))),
    teams: () => table(['Team', 'Responsibilities'], hub.teams.map((t) =>
      h('tr', {}, h('td', {}, h('span', { class: 'team' }, teamTile(t.id), t.name)), h('td', { text: t.use })))),
    verification: () => h('ul', { class: 'tick-list' }, hub.verification.map((v) => h('li', {}, icon('shield-check'), h('span', { text: v })))),
    payments: () => h('div', { class: 'stack' }, h('p', { class: 'prose', text: hub.payments }),
      h('div', { class: 'price-row' }, hub.prices.map((p) => h('span', { class: 'chip chip-plan num' }, `${p.plan}: ${p.price}`)))),
    lights: () => h('div', { class: 'lights' }, hub.lights.map((l) =>
      h('div', { class: 'light' }, h('span', { class: `swatch sw-${l.id}`, 'aria-hidden': 'true' }), h('div', {}, h('p', { class: 't-sub', text: l.label }), h('p', { class: 'muted', text: l.meaning })))))
  };

  const body = h('div', { class: 'hub-body' }, hub.sections.map((s) =>
    h('section', { id: `hub-${s.id}`, 'aria-labelledby': `hub-h-${s.id}` }, h('h2', { class: 't-section', id: `hub-h-${s.id}`, text: s.title }), sections[s.id]())));

  const links = hub.sections.map((s) => h('a', { href: `#/hub`, 'data-id': s.id, text: s.title, onclick: (e) => { e.preventDefault(); go(s.id); } }));
  const toc = h('nav', { class: 'toc', 'aria-label': 'Hub contents' }, links);
  const sel = h('select', { class: 'select toc-select', 'aria-label': 'Hub contents', onchange: (e) => go(e.target.value) },
    hub.sections.map((s) => h('option', { value: s.id, text: s.title })));

  function mark(id) {
    for (const a of links) { if (a.dataset.id === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }
    sel.value = id;
  }
  function go(id) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`hub-${id}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    mark(id);
  }
  mark(hub.sections[0].id);

  const io = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) mark(visible.target.id.replace('hub-', ''));
  }, { rootMargin: '-80px 0px -60% 0px' });
  setTimeout(() => body.querySelectorAll(':scope > section').forEach((s) => io.observe(s)), 0);

  const el = h('div', {}, banner('Harbourline Hub', 'Company statuses, priorities, response targets, tags, teams and policies'),
    h('div', { class: 'hub-layout' }, h('div', {}, toc, sel), body));
  return { title: 'Harbourline Hub', el, crumbs: [{ label: 'Harbourline Hub' }], cleanup: () => io.disconnect() };
}
