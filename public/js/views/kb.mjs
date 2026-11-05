// #/kb (two article cards) and #/kb/1, #/kb/2 (article editor with outline and live preview).
import { h, icon, banner } from '../ui.mjs';
import { getArticle, updateArticle, articleParts } from '../store.mjs';

const PARTS = [
  ['tickets', 'Tickets covered', 'f-tickets'],
  ['title', 'Title', 'f-title'],
  ['issue', 'Issue', 'f-issue'],
  ['environment', 'Environment', 'f-environment'],
  ['steps', 'Steps', 'f-step-1'],
  ['verification', 'Verification', 'f-verification'],
  ['stop', 'Stop condition', 'f-stop'],
  ['leaveOut', 'Details to leave out', 'f-leaveOut']
];

export async function render(ctx) {
  return ctx.params[0] ? editor(ctx, Number(ctx.params[0])) : list(ctx);
}

// ---------- list ----------
async function list(ctx) {
  const O = ctx.store.active.options.articles;
  const cards = [1, 2].map((n) => {
    const a = getArticle(n);
    const parts = articleParts(n);
    const done = parts.filter((p) => p[2]).length;
    const title = O.title.find((o) => o.id === a.title)?.text;
    return h('a', { class: 'panel kb-card', href: `#/kb/${n}` },
      h('span', { class: 'kb-no', text: `Article ${n}` }),
      h('h2', { class: 't-section', text: title || 'Untitled article' }),
      h('p', { class: 'muted num', text: `${done} of 8 parts complete` }),
      h('span', { class: `chip ${done === 8 ? 'chip-saved' : 'chip-draft'}` }, icon(done === 8 ? 'circle-check' : 'circle-dashed'), done === 8 ? 'Saved' : 'Draft'));
  });
  const el = h('div', {}, banner('Knowledge Base', 'Write two articles for the repeat issues in the queue'), h('div', { class: 'kb-cards' }, cards));
  return { title: 'Knowledge Base', el, crumbs: [{ label: 'Knowledge Base' }] };
}

