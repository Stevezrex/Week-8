// Writes the logo, harbour scenes, textures, avatars, icon sprite and fonts. Output is committed.
// Run: npm run assets. Every build is identical because all randomness comes from fixed seeds.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAvatar } from '@dicebear/core';
import { openPeeps } from '@dicebear/collection';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const img = join(pub, 'img');
const avatarDir = join(img, 'avatars');
const fontDir = join(pub, 'fonts');
for (const d of [img, avatarDir, fontDir]) mkdirSync(d, { recursive: true });
const write = (dir, name, text) => writeFileSync(join(dir, name), text);
const nm = (...p) => join(root, 'node_modules', ...p);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- logo (9.2)
const NAVY = '#0F2A4A';
const BEACON = '#FF8A3D';
const WAVE = 'M-4 34 C4 26 12 26 20 34 S36 42 44 34 S60 26 68 34';
const pylons = '<rect x="15" y="13" width="8.5" height="38" rx="2.5" fill="#FFFFFF"/><rect x="40.5" y="13" width="8.5" height="38" rx="2.5" fill="#FFFFFF"/>';

const logoTile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Harbourline"><title>Harbourline</title><defs><clipPath id="hd-tile"><rect width="64" height="64" rx="15"/></clipPath></defs><rect width="64" height="64" rx="15" fill="${NAVY}"/><g clip-path="url(#hd-tile)"><path d="${WAVE}" fill="none" stroke="${BEACON}" stroke-width="5" stroke-linecap="round"/></g>${pylons}</svg>\n`;
write(img, 'logo.svg', logoTile);
write(pub, 'favicon.svg', logoTile);
write(img, 'logo-mark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 8 80 48" role="img" aria-label="Harbourline"><title>Harbourline</title><path d="${WAVE}" fill="none" stroke="${BEACON}" stroke-width="5" stroke-linecap="round"/>${pylons}</svg>\n`);

// ---------------------------------------------------------------- harbour scenes (9.8)
const SCENES = {
  dawn: {
    sky: ['#0B2239', '#17506F', '#4C8F9B', '#F2B27F', '#FFC48C'],
    seaTop: '#1B5E79', seaBottom: '#0B2239',
    bands: ['#2F7088', '#15405F', '#0C2B49'],
    stays: '#D8ECF2', pylon: '#123A5A',
    lightColor: '#FFE9C9', lightX: 1120, lightY: 770, lightR: 96,
    glow: 'rgba(255,226,180,0.55)',
    window: '#FFD9A8', lit: [0.16, 0.22, 0.3],
    stars: 0, seed: 20261026
  },
  dusk: {
    sky: ['#07142A', '#16295A', '#5B3F7A', '#D8625A', '#F08A5D'],
    seaTop: '#25365F', seaBottom: '#07142A',
    bands: ['#2A3F73', '#16295A', '#0A1733'],
    stays: '#C7D2F0', pylon: '#101C42',
    lightColor: '#F6EBDD', lightX: 1180, lightY: 700, lightR: 52,
    glow: 'rgba(246,235,221,0.30)',
    window: '#FFC77A', lit: [0.3, 0.42, 0.55],
    stars: 120, seed: 20261027
  }
};

function skylineBand(rand, color, windowColor, { minH, maxH, minW, maxW, p, towerEvery }, clear) {
  let x = -30;
  let body = '';
  let win = '';
  let i = 0;
  while (x < 1640) {
    const w = Math.round(minW + rand() * (maxW - minW));
    let h = Math.round(minH + rand() * (maxH - minH));
    if (towerEvery && i % towerEvery === towerEvery - 1) h = Math.round(maxH * 1.35);
    if (clear && x + w > clear.x0 && x < clear.x1) h = Math.min(h, clear.maxH);
    const top = 880 - h;
    body += `M${x} 880V${top}h${w}V880z`;
    if (rand() < 0.22) body += `M${x + w / 2 - 1} ${top}v-${Math.round(14 + rand() * 18)}h2v${Math.round(14 + rand() * 18)}z`;
    const cols = Math.max(1, Math.floor((w - 8) / 10));
    const rows = Math.max(1, Math.floor((h - 14) / 14));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rand() < p) win += `M${x + 5 + c * 10} ${top + 8 + r * 14}h4v6h-4z`;
      }
    }
    x += w + Math.round(rand() * 6);
    i++;
  }
  return `<path d="${body}" fill="${color}"/><path d="${win}" fill="${windowColor}" opacity=".9"/>`;
}

