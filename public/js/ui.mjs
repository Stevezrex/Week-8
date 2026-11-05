// Shared UI helpers: DOM builder, icons, chips, avatars, toasts, dialogs, live regions.
// Text is always set with textContent, so nothing a learner or the server sends is parsed as HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'open') { if (v) el[k] = true; }
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `/img/icons.svg#i-${name}`);
  svg.append(use);
  return svg;
}

// ---------- labels used across the app ----------
export const STATUS = {
  new: { text: 'New', icon: 'circle-dashed' },
  in_progress: { text: 'In progress', icon: 'circle-dot' },
  waiting_customer: { text: 'Waiting on customer', icon: 'hourglass' },
  waiting_internal: { text: 'Waiting on internal', icon: 'users' },
  resolved: { text: 'Resolved', icon: 'circle-check' }
};
export const CHANNEL = {
  email: { text: 'Email', icon: 'mail' },
  chat: { text: 'Chat', icon: 'message-circle' },
  call: { text: 'Call note', icon: 'phone-incoming' }
};
export const TEAM = {
  customer_support: { text: 'Customer Support', icon: 'headset' },
  billing_payments: { text: 'Billing and Payments', icon: 'credit-card' },
  field_services: { text: 'Field Services', icon: 'wrench' },
  service_changes: { text: 'Service Changes and Installations', icon: 'map-pin' },
  network_operations: { text: 'Network Operations', icon: 'network' },
  finance: { text: 'Finance', icon: 'landmark' }
};

export const statusChip = (id) => {
  const s = STATUS[id];
  return s ? h('span', { class: `chip st-${id}` }, icon(s.icon), s.text) : null;
};
export const priorityChip = (id) => (id ? h('span', { class: `chip pr-${id}` }, icon('flag'), id) : null);
export const accountChip = (status) => {
  const ic = status === 'Active' ? 'circle-check' : status === 'Inactive' ? 'circle-dashed' : 'triangle-alert';
  return h('span', { class: `chip ac-${status}` }, icon(ic), status);
};
export const channelLabel = (ch) => h('span', { class: `chan chan-${ch}` }, icon(CHANNEL[ch].icon), CHANNEL[ch].text);
export const teamTile = (id, small = false) => h('span', { class: `tile tile-${id}${small ? ' tile-sm' : ''}` }, icon(TEAM[id].icon));
export const teamLabel = (id) => h('span', { class: 'team' }, teamTile(id, true), TEAM[id].text);

export function avatar(file, size = 24, opts = {}) {
  const img = h('img', { class: `av av-${size}${opts.unverified ? ' av-unverified' : ''}`, src: `/img/avatars/${file}`, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' });
  if (!opts.business) return img;
  return h('span', { class: 'av-wrap' }, img, h('span', { class: 'badge-business', title: 'Business plan' }, icon('building-2')));
}

const TINTS = 6;
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
export function initialsAvatar(name, size = 32) {
  const first = String(name || 'a').trim().toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')[0] || 'a';
  const tint = (first.charCodeAt(0) - 97) % TINTS;
  return h('span', { class: `ini ini-${size} ini-${tint}`, 'aria-hidden': 'true' }, initials(name));
}

// ---------- formatting ----------
export function caseNote(finding, action, ownerTime) {
  if (!finding && !action && !ownerTime) return '';
  const [owner, ...rest] = (ownerTime || '').split(', ');
  return `Finding: ${finding || '-'} Next action: ${action || '-'} Owner: ${owner || '-'}. Due: ${rest.join(', ') || '-'}.`;
}
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
export const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });
};
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- announcements, toasts, dialogs ----------
export function announce(text, assertive = false) {
  const el = document.getElementById(assertive ? 'live-assertive' : 'live-polite');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 30);
}

export function toast(text, { kind = 'info', ic = 'info', timeout = 9000 } = {}) {
  const box = document.getElementById('toasts');
  const node = h('div', { class: `toast toast-${kind}` },
    icon(ic, 'icon-20'),
    h('p', { text }),
    h('button', { type: 'button', 'aria-label': 'Close message', onclick: () => node.remove() }, icon('x', 'icon-20')));
  box.append(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

let dialogOpen = false;
// Resolves with the index of the chosen button. Focus moves in and returns on close.
export function openDialog({ title, text, buttons }) {
  if (dialogOpen) return Promise.resolve(-1);
  dialogOpen = true;
  const opener = document.activeElement;
  return new Promise((resolve) => {
    const titleId = 'dlg-title';
    const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h2', { class: 't-section', id: titleId, text: title }),
      h('p', { text }),
      h('div', { class: 'dialog-actions' }, buttons.map((b, i) =>
        h('button', { type: 'button', class: `btn ${b.cls || 'btn-secondary'}`, onclick: () => done(i) }, b.label))));
    const scrim = h('div', { class: 'scrim' }, dlg);
    const focusables = () => [...dlg.querySelectorAll('button')];
    function done(i) {
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      dialogOpen = false;
      opener?.focus?.();
      resolve(i);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); done(buttons.findIndex((b) => b.cancel) );
      } else if (e.key === 'Tab') {
        const f = focusables();
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    focusables()[buttons.findIndex((b) => b.cancel) >= 0 ? buttons.findIndex((b) => b.cancel) : 0].focus();
  });
}

// ---------- scenes ----------
// The dawn scene on the start screen is injected as markup so its buoy light can pulse under the page
// stylesheet, and stop under prefers-reduced-motion. Other pictures are plain images.
export async function mountScene(container, file) {
  try {
    const res = await fetch(`/img/${file}`);
    if (!res.ok) throw new Error('scene');
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('scene');
    container.replaceChildren(document.importNode(svg, true));
  } catch {
    container.replaceChildren(h('img', { src: `/img/${file}`, alt: '' }));
  }
}

export function emptyState(message, nextStep) {
  return h('div', { class: 'empty' },
    h('img', { src: '/img/empty.svg', alt: '', width: 96, height: 96 }),
    h('p', { class: 't-sub', text: message }),
    nextStep || null);
}

export function banner(title, subtitle) {
  return h('div', { class: 'banner on-dark' },
    h('div', { class: 'banner-title' }, h('h1', { text: title }), subtitle ? h('p', { text: subtitle }) : null),
    h('div', { class: 'banner-img' }, h('img', { src: '/img/hero-dawn.svg', alt: '', width: 640, height: 480, decoding: 'async' })));
}

export function selectEl({ id, label, options, value, onChange, placeholder = 'Select', help, disabledIds = [], full = false }) {
  const sel = h('select', { class: 'select', id, onchange: (e) => onChange(e.target.value || null) },
    h('option', { value: '', text: placeholder }),
    options.map((o) => h('option', { value: o.id, selected: o.id === value, disabled: disabledIds.includes(o.id) && o.id !== value, text: o.text, title: o.text })));
  const wrap = h('div', { class: `field${full ? ' span2' : ''}` },
    h('label', { for: id, text: label }), sel, help ? h('p', { class: 'help', text: help }) : null);
  return { wrap, sel };
}
