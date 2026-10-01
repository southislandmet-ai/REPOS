/* Shared: top navigation, Settings (API key saved in this browser), fetch wrapper, NZ time helpers. */
export const NAV = [
  { href: 'suite.html', label: 'Model Suite', desc: 'Upload & catalogue model charts' },
  { href: 'viewer.html', label: 'SIMODEL Viewer', desc: 'High-definition South Island maps' },
  { href: 'index.html', label: 'Publish charts', desc: 'Forecaster chat & 6-hourly package' },
];
export const settings = {
  get apiKey() { try { return localStorage.getItem('simodel.apiKey') || ''; } catch { return ''; } },
  set apiKey(v) { try { v ? localStorage.setItem('simodel.apiKey', v) : localStorage.removeItem('simodel.apiKey'); } catch {} },
  get brand() { try { return JSON.parse(localStorage.getItem('simodel.brand') || '{}'); } catch { return {}; } },
  set brand(v) { try { localStorage.setItem('simodel.brand', JSON.stringify(v || {})); } catch {} },
  get basemap() { try { return localStorage.getItem('simodel.basemap') || 'simodel'; } catch { return 'simodel'; } },
  set basemap(v) { try { localStorage.setItem('simodel.basemap', v); } catch {} },
};
export function apiFetch(url, opts = {}) {
  const headers = new Headers(opts.headers || {});
  const key = settings.apiKey; if (key) headers.set('x-anthropic-key', key);
  if (opts.body && typeof opts.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(url, { ...opts, headers });
}
export async function readSse(res, onEvent) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(chunk)?.[1]; const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (ev && data) { try { onEvent(ev, JSON.parse(data)); } catch (e) { console.warn('bad SSE', e); } }
    }
  }
}
// ───── NZ time ─────
export function nzOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - date.getTime()) / 60000);
}
export function tzAbbr(date) { return nzOffsetMinutes(date) === 780 ? 'NZDT' : 'NZST'; }
export function fmtNz(iso, opts = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '—';
  return `${new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', ...opts }).format(d)} ${tzAbbr(d)}`;
}
export function fmtUtc(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ') + 'Z'; }
export function relHours(iso, now = Date.now()) { const h = Math.round((Date.parse(iso) - now) / 3600e3); if (Number.isNaN(h)) return ''; return h >= 0 ? `+${h} h` : `${h} h`; }
export function windowLabelNz(iso, accumH) {
  const b = new Date(iso); if (!accumH || accumH < 0) return fmtNz(iso);
  const a = new Date(b.getTime() - accumH * 3600e3);
  const f = (d) => new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).format(d);
  return `${f(a)} → ${f(b)} ${tzAbbr(b)}`;
}

// ───── chrome ─────
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'html') n.innerHTML = v; else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };
export { el };

export function mountNav(active, extra = []) {
  const header = document.querySelector('header.top'); if (!header) return;
  const nav = el('nav', { class: 'mainnav' }, ...NAV.map((n) => el('a', { href: n.href, class: n.href === active ? 'on' : '', title: n.desc }, n.label)));
  header.querySelector('.logo')?.after(nav);
  const btn = el('button', { class: 'btn small', id: 'btnSettings', onclick: openSettings }, settings.apiKey ? '⚙ Settings · key saved' : '⚙ Settings · add API key');
  header.append(...extra, btn);
}
export function openSettings() {
  document.querySelector('.modal')?.remove();
  const brand = settings.brand;
  const key = el('input', { type: 'password', placeholder: 'sk-ant-…', value: settings.apiKey, style: 'width:100%', autocomplete: 'off' });
  const bn = el('input', { type: 'text', placeholder: 'Brand / site name on charts', value: brand.name || '', style: 'width:100%' });
  const bt = el('input', { type: 'text', placeholder: 'Tagline', value: brand.tagline || '', style: 'width:100%' });
  const status = el('div', { class: 'help' });
  const modal = el('div', { class: 'modal', onclick: (e) => { if (e.target === modal) modal.remove(); } },
    el('div', { class: 'modal-card' },
      el('h3', {}, 'Settings'),
      el('p', { class: 'help' }, 'Your Anthropic API key is stored only in this browser (localStorage) and sent to your own SIMODEL server with each request. It never goes anywhere else.'),
      el('label', { class: 'lbl' }, 'Anthropic API key'), key,
      el('div', { class: 'row', style: 'margin:6px 0 14px' }, el('button', { class: 'btn small', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } }, 'show / hide'), el('button', { class: 'btn small', onclick: async () => { settings.apiKey = key.value.trim(); status.textContent = 'Testing…'; try { const r = await apiFetch('/api/health').then((x) => x.json()); status.textContent = r.has_credentials ? `✓ Key accepted by the server · model ${r.model}` : '✗ No key available'; } catch { status.textContent = '✗ Server unreachable'; } } }, 'Save & test'), status),
      el('label', { class: 'lbl' }, 'Branding'), bn, el('div', { style: 'height:6px' }), bt,
      el('div', { class: 'row', style: 'margin-top:14px; justify-content:flex-end' }, el('button', { class: 'btn', onclick: () => modal.remove() }, 'Close'), el('button', { class: 'btn primary', onclick: () => { settings.apiKey = key.value.trim(); settings.brand = { name: bn.value.trim(), tagline: bt.value.trim() }; document.querySelector('#btnSettings').textContent = settings.apiKey ? '⚙ Settings · key saved' : '⚙ Settings · add API key'; modal.remove(); document.dispatchEvent(new CustomEvent('settings-changed')); } }, 'Save'))));
  document.body.append(modal); key.focus();
}
export function toast(msg, kind = '') { const existing = document.querySelectorAll('.toast.show').length; const t = el('div', { class: `toast ${kind}`, style: `--toast-offset:${existing * 46}px` }, msg); document.body.append(t); setTimeout(() => t.classList.add('show'), 10); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500); }