function bridge(rand, S) {
  const deckY = 842;
  let s = '';
  const towers = [520, 1010];
  // stays: from points high on each tower to the deck on both sides
  let stays = '';
  for (const tx of towers) {
    for (let k = 0; k < 9; k++) {
      const topY = 492 + k * 12;
      const reach = 40 + k * 30;
      stays += `M${tx} ${topY}L${tx - reach} ${deckY}M${tx} ${topY}L${tx + reach} ${deckY}`;
    }
  }
  s += `<path d="${stays}" stroke="${S.stays}" stroke-width="1.2" opacity=".75" fill="none"/>`;
  // deck and piers
  s += `<rect x="130" y="${deckY}" width="1360" height="9" fill="${S.pylon}"/>`;
  let piers = '';
  for (const px of [130, 330, 520, 760, 1010, 1250, 1490]) piers += `M${px - 5} ${deckY + 9}h10V884h-10z`;
  s += `<path d="${piers}" fill="${S.pylon}"/>`;
  // towers: tapered, with a cross beam
  for (const tx of towers) {
    s += `<path d="M${tx - 9} 888L${tx - 5} 470H${tx + 5}L${tx + 9} 888z" fill="${S.pylon}"/>`;
    s += `<rect x="${tx - 14}" y="560" width="28" height="7" fill="${S.pylon}"/>`;
  }
  // orange deck lights
  let lights = '';
  let halo = '';
  for (let x = 146; x < 1480; x += 26) {
    lights += `M${x} ${deckY - 5}a2.4 2.4 0 1 0 .01 0z`;
    halo += `M${x} ${deckY - 5}a6 6 0 1 0 .01 0z`;
  }
  s += `<path d="${halo}" fill="${BEACON}" opacity=".22"/><path d="${lights}" fill="${BEACON}"/>`;
  return s;
}

function sea(rand, S) {
  let s = `<rect y="880" width="1600" height="320" fill="url(#hd-sea)"/>`;
  // reflection of the sun or moon
  let refl = '';
  for (let k = 0; k < 16; k++) {
    const y = 896 + k * 17;
    const w = 26 + k * 15 + rand() * 18;
    const x = S.lightX - w / 2 + (rand() - 0.5) * 16;
    refl += `<rect x="${r1(x)}" y="${y}" width="${r1(w)}" height="${3 + k * 0.35}" rx="2" fill="${S.lightColor}" opacity="${r1(0.5 - k * 0.025) < 0.08 ? 0.08 : r1(0.5 - k * 0.025)}"/>`;
  }
  s += refl;
  // ripples that grow with depth
  let rip = '';
  for (let k = 0; k < 150; k++) {
    const t = Math.pow(rand(), 1.6);
    const y = 892 + t * 300;
    const len = 14 + t * 90 + rand() * 30;
    const x = rand() * 1700 - 50;
    rip += `M${r1(x)} ${r1(y)}h${r1(len)}`;
  }
  s += `<path d="${rip}" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity=".12" fill="none"/>`;
  return s;
}