// ---------- editor ----------
async function editor(ctx, n) {
  if (n !== 1 && n !== 2) { ctx.navigate('#/kb'); return { title: 'Knowledge Base', el: h('div'), crumbs: [] }; }
  const { contacts, customers } = await ctx.loadData();
  const O = ctx.store.active.options.articles;
  const textOf = (group, id) => O[group].find((o) => o.id === id)?.text || null;
  const first = Object.fromEntries(customers.customers.map((c) => [c.id, c.name]));
  const a0 = getArticle(n);

  const dropdown = (field, label) => {
    const sel = h('select', { class: 'select', id: `f-${field}`, onchange: (e) => { updateArticle(n, { [field]: e.target.value || null }); refresh(); } },
      h('option', { value: '', text: 'Select' }),
      O[field].map((o) => h('option', { value: o.id, selected: o.id === a0[field], text: o.text, title: o.text })));
    return h('div', { class: 'field' }, h('label', { for: `f-${field}`, text: label }), sel);
  };

  // tickets covered
  const ticketBoxes = [];
  const ticketsField = h('fieldset', { class: 'field', id: 'f-tickets' }, h('legend', { class: 't-label', text: 'Tickets covered' }),
    h('p', { class: 'help', text: 'Choose every ticket this article is written for.' }),
    h('div', { class: 'chip-row' }, contacts.map((c) => {
      const name = c.unverified ? `${first[c.customer].split(' ')[0]} (unverified)` : first[c.customer];
      const input = h('input', { type: 'checkbox', value: String(c.n), checked: a0.tickets.includes(c.n),
        onchange: () => {
          const cur = new Set(getArticle(n).tickets);
          if (input.checked) cur.add(c.n); else cur.delete(c.n);
          updateArticle(n, { tickets: [...cur].sort((x, y) => x - y) });
          refresh();
        } });
      ticketBoxes.push(input);
      return h('label', { class: 'check-chip' }, input, h('span', {}, icon('file-text'), `Ticket ${c.n} · ${name}`, icon('check', 'tick')));
    })));

  // six step slots
  const stepSelects = [];
  const stepsField = h('fieldset', { class: 'field stack' }, h('legend', { class: 't-label', text: 'Steps' }),
    h('p', { class: 'help', text: 'Pick one step for each slot, in the order they happen. A step can be used once.' }),
    Array.from({ length: 6 }, (_, i) => {
      const sel = h('select', { class: 'select', id: `f-step-${i + 1}`, 'aria-label': `Step ${i + 1}`, onchange: (e) => {
        const steps = [...getArticle(n).steps];
        steps[i] = e.target.value || null;
        updateArticle(n, { steps });
        refresh();
      } });
      stepSelects.push(sel);
      return h('div', { class: 'step-slot' }, h('span', { class: 'step-no num', 'aria-hidden': 'true', text: String(i + 1) }), sel);
    }));
  function drawSteps() {
    const steps = getArticle(n).steps;
    stepSelects.forEach((sel, i) => {
      const used = steps.filter((s, j) => s && j !== i);
      sel.replaceChildren(h('option', { value: '', text: `Select step ${i + 1}` }),
        ...O.steps.map((o) => h('option', { value: o.id, selected: steps[i] === o.id, disabled: used.includes(o.id), title: o.text, text: used.includes(o.id) ? `${o.text} (used)` : o.text })));
      sel.value = steps[i] || '';
    });
  }

  // leave out
  const leaveBoxes = [];
  const leaveField = h('fieldset', { class: 'field', id: 'f-leaveOut' }, h('legend', { class: 't-label', text: 'Details to leave out' }),
    h('p', { class: 'help', text: 'Tick what a published article must not contain.' }),
    h('div', { class: 'chip-row' }, O.leaveOut.map((o) => {
      const input = h('input', { type: 'checkbox', value: o.id, checked: a0.leaveOut.includes(o.id),
        onchange: () => {
          const cur = new Set(getArticle(n).leaveOut);
          if (input.checked) cur.add(o.id); else cur.delete(o.id);
          updateArticle(n, { leaveOut: [...cur] });
          refresh();
        } });
      leaveBoxes.push(input);
      return h('label', { class: 'check-chip' }, input, h('span', {}, o.text, icon('check', 'tick')));
    })));

  const card = (id, title, ...kids) => h('section', { class: 'panel part-card', id, 'aria-labelledby': `${id}-h` }, h('h2', { class: 't-section', id: `${id}-h`, text: title }), h('div', { class: 'stack' }, kids));
  const formCol = h('div', {},
    card('c-tickets', 'Tickets covered', ticketsField),
    card('c-context', 'Title, issue and environment', dropdown('title', 'Title'), dropdown('issue', 'Issue'), dropdown('environment', 'Environment')),
    card('c-steps', 'Steps', stepsField),
    card('c-check', 'Verification and stop condition', dropdown('verification', 'Verification'), dropdown('stop', 'Stop condition')),
    card('c-leave', 'Details to leave out', leaveField));

  // outline
  const outlineLinks = PARTS.map(([key, label, target]) => {
    const a = h('a', { href: `#/kb/${n}`, 'data-key': key, onclick: (e) => { e.preventDefault(); const t = document.getElementById(target); t?.scrollIntoView({ block: 'center' }); (t?.matches('select, input') ? t : t?.querySelector('select, input'))?.focus(); } });
    return a;
  });
  const outline = h('nav', { class: 'outline', 'aria-label': 'Article parts' }, h('p', { class: 't-label', text: 'Parts' }), outlineLinks);

  // preview
  const previewBody = h('div', { class: 'preview-card', 'aria-label': 'Article preview' });
  const none = () => h('p', { class: 'placeholder', text: 'Not written yet' });
  const section = (label, node) => h('div', {}, h('h3', { text: label }), node);

  function drawPreview() {
    const a = getArticle(n);
    const t = (g, id) => (id ? h('p', { text: textOf(g, id) }) : none());
    const steps = a.steps.filter(Boolean);
    previewBody.replaceChildren(
      h('p', { class: 't-caption', text: 'Knowledge Base / Internet' }),
      a.title ? h('h2', { text: textOf('title', a.title) }) : h('h2', { class: 'muted', text: 'Untitled article' }),
      section('Issue', t('issue', a.issue)),
      section('Environment', t('environment', a.environment)),
      section('Steps', steps.length ? h('ol', {}, a.steps.map((s, i) => (s ? h('li', { value: i + 1, text: textOf('steps', s) }) : null))) : none()),
      section('Verification', t('verification', a.verification)),
      section('Stop condition', t('stop', a.stop)),
      section('Details to leave out', a.leaveOut.length ? h('ul', {}, a.leaveOut.map((id) => h('li', { text: textOf('leaveOut', id) }))) : none()));
  }
  const previewFold = h('details', { class: 'preview-fold', open: true }, h('summary', { class: 'btn btn-secondary' }, 'Article preview'), previewBody);
  const mq = window.matchMedia('(min-width: 1024px)');
  const syncFold = () => { if (mq.matches) previewFold.open = true; };
  mq.addEventListener('change', syncFold); syncFold();

  function refresh() {
    const parts = articleParts(n);
    parts.forEach(([key, label, ok], i) => {
      const a = outlineLinks[i];
      a.className = ok ? 'done' : '';
      a.replaceChildren(icon(ok ? 'circle-check' : 'circle', 'icon-20'), h('span', { text: label }), h('span', { class: 'visually-hidden', text: ok ? ', complete' : ', not complete' }));
    });
    drawSteps();
    drawPreview();
  }
  refresh();

  const el = h('div', {}, banner(`Article ${n}`, 'Knowledge Base article editor'),
    h('div', { class: 'editor' }, outline, formCol, h('aside', { class: 'preview', 'aria-label': 'Preview' }, previewFold)));
  return {
    title: `Article ${n}`, el,
    crumbs: [{ label: 'Knowledge Base', href: '#/kb' }, { label: `Article ${n}` }],
    cleanup: () => mq.removeEventListener('change', syncFold)
  };
}
