// Small rendering helpers. Every interpolated value goes through esc() unless
// wrapped in raw(), so user text can never inject markup.
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: true, s: String(s) });

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function value(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(value).join('');
  if (typeof v === 'object' && v[RAW]) return v.s;
  return esc(v);
}

/** Tagged template that escapes interpolations and returns raw() markup. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? value(vals[i]) : ''); });
  return raw(out);
}

export function render(el, markup) {
  el.innerHTML = markup.s ?? String(markup);
}

export function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parse = (d) => new Date(`${d}T00:00:00Z`);

export const dates = {
  add(d, n) { return new Date(parse(d).getTime() + n * 86400000).toISOString().slice(0, 10); },
  diff(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); },
  pretty(d) { const x = parse(d); return `${DOW[x.getUTCDay()]}, ${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`; },
  short(d) { const x = parse(d); return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`; },
  month(d) { const x = parse(d); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][x.getUTCMonth()]} ${x.getUTCFullYear()}`; },
  dow(d) { return parse(d).getUTCDay(); },
  local() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  },
};

export const PHASE_META = {
  menstrual: { name: 'Menstrual', color: 'var(--menstrual)', emoji: '🌑' },
  follicular: { name: 'Follicular', color: 'var(--follicular)', emoji: '🌒' },
  ovulatory: { name: 'Ovulatory', color: 'var(--ovulatory)', emoji: '🌕' },
  luteal: { name: 'Luteal', color: 'var(--luteal)', emoji: '🌘' },
};

export function phasePill(phase) {
  if (!phase) return html``;
  const m = PHASE_META[phase];
  return html`<span class="pill ${phase}">${m.emoji} ${m.name}</span>`;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Collect named form values into a plain object. */
export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/** Delegate clicks on [data-action] within root to handlers[action]. */
export function onActions(root, handlers) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
}

/** Simple SVG line chart. series: [{values:[number|null], color, label}] */
export function lineChart({ series, xLabels = [], yMin = 0, yMax = 5, height = 160, bands = [] }) {
  const w = 600, h = height, padL = 28, padB = 20, padT = 8, padR = 8;
  const n = Math.max(...series.map((s) => s.values.length), 1);
  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(n - 1, 1);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);
  let out = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">`;
  for (const b of bands) {
    out += `<rect x="${x(b.from)}" y="${padT}" width="${Math.max(0, x(b.to) - x(b.from))}" height="${h - padT - padB}" style="fill:${b.color}" opacity=".12"/>`;
  }
  for (let t = 0; t <= 4; t++) {
    const v = yMin + ((yMax - yMin) * t) / 4;
    out += `<line x1="${padL}" x2="${w - padR}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".08"/>`;
    out += `<text x="2" y="${y(v) + 3}">${Math.round(v * 10) / 10}</text>`;
  }
  xLabels.forEach((l, i) => { if (l != null) out += `<text x="${x(i) - 4}" y="${h - 4}">${esc(l)}</text>`; });
  for (const s of series) {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    out += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((v, i) => { if (v != null && s.dots) out += `<circle cx="${x(i)}" cy="${y(v)}" r="3" style="fill:${s.color}"/>`; });
  }
  return raw(out + '</svg>');
}

/** True in the single-file phone build, which has no server behind it. */
export const STANDALONE = Boolean(globalThis.LUNARIA_STANDALONE);

/** In-page confirmation dialog (native confirm() is blocked in some frames). */
export function askConfirm(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal card" role="dialog" aria-modal="true">
      <p>${esc(message)}</p>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn btn-ghost" data-r="0">Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : ''}" data-r="1">${esc(confirmLabel)}</button>
      </div></div>`;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return done(false);
      const b = e.target.closest('[data-r]');
      if (b) done(b.dataset.r === '1');
    });
    document.body.appendChild(wrap);
    wrap.querySelector('[data-r="1"]').focus();
  });
}