function fibres() {
  // three lines running across the water towards the horizon
  const lines = [
    { d: 'M-60 1230C240 1120 420 1060 560 1010S760 920 830 884', color: BEACON, w: 5 },
    { d: 'M200 1260C420 1150 560 1090 700 1040S900 930 880 884', color: '#9BE3DF', w: 3.5 },
    { d: 'M-120 1160C120 1090 300 1030 470 990S720 910 780 884', color: BEACON, w: 3.5 }
  ];
  let s = '';
  for (const l of lines) {
    s += `<path d="${l.d}" fill="none" stroke="${l.color}" stroke-width="${l.w * 3.2}" stroke-linecap="round" opacity=".14"/>`;
    s += `<path d="${l.d}" fill="none" stroke="${l.color}" stroke-width="${l.w}" stroke-linecap="round" stroke-opacity=".95"/>`;
  }
  return s;
}

function buoy() {
  const x = 250;
  const y = 1020;
  return (
    `<ellipse cx="${x}" cy="${y + 92}" rx="74" ry="9" fill="#FFFFFF" opacity=".12"/>` +
    `<ellipse cx="${x}" cy="${y + 92}" rx="46" ry="5" fill="#FFFFFF" opacity=".16"/>` +
    `<path d="M${x - 34} ${y + 86}L${x - 22} ${y + 18}H${x + 22}L${x + 34} ${y + 86}z" fill="${NAVY}"/>` +
    `<path d="M${x - 30} ${y + 62}L${x - 26} ${y + 44}H${x + 26}L${x + 30} ${y + 62}z" fill="#FFFFFF"/>` +
    `<rect x="${x - 4}" y="${y - 46}" width="8" height="64" fill="${NAVY}"/>` +
    `<circle class="buoy-glow" cx="${x}" cy="${y - 58}" r="38" fill="${BEACON}" opacity=".28"/>` +
    `<circle class="buoy-light" cx="${x}" cy="${y - 58}" r="15" fill="${BEACON}"/>` +
    `<circle cx="${x}" cy="${y - 58}" r="6" fill="#FFE2C6"/>`
  );
}

function scene(name) {
  const S = SCENES[name];
  const rand = mulberry32(S.seed);
  const stops = S.sky.map((c, i) => `<stop offset="${[0, 0.25, 0.55, 0.8, 1][i]}" stop-color="${c}"/>`).join('');
  let stars = '';
  for (let i = 0; i < S.stars; i++) {
    const x = r1(rand() * 1600);
    const y = r1(rand() * 640);
    if (Math.hypot(x - S.lightX, y - S.lightY) < 90) continue;
    stars += `<circle cx="${x}" cy="${y}" r="${r1(0.7 + rand() * 1.3)}" opacity="${r1(0.35 + rand() * 0.65)}"/>`;
  }
  const bandSpecs = [
    { minH: 120, maxH: 230, minW: 44, maxW: 96, p: S.lit[0], towerEvery: 7 },
    { minH: 80, maxH: 190, minW: 36, maxW: 82, p: S.lit[1], towerEvery: 0 },
    { minH: 46, maxH: 120, minW: 30, maxW: 70, p: S.lit[2], towerEvery: 0 }
  ];
  const clear = { x0: S.lightX - S.lightR - 40, x1: S.lightX + S.lightR + 40, maxH: 64 };
  const far = skylineBand(rand, S.bands[0], S.window, bandSpecs[0], clear);
  const mid = skylineBand(rand, S.bands[1], S.window, bandSpecs[1], clear);
  const near = skylineBand(rand, S.bands[2], S.window, bandSpecs[2], clear);
  const br = bridge(rand, S);
  const sx = S.lightX;
  const sy = S.lightY;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" focusable="false">` +
    `<defs>` +
    `<linearGradient id="hd-sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="880">${stops}</linearGradient>` +
    `<linearGradient id="hd-sea" gradientUnits="userSpaceOnUse" x1="0" y1="880" x2="0" y2="1200"><stop offset="0" stop-color="${S.seaTop}"/><stop offset="1" stop-color="${S.seaBottom}"/></linearGradient>` +
    `<radialGradient id="hd-glow" gradientUnits="userSpaceOnUse" cx="${sx}" cy="${sy}" r="${name === 'dawn' ? 560 : 380}"><stop offset="0" stop-color="${S.glow}"/><stop offset="1" stop-color="${S.glow.replace(/[\d.]+\)$/, '0)')}"/></radialGradient>` +
    `</defs>` +
    `<rect width="1600" height="880" fill="url(#hd-sky)"/>` +
    `<rect width="1600" height="880" fill="url(#hd-glow)"/>` +
    (S.stars ? `<g fill="${S.lightColor}">${stars}</g>` : '') +
    `<circle cx="${sx}" cy="${sy}" r="${S.lightR}" fill="${S.lightColor}"/>` +
    far + mid + near + br +
    sea(rand, S) +
    fibres() +
    buoy() +
    `</svg>\n`
  );
}
write(img, 'hero-dawn.svg', scene('dawn'));
write(img, 'hero-dusk.svg', scene('dusk'));

