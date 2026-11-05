// #/messages. The handover message from Tola Akinyemi.
import { h, icon, avatar } from '../ui.mjs';

export async function render(ctx) {
  const { hub } = await ctx.loadData();
  const m = hub.handover;
  const wide = window.matchMedia('(min-width: 880px)').matches;
  let open = wide;

  const root = h('div', {});
  const layout = h('div', { class: 'mail-layout' });

  function draw() {
    const thread = h('button', { type: 'button', class: 'thread', 'aria-current': open ? 'true' : null, onclick: () => { open = true; draw(); } },
      avatar('tola.svg', 40),
      h('span', {}, h('span', { class: 'subject', text: m.from }), h('span', { class: 't-caption', text: m.subject }), h('span', { class: 't-caption num', text: m.time })));
    const list = h('section', { 'aria-label': 'Messages' }, h('ul', {}, h('li', {}, thread)));
    const message = h('article', { class: 'panel' },
      !wide ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { open = false; draw(); } }, icon('arrow-left', 'icon-20'), 'Back to messages') : null,
      h('div', { class: 'msg-head' }, avatar('tola.svg', 56),
        h('div', {}, h('h2', { class: 't-section', text: m.from }), h('p', { class: 'muted', text: m.role }), h('p', { class: 't-caption num', text: `Monday 26 October, ${m.time}` }))),
      h('h3', { class: 't-sub', text: m.subject }),
      h('p', { class: 'prose', text: m.text }));
    if (wide) layout.replaceChildren(list, message);
    else layout.replaceChildren(open ? message : list);
    if (open) ctx.markMessagesRead();
  }
  draw();
  root.append(h('div', { class: 'page-head' }, h('h1', { text: 'Messages' })), layout);
  return { title: 'Messages', el: root, crumbs: [{ label: 'Messages' }] };
}