// ---------------------------------------------------------------- contour texture (9.8)
// Marching squares on a field that repeats every 600 units, so the tile is seamless.
function contourTile() {
  const SIZE = 600;
  const N = 75; // cells per side
  const C = SIZE / N;
  const comps = [
    [1, 0, 1.0, 0.4], [0, 1, 0.9, 1.9], [1, 1, 0.6, 3.1], [2, 1, 0.45, 0.7], [1, -2, 0.4, 2.2], [3, 2, 0.22, 4.4]
  ];
  const f = (x, y) => comps.reduce((a, [k, l, amp, ph]) => a + amp * Math.sin((2 * Math.PI * (k * x + l * y)) / SIZE + ph), 0);
  const g = Array.from({ length: N + 1 }, (_, i) => Array.from({ length: N + 1 }, (_, j) => f(i * C, j * C)));
  const levels = [-1.8, -1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35, 1.8];
  let d = '';
  for (const L of levels) {
    const pts = new Map(); // edge id -> [x, y]
    const adj = new Map(); // edge id -> [neighbour ids]
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    };
    const lerp = (v1, v2) => (L - v1) / (v2 - v1);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const tl = g[i][j], tr = g[i + 1][j], br = g[i + 1][j + 1], bl = g[i][j + 1];
        const code = (tl > L ? 8 : 0) | (tr > L ? 4 : 0) | (br > L ? 2 : 0) | (bl > L ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const top = `h:${i}:${j}`, bottom = `h:${i}:${j + 1}`, left = `v:${i}:${j}`, right = `v:${i + 1}:${j}`;
        pts.set(top, [(i + lerp(tl, tr)) * C, j * C]);
        pts.set(bottom, [(i + lerp(bl, br)) * C, (j + 1) * C]);
        pts.set(left, [i * C, (j + lerp(tl, bl)) * C]);
        pts.set(right, [(i + 1) * C, (j + lerp(tr, br)) * C]);
        const centreHigh = (tl + tr + br + bl) / 4 > L;
        switch (code) {
          case 1: case 14: link(left, bottom); break;
          case 2: case 13: link(bottom, right); break;
          case 3: case 12: link(left, right); break;
          case 4: case 11: link(top, right); break;
          case 6: case 9: link(top, bottom); break;
          case 7: case 8: link(left, top); break;
          case 5: if (centreHigh) { link(left, top); link(bottom, right); } else { link(left, bottom); link(top, right); } break;
          case 10: if (centreHigh) { link(left, bottom); link(top, right); } else { link(left, top); link(bottom, right); } break;
          default: break;
        }
      }
    }
    const seen = new Set();
    const walk = (start) => {
      const line = [start];
      seen.add(start);
      let prev = null;
      let cur = start;
      for (;;) {
        const next = (adj.get(cur) || []).find((n) => n !== prev && !seen.has(n));
        if (!next) break;
        line.push(next);
        seen.add(next);
        prev = cur;
        cur = next;
      }
      return line;
    };
    const emit = (ids, closed) => {
      if (ids.length < 2) return;
      d += ids.map((id, k) => `${k ? 'L' : 'M'}${r1(pts.get(id)[0])} ${r1(pts.get(id)[1])}`).join('') + (closed ? 'z' : '');
    };
    for (const [id, n] of adj) if (n.length === 1 && !seen.has(id)) emit(walk(id), false);
    for (const [id] of adj) if (!seen.has(id)) emit(walk(id), true);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true"><path d="${d}" fill="none" stroke="#E4EBF2" stroke-width="1" stroke-linejoin="round"/></svg>\n`;
}
write(img, 'contours.svg', contourTile());

// ---------------------------------------------------------------- rail lines and empty state
write(img, 'rail-lines.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" aria-hidden="true"><g fill="none" stroke="#FFFFFF" stroke-opacity=".06" stroke-width="1.5" stroke-linecap="round">` +
  `<path d="M-10 196C50 150 110 232 170 176S230 150 250 160"/>` +
  `<path d="M-10 214C60 176 118 246 184 196S236 178 250 186"/>` +
  `<path d="M-10 170C40 132 100 206 160 150S224 118 250 130"/>` +
  `<path d="M-10 232C70 204 130 252 196 218S240 208 250 212"/>` +
  `<path d="M-10 146C30 110 90 180 150 124S214 92 250 104"/>` +
  `</g></svg>\n`);

write(img, 'empty.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">` +
  `<ellipse cx="48" cy="84" rx="30" ry="4.5" fill="#D0D7E0"/><ellipse cx="48" cy="84" rx="18" ry="2.5" fill="#B8C2CF"/>` +
  `<path d="M30 80L36 50H60L66 80z" fill="${NAVY}"/><path d="M33 68L35 58H61L63 68z" fill="#FFFFFF"/>` +
  `<rect x="45" y="22" width="6" height="30" fill="${NAVY}"/>` +
  `<circle cx="48" cy="18" r="13" fill="${BEACON}" opacity=".28"/><circle cx="48" cy="18" r="8" fill="${BEACON}"/><circle cx="48" cy="18" r="3" fill="#FFE2C6"/>` +
  `</svg>\n`);

// ---------------------------------------------------------------- avatars (9.7)
const PEOPLE = [
  ['c01', 'short2', 'smile', 'ae5d29', 'chin', null, '8fa7df', 'dbeafe'],
  ['c02', 'twists', 'calm', '694d3d', null, null, 'e78276', 'fde8d8'],
  ['c03', 'longCurly', 'smile', 'ae5d29', null, null, '9ddadb', 'e6f4f5'],
  ['c04', 'flatTop', 'smileBig', 'd08b5b', null, null, 'ffcf77', 'ede9fe'],
  ['c05', 'cornrows2', 'calm', '694d3d', null, null, 'e279c7', 'fef3c7'],
  ['c06', 'bantuKnots', 'calm', 'ae5d29', null, null, '78e185', 'dcfce7'],
  ['c07', 'shaved2', 'serious', '694d3d', null, 'glasses2', '8fa7df', 'dbeafe'],
  ['c08', 'hijab', 'smile', 'd08b5b', null, null, '9ddadb', 'fde8d8'],
  ['c09', 'grayShort', 'calm', 'ae5d29', 'moustache3', null, 'fdea6b', 'e6f4f5'],
  ['c10', 'turban', 'smile', '694d3d', null, null, 'e78276', 'ede9fe'],
  ['tola', 'longAfro', 'explaining', 'ae5d29', null, 'glasses', '0f2a4a', 'ffedd5']
];
for (const [file, head, face, skin, hair, acc, clothes, bg] of PEOPLE) {
  const svg = createAvatar(openPeeps, {
    seed: `harbourdesk-${file}`,
    head: [head], face: [face], skinColor: [skin], clothingColor: [clothes], backgroundColor: [bg],
    facialHair: hair ? [hair] : undefined, facialHairProbability: hair ? 100 : 0,
    accessories: acc ? [acc] : undefined, accessoriesProbability: acc ? 100 : 0,
    maskProbability: 0, radius: 50, flip: false
  }).toString();
  write(avatarDir, `${file}.svg`, svg + '\n');
}
write(avatarDir, 'unknown.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="hd-av"><circle cx="32" cy="32" r="32"/></clipPath></defs>` +
  `<g clip-path="url(#hd-av)"><rect width="64" height="64" fill="#E2E8F0"/><circle cx="32" cy="25" r="11" fill="#94A3B8"/><path d="M8 66C8 49 19 41 32 41S56 49 56 66z" fill="#94A3B8"/></g></svg>\n`);

// ---------------------------------------------------------------- icon sprite (9.6)
const ICONS = [
  'inbox', 'users', 'message-square', 'building-2', 'book-open', 'table-2', 'log-out', 'menu', 'x',
  'mail', 'message-circle', 'phone-incoming', 'phone',
  'circle-dashed', 'circle-dot', 'hourglass', 'circle-check', 'circle',
  'flag', 'tag', 'siren',
  'headset', 'credit-card', 'wrench', 'map-pin', 'network', 'landmark',
  'user-round', 'id-card', 'router', 'wifi', 'wifi-off', 'zap', 'lock', 'shield-check', 'file-text',
  'clock', 'timer', 'triangle-alert', 'info', 'cloud-check', 'cloud-upload', 'search', 'check',
  'chevron-left', 'chevron-right', 'arrow-left', 'arrow-right', 'layout-list', 'user-round-x',
  'calendar' // renewal date on Customer Search cards
];
let symbols = '';
for (const name of ICONS) {
  const file = nm('lucide-static', 'icons', `${name}.svg`);
  if (!existsSync(file)) throw new Error(`Lucide icon missing: ${name}`);
  const inner = readFileSync(file, 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '').trim();
  symbols += `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`;
}
write(img, 'icons.svg', `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${symbols}</svg>\n`);

// ---------------------------------------------------------------- fonts and licences (9.4)
const FONTS = [
  ['@fontsource-variable/plus-jakarta-sans', 'plus-jakarta-sans-latin-wght-normal.woff2', 'plus-jakarta-sans-latin.woff2'],
  ['@fontsource-variable/plus-jakarta-sans', 'plus-jakarta-sans-latin-ext-wght-normal.woff2', 'plus-jakarta-sans-latin-ext.woff2'],
  ['@fontsource-variable/bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2', 'bricolage-grotesque-latin.woff2'],
  ['@fontsource-variable/bricolage-grotesque', 'bricolage-grotesque-latin-ext-wght-normal.woff2', 'bricolage-grotesque-latin-ext.woff2']
];
for (const [pkg, from, to] of FONTS) copyFileSync(nm(pkg, 'files', from), join(fontDir, to));

const ofl = (pkg) => readFileSync(nm(pkg, 'LICENSE'), 'utf8').trim();
write(fontDir, 'LICENSES.txt',
  `HarbourDesk third party licences\n================================\n\n` +
  `FONTS\n-----\nPlus Jakarta Sans and Bricolage Grotesque are licensed under the SIL Open Font License 1.1.\n\n` +
  `== Plus Jakarta Sans ==\n${ofl('@fontsource-variable/plus-jakarta-sans')}\n\n` +
  `== Bricolage Grotesque ==\n${ofl('@fontsource-variable/bricolage-grotesque')}\n\n` +
  `AVATARS\n-------\nThe people avatars use the Open Peeps illustration style by Pablo Stanley, released under CC0 1.0 (public domain dedication, no attribution required).\nThey were generated with the DiceBear library (MIT licence).\n\n` +
  `ICONS\n-----\nIcons are from Lucide and carry the ISC licence.\n\n${readFileSync(nm('lucide-static', 'LICENSE'), 'utf8').trim()}\n`);

console.log('assets written');
