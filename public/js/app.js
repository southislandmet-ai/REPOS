import { ChartRenderer, WEATHER_LABEL } from './map.js';
import { sampleImageFile } from './gif.js';
import { exportPng, exportAllPng, exportGif, articleText, exportJson } from './export.js';

// ───────────────────────── State ─────────────────────────
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'html') n.innerHTML = v; else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); } for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k))); return n; };

const PLACES = await fetch('data/nz_places.json').then((r) => r.json());
const REGIONS = await fetch('data/nz_regions.json').then((r) => r.json());

const DEFAULT_INPUTS = () => ({
  period_hours: 24,
  start_local: defaultStart(),
  brand: { name: '', tagline: '' },
  rain: { locations: [{ id: 'west_coast', name: 'West Coast' }, { id: 'hokitika', name: 'Hokitika' }, { id: 'milford_sound', name: 'Milford Sound' }, { id: 'canterbury', name: 'Canterbury' }, { id: 'wellington', name: 'Wellington' }, { id: 'auckland', name: 'Auckland' }], models: [{ model: 'ecmwf', run: '', values: {} }, { model: 'gfs', run: '', values: {} }, { model: 'ukmo', run: '', values: {} }] },
  snow: { locations: [{ id: 'arthurs_pass', name: "Arthur's Pass" }, { id: 'porters_pass', name: 'Porters Pass' }, { id: 'crown_range', name: 'Crown Range' }, { id: 'desert_road', name: 'Desert Road' }], models: [{ model: 'ecmwf', run: '', snow_level_m: '', values: {} }, { model: 'gfs', run: '', snow_level_m: '', values: {} }] },
  notes: '',
});
let inputs = loadJson('nzmf.inputs') || DEFAULT_INPUTS();
let uploads = [];                       // {id, name, file_type, description, frames, total_frames, animated, sent}
let session = { id: localStorage.getItem('nzmf.session') || null, pendingToolUseId: null };
let forecast = null, panels = [], selected = 0, filters = new Set(), playing = null, busy = false;
const renderer = new ChartRenderer({ regions: REGIONS, places: PLACES, brand: inputs.brand });

function loadJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function saveInputs() { localStorage.setItem('nzmf.inputs', JSON.stringify(inputs)); renderer.brand = inputs.brand; }

// ───────────────────────── NZ time helpers ─────────────────────────
function nzOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return Math.round((asUtc - date.getTime()) / 60000);
}
/** Parse "YYYY-MM-DDTHH:mm" as NZ local → Date (instant). */
function nzLocalToDate(s) {
  const guess = new Date(`${s}:00Z`);
  let off = nzOffsetMinutes(guess);
  let d = new Date(guess.getTime() - off * 60000);
  const off2 = nzOffsetMinutes(d); if (off2 !== off) d = new Date(guess.getTime() - off2 * 60000);
  return d;
}
function tzAbbr(date) { return nzOffsetMinutes(date) === 780 ? 'NZDT' : 'NZST'; }
function fmtNz(date, opts) { return new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', ...opts }).format(date); }
function hourWord(date) {
  const h = Number(fmtNz(date, { hour: 'numeric', hourCycle: 'h23' }));
  if (h === 0) return 'midnight'; if (h === 12) return 'noon';
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}
function windowLabel(a, b) {
  const da = fmtNz(a, { weekday: 'short' }), db = fmtNz(b, { weekday: 'short' });
  const hb = hourWord(b);
  return `${da} ${hourWord(a)} – ${hb === 'midnight' || da === db ? '' : db + ' '}${hb}`;
}
function defaultStart() {
  const now = new Date(); const off = nzOffsetMinutes(now);
  const nzNow = new Date(now.getTime() + off * 60000);
  const h = nzNow.getUTCHours(); const next = Math.ceil((h + 0.01) / 6) * 6;
  const d = new Date(Date.UTC(nzNow.getUTCFullYear(), nzNow.getUTCMonth(), nzNow.getUTCDate(), 0, 0)); d.setUTCHours(next);
  return d.toISOString().slice(0, 16);
}
function stepWindows() {
  const start = nzLocalToDate(inputs.start_local);
  const n = inputs.period_hours / 6, out = [];
  for (let i = 0; i < n; i++) {
    const a = new Date(start.getTime() + i * 6 * 3600e3), b = new Date(a.getTime() + 6 * 3600e3);
    out.push({ index: i + 1, t_offset_h: (i + 1) * 6, label: windowLabel(a, b), start_utc: a.toISOString().slice(0, 16) + 'Z', end_utc: b.toISOString().slice(0, 16) + 'Z', start_local: `${fmtNz(a, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} ${tzAbbr(a)}` });
  }
  return { start, windows: out };
}

// ───────────────────────── Inputs UI ─────────────────────────
function modelName(id) { return PLACES.models.find((m) => m.id === id)?.name || id; }
function locOptions(sel) {
  sel.innerHTML = '';
  const g1 = el('optgroup', { label: 'Regions' }); for (const r of PLACES.regions) g1.append(el('option', { value: `region:${r.id}` }, r.name));
  const g2 = el('optgroup', { label: 'Spots / passes' }); for (const s of PLACES.spots) g2.append(el('option', { value: `spot:${s.id}` }, s.name));
  sel.append(g1, g2);
}
function renderTable(kind) {
  const t = $(kind === 'rain' ? '#rainTable' : '#snowTable'); const data = inputs[kind];
  t.innerHTML = '';
  const head = el('tr', {}, el('th', {}, 'Model'), el('th', {}, 'Run'), kind === 'snow' ? el('th', {}, 'Snow level m') : null, ...data.locations.map((l) => el('th', {}, l.name, ' ', el('button', { class: 'del', title: 'remove column', onclick: () => { data.locations = data.locations.filter((x) => x.id !== l.id); for (const m of data.models) delete m.values[l.id]; saveInputs(); renderTable(kind); } }, '×'))));
  t.append(head);
  data.models.forEach((m, mi) => {
    const sel = el('select', { onchange: (e) => { m.model = e.target.value; saveInputs(); } }); for (const mm of PLACES.models) sel.append(el('option', { value: mm.id, selected: mm.id === m.model }, mm.name));
    const run = el('input', { type: 'text', value: m.run || '', placeholder: '00Z Thu', style: 'width:72px;padding:4px 6px', onchange: (e) => { m.run = e.target.value; saveInputs(); } });
    const cells = data.locations.map((l) => el('td', {}, el('input', { type: 'number', step: 'any', min: 0, value: m.values[l.id] ?? '', onchange: (e) => { const v = e.target.value; if (v === '') delete m.values[l.id]; else m.values[l.id] = Number(v); saveInputs(); } })));
    const sl = kind === 'snow' ? el('td', {}, el('input', { type: 'number', step: 50, value: m.snow_level_m ?? '', placeholder: 'm', onchange: (e) => { m.snow_level_m = e.target.value === '' ? '' : Number(e.target.value); saveInputs(); } })) : null;
    t.append(el('tr', {}, el('td', {}, sel), el('td', {}, run), sl, ...cells, el('td', {}, el('button', { class: 'del', title: 'remove row', onclick: () => { data.models.splice(mi, 1); saveInputs(); renderTable(kind); } }, '×'))));
  });
}
function addLocation(kind, value) {
  const [type, id] = value.split(':'); const src = type === 'region' ? PLACES.regions : PLACES.spots; const item = src.find((x) => x.id === id);
  if (!item || inputs[kind].locations.some((l) => l.id === id)) return;
  inputs[kind].locations.push({ id, name: item.name }); saveInputs(); renderTable(kind);
}
function addCustomLocation(kind, name) {
  name = name.trim(); if (!name) return; const id = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (inputs[kind].locations.some((l) => l.id === id)) return;
  inputs[kind].locations.push({ id, name }); saveInputs(); renderTable(kind);
}
function pasteTsv(kind) {
  const txt = prompt('Paste a tab-separated table.\nFirst row: blank, then location names. Following rows: model name, then values.');
  if (!txt) return;
  const rows = txt.trim().split(/\r?\n/).map((r) => r.split(/\t|,(?=\S)/).map((c) => c.trim()));
  if (rows.length < 2) return alert('Need a header row and at least one model row.');
  const locs = rows[0].slice(1).filter(Boolean);
  const data = inputs[kind]; data.locations = []; data.models = [];
  for (const name of locs) { const known = [...PLACES.regions, ...PLACES.spots].find((x) => x.name.toLowerCase() === name.toLowerCase()); data.locations.push({ id: known ? known.id : 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name }); }
  for (const r of rows.slice(1)) {
    if (!r[0]) continue; const known = PLACES.models.find((m) => m.name.toLowerCase().startsWith(r[0].toLowerCase().split(' ')[0]));
    const m = { model: known ? known.id : 'other', run: known ? '' : r[0], values: {} }; if (kind === 'snow') m.snow_level_m = '';
    r.slice(1).forEach((v, i) => { const num = parseFloat(v); if (!Number.isNaN(num) && data.locations[i]) m.values[data.locations[i].id] = num; });
    data.models.push(m);
  }
  saveInputs(); renderTable(kind);
}
function renderWindows() {
  const { windows } = stepWindows();
  $('#windowsPreview').textContent = `${windows.length} steps · ${windows[0].start_local} → ${windows[windows.length - 1].label.split('–').pop().trim()} · e.g. “${windows[0].label}”, “${windows[1]?.label || ''}”`;
}
function initInputs() {
  $('#startLocal').value = inputs.start_local;
  for (const b of $('#periodSeg').children) { b.classList.toggle('active', Number(b.dataset.h) === inputs.period_hours); b.onclick = () => { inputs.period_hours = Number(b.dataset.h); for (const x of $('#periodSeg').children) x.classList.toggle('active', x === b); saveInputs(); renderWindows(); }; }
  $('#startLocal').onchange = (e) => { if (e.target.value) { inputs.start_local = e.target.value; saveInputs(); renderWindows(); } };
  locOptions($('#rainLocPick')); locOptions($('#snowLocPick'));
  $('#rainAddLoc').onclick = () => addLocation('rain', $('#rainLocPick').value);
  $('#snowAddLoc').onclick = () => addLocation('snow', $('#snowLocPick').value);
  $('#rainAddCustom').onclick = () => { addCustomLocation('rain', $('#rainCustomLoc').value); $('#rainCustomLoc').value = ''; };
  $('#snowAddCustom').onclick = () => { addCustomLocation('snow', $('#snowCustomLoc').value); $('#snowCustomLoc').value = ''; };
  $('#rainAddModel').onclick = () => { inputs.rain.models.push({ model: 'other', run: '', values: {} }); saveInputs(); renderTable('rain'); };
  $('#snowAddModel').onclick = () => { inputs.snow.models.push({ model: 'other', run: '', snow_level_m: '', values: {} }); saveInputs(); renderTable('snow'); };
  $('#rainPaste').onclick = () => pasteTsv('rain'); $('#snowPaste').onclick = () => pasteTsv('snow');
  $('#notes').value = inputs.notes || ''; $('#notes').oninput = (e) => { inputs.notes = e.target.value; saveInputs(); };
  $('#brandName').value = inputs.brand.name || ''; $('#brandTagline').value = inputs.brand.tagline || '';
  $('#brandName').oninput = (e) => { inputs.brand.name = e.target.value; saveInputs(); refreshPanels(); };
  $('#brandTagline').oninput = (e) => { inputs.brand.tagline = e.target.value; saveInputs(); refreshPanels(); };
  renderTable('rain'); renderTable('snow'); renderWindows();
  // uploads
  const dz = $('#dropZone'); dz.onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => addFiles([...e.target.files]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); }; dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); };
}
async function addFiles(files) {
  for (const f of files) {
    const item = { id: Math.random().toString(36).slice(2), name: f.name, file_type: f.type, description: '', frames: [], total_frames: 0, animated: false, sent: false, status: 'decoding…' };
    uploads.push(item); renderUploads();
    try { const r = await sampleImageFile(f); Object.assign(item, r, { status: '' }); }
    catch (e) { item.status = 'failed: ' + e.message; }
    renderUploads();
  }
}
function renderUploads() {
  const list = $('#uploadList'); list.innerHTML = '';
  for (const u of uploads) {
    list.append(el('div', { class: 'upitem' },
      el('div', {}, el('img', { src: u.frames[0]?.preview || '', alt: '' }), el('div', { class: 'frames' }, ...u.frames.slice(1, 6).map((f) => el('img', { src: f.preview })))),
      el('div', {},
        el('textarea', { placeholder: 'What is this? e.g. “ECMWF 00Z Thu MSLP + 6 h precip loop from windy.com, T+0 to T+48”', oninput: (e) => { u.description = e.target.value; u.sent = false; } }, u.description),
        el('div', { class: 'meta' }, el('span', {}, `${u.name} · ${u.animated ? `${u.frames.length} of ${u.total_frames} frames sampled` : 'single frame'} ${u.status || ''} ${u.note ? '· ' + u.note : ''}`), el('span', {}, u.sent ? '✓ sent to AI' : 'not yet sent', ' ', el('button', { class: 'del', onclick: () => { uploads = uploads.filter((x) => x !== u); renderUploads(); } }, 'remove'))))));
  }
}
function inputsPayload() {
  const { windows } = stepWindows();
  const tbl = (kind) => inputs[kind].models.filter((m) => Object.keys(m.values).length || m.run).map((m) => ({ model: modelName(m.model), run: m.run || '', ...(kind === 'snow' ? { snow_level_m: m.snow_level_m === '' ? null : m.snow_level_m } : {}), [kind === 'rain' ? 'totals_mm' : 'totals_cm']: Object.fromEntries(inputs[kind].locations.filter((l) => m.values[l.id] != null).map((l) => [l.name, m.values[l.id]])) }));
  return {
    period_hours: inputs.period_hours,
    start_local: windows[0].start_local,
    timezone: tzAbbr(nzLocalToDate(inputs.start_local)),
    step_windows: windows.map((w) => ({ index: w.index, t_offset_h: w.t_offset_h, label: w.label, start_utc: w.start_utc, end_utc: w.end_utc })),
    rain_accumulations: tbl('rain'),
    snow_accumulations: tbl('snow'),
    forecaster_notes: inputs.notes || '',
    brand_name: inputs.brand.name || '',
    uploads_available: uploads.map((u) => ({ name: u.name, description: u.description, frames: u.frames.length })),
  };
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }

// ───────────────────────── Chat ─────────────────────────
const log = $('#chatLog');
function addMsg(role, text, extra = {}) {
  const m = el('div', { class: `msg ${role}${extra.error ? ' error' : ''}` });
  if (extra.tag) m.append(el('div', { class: 'tag' }, extra.tag));
  m.append(document.createTextNode(text));
  if (extra.thumbs?.length) m.append(el('div', { class: 'thumbs' }, ...extra.thumbs.map((t) => el('img', { src: t, alt: '' }))));
  log.append(m); log.scrollTop = log.scrollHeight; return m;
}
function setBusy(b) { busy = b; $('#btnSend').disabled = b; for (const q of document.querySelectorAll('.quick button')) q.disabled = b; }

async function ensureSession() {
  if (session.id) { const r = await fetch(`/api/session/${session.id}`); if (r.ok) return session.id; }
  const r = await fetch('/api/session', { method: 'POST' }).then((x) => x.json()); session.id = r.id; localStorage.setItem('nzmf.session', r.id); return r.id;
}
async function restoreSession() {
  if (!session.id) return;
  const r = await fetch(`/api/session/${session.id}`); if (!r.ok) { session.id = null; localStorage.removeItem('nzmf.session'); return; }
  const s = await r.json(); session.pendingToolUseId = s.pending_tool_use_id;
  for (const t of s.transcript) {
    if (t.kind === 'text' && t.role === 'user') addMsg('user', t.text || '(data only)', { thumbs: (t.images || []).map((i) => i.thumb).filter(Boolean) });
    else if (t.kind === 'answer') addMsg('user', t.text, { tag: 'answers' });
    else if (t.kind === 'text') addMsg('assistant', t.text);
    else if (t.kind === 'question') renderQuestion(t.question, s.pending_tool_use_id && t === s.transcript[s.transcript.length - 1]);
    else if (t.kind === 'forecast') addMsg('system', `Package: ${t.title} (${t.steps} steps)`);
    else if (t.kind === 'notice') addMsg('system', t.text);
  }
  if (s.forecast) setForecast(s.forecast, []);
}
async function sendChat(text, toolResult = null) {
  if (busy) return;
  setBusy(true);
  try {
    const id = await ensureSession();
    const payload = inputsPayload(); const h = hash(JSON.stringify(payload));
    const newUploads = uploads.filter((u) => !u.sent && u.frames.length);
    const body = { session_id: id, text, inputs: payload, inputs_hash: h, images: newUploads.map((u) => ({ name: u.name, description: u.description, total_frames: u.total_frames, frames: u.frames.map((f) => ({ media_type: f.media_type, data: f.data })) })), tool_result: toolResult };
    if (text || toolResult) addMsg('user', toolResult ? toolResult.summary : text, { tag: toolResult ? 'answers' : null, thumbs: newUploads.map((u) => u.frames[0]?.preview).filter(Boolean) });
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); addMsg('system', e.error || `Request failed (${res.status})`, { error: true }); if (res.status === 404) { session.id = null; localStorage.removeItem('nzmf.session'); } return; }
    for (const u of newUploads) u.sent = true; renderUploads();
    const assistant = addMsg('assistant', ''); let thinkEl = null, progEl = null, gotText = false;
    await readSse(res, (event, data) => {
      switch (event) {
        case 'thinking_start': if (!thinkEl) { thinkEl = el('div', { class: 'thinking' }); assistant.prepend(thinkEl); } break;
        case 'thinking': if (thinkEl) { thinkEl.append(data.text); thinkEl.scrollTop = thinkEl.scrollHeight; } break;
        case 'text': gotText = true; assistant.append(data.text); log.scrollTop = log.scrollHeight; break;
        case 'tool_start': if (!progEl) { progEl = el('div', { class: 'progress' }); assistant.append(progEl); } progEl.textContent = data.name === 'emit_forecast' ? 'Drawing the forecast package…' : 'Preparing questions…'; break;
        case 'tool_progress': if (progEl) progEl.textContent = `Drawing the forecast package… ${data.steps_seen} step${data.steps_seen === 1 ? '' : 's'} written (${Math.round(data.chars / 1024)} KB)`; break;
        case 'question': session.pendingToolUseId = data.tool_use_id; progEl?.remove(); progEl = null; renderQuestion(data.question, true); break;
        case 'forecast': progEl?.remove(); progEl = null; setForecast(data.forecast, data.warnings || []); addMsg('system', `Rendered: ${data.forecast.meta.title} · ${data.forecast.steps.length} steps · ${panels.length - 1} charts`); break;
        case 'notice': addMsg('system', data.text + (data.problems ? '\n• ' + data.problems.slice(0, 6).join('\n• ') : '')); break;
        case 'error': addMsg('system', data.text, { error: true }); break;
        case 'done': if (thinkEl && !thinkEl.textContent.trim()) thinkEl.remove(); if (thinkEl) thinkEl.style.maxHeight = '48px'; break;
        default: break;
      }
    });
    if (!gotText && !assistant.querySelector('.progress') && !assistant.textContent.trim()) assistant.remove();
  } catch (e) {
    addMsg('system', `Network error: ${e.message}`, { error: true });
  } finally { setBusy(false); }
}
async function readSse(res, onEvent) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(chunk)?.[1]; const dataLine = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (ev && dataLine) { try { onEvent(ev, JSON.parse(dataLine)); } catch (e) { console.warn('bad SSE chunk', e); } }
    }
  }
}
function renderQuestion(q, active) {
  const form = el('div', { class: 'qform' }, el('h3', {}, 'The forecaster needs a few decisions'), el('div', { class: 'help' }, q.intro));
  const state = {};
  for (const qu of q.questions) {
    const box = el('div', { class: 'q' }, el('div', { class: 'prompt' }, qu.prompt));
    state[qu.id] = { type: qu.type, values: new Set(qu.options.filter((o) => o.recommended).map((o) => o.value)), other: '' };
    if (qu.type !== 'text') for (const o of qu.options) {
      const inp = el('input', { type: qu.type === 'multi' ? 'checkbox' : 'radio', name: `q_${qu.id}`, value: o.value, checked: state[qu.id].values.has(o.value), disabled: !active });
      inp.onchange = () => { if (qu.type === 'multi') { inp.checked ? state[qu.id].values.add(o.value) : state[qu.id].values.delete(o.value); } else state[qu.id].values = new Set([o.value]); };
      box.append(el('label', { class: 'opt' }, inp, el('span', {}, o.label, o.recommended ? el('span', { class: 'rec' }, 'recommended') : null, o.description ? el('small', {}, o.description) : null)));
    }
    if (qu.type === 'text' || qu.allow_other) box.append(el('input', { type: 'text', placeholder: qu.type === 'text' ? 'Your answer' : 'Other / additional detail', style: 'width:100%', disabled: !active, oninput: (e) => { state[qu.id].other = e.target.value; } }));
    form.append(box);
  }
  if (active) {
    const btn = el('button', { class: 'btn primary' }, 'Send answers');
    btn.onclick = () => {
      const answers = {}; const summary = [];
      for (const qu of q.questions) { const s = state[qu.id]; const vals = [...s.values]; answers[qu.id] = { selected: vals, other: s.other }; summary.push(`${qu.id}: ${[...vals, s.other && `other: ${s.other}`].filter(Boolean).join(', ') || '(none)'}`); }
      for (const i of form.querySelectorAll('input,button')) i.disabled = true;
      sendChat('', { content: JSON.stringify(answers), summary: summary.join('\n') });
    };
    form.append(btn);
  }
  log.append(form); log.scrollTop = log.scrollHeight;
}

// ───────────────────────── Output ─────────────────────────
function setForecast(f, warnings) {
  forecast = f; filters = new Set();
  $('#emptyOut').hidden = true; $('#viewer').hidden = false; $('#filters').hidden = false;
  $('#viewerWarnings').textContent = warnings.length ? `Accepted with ${warnings.length} warning(s): ${warnings.slice(0, 3).join(' · ')}` : '';
  refreshPanels(true);
}
function buildPanels() {
  if (!forecast) return [];
  const out = [{ kind: 'overview', stepIndex: 0, title: 'Overview & model blend' }];
  forecast.steps.forEach((s, i) => { for (const m of s.maps) if (!filters.size || filters.has(m)) out.push({ kind: m, stepIndex: i, title: `${s.label} · ${PLACES.map_types.find((t) => t.id === m)?.name || m}` }); });
  return out;
}
let thumbJob = 0;
function refreshPanels(reset = false) {
  if (!forecast) return;
  renderer._fieldCache.clear();
  panels = buildPanels(); if (reset || selected >= panels.length) selected = 0;
  // filters
  const fl = $('#filters'); fl.innerHTML = '';
  const used = [...new Set(forecast.steps.flatMap((s) => s.maps))];
  fl.append(el('span', { class: 'help' }, 'Show:'), el('button', { class: `btn small ${filters.size ? '' : 'on'}`, onclick: () => { filters = new Set(); refreshPanels(true); } }, 'All'));
  for (const m of used) fl.append(el('button', { class: `btn small ${filters.has(m) ? 'on' : ''}`, onclick: () => { filters.has(m) ? filters.delete(m) : filters.add(m); refreshPanels(true); } }, PLACES.map_types.find((t) => t.id === m)?.name || m));
  // thumbnails (incremental)
  const grid = $('#thumbs'); grid.innerHTML = '';
  const job = ++thumbJob;
  const nodes = panels.map((p, i) => { const c = el('canvas', { width: 320, height: 180 }); const n = el('div', { class: `thumb ${i === selected ? 'active' : ''}`, onclick: () => { showPanel(i); $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, c, el('div', { class: 'cap' }, el('span', {}, p.kind === 'overview' ? 'Overview' : `Step ${p.stepIndex + 1} · ${PLACES.map_types.find((t) => t.id === p.kind)?.name}`), el('span', {}, p.kind === 'overview' ? '' : forecast.steps[p.stepIndex].label))); grid.append(n); return { n, c }; });
  let i = 0;
  const tick = () => { if (job !== thumbJob) return; const t0 = performance.now(); while (i < panels.length && performance.now() - t0 < 24) { const cv = renderer.render({ forecast, stepIndex: panels[i].stepIndex, kind: panels[i].kind, scale: 0.2 }); nodes[i].c.getContext('2d').drawImage(cv, 0, 0, 320, 180); i++; } if (i < panels.length) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  showPanel(selected);
}
function showPanel(i) {
  if (!panels.length) return;
  selected = (i + panels.length) % panels.length; const p = panels[selected];
  for (const [k, n] of [...$('#thumbs').children].entries()) n.classList.toggle('active', k === selected);
  const cv = $('#viewerCanvas'); const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  renderer.render({ forecast, stepIndex: p.stepIndex, kind: p.kind, scale, canvas: cv });
  $('#viewerTitle').textContent = p.title; $('#panelPos').textContent = `${selected + 1} / ${panels.length}`;
}
function initOutput() {
  $('#prevPanel').onclick = () => showPanel(selected - 1); $('#nextPanel').onclick = () => showPanel(selected + 1);
  $('#btnPlay').onclick = () => { if (playing) { clearInterval(playing); playing = null; $('#btnPlay').textContent = '▶ Play'; } else { playing = setInterval(() => showPanel(selected + 1), 1500); $('#btnPlay').textContent = '⏸ Pause'; } };
  $('#btnPng').onclick = () => exportPng(renderer, forecast, panels[selected].stepIndex, panels[selected].kind, 2);
  $('#btnPng1').onclick = () => exportPng(renderer, forecast, panels[selected].stepIndex, panels[selected].kind, 1);
  $('#btnGif').onclick = async () => { const kind = panels[selected].kind === 'overview' ? (forecast.steps[0].maps[0]) : panels[selected].kind; const b = $('#btnGif'); b.disabled = true; try { await exportGif(renderer, forecast, kind, { onProgress: (a, n) => { b.textContent = `GIF ${a}/${n}`; } }); } finally { b.disabled = false; b.textContent = 'GIF loop'; } };
  $('#btnAllPng').onclick = async () => { const b = $('#btnAllPng'); b.disabled = true; try { await exportAllPng(renderer, forecast, panels, 2, (a, n) => { b.textContent = `${a}/${n}`; }); } finally { b.disabled = false; b.textContent = 'All PNGs'; } };
  $('#btnCopy').onclick = async () => { await navigator.clipboard.writeText(articleText(forecast, inputs.brand)); const b = $('#btnCopy'); b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = 'Copy article'), 1500); };
  $('#btnJson').onclick = () => exportJson(forecast);
  document.addEventListener('keydown', (e) => { if (e.target.closest('textarea,input,select')) return; if (e.key === 'ArrowRight') showPanel(selected + 1); if (e.key === 'ArrowLeft') showPanel(selected - 1); });
}

// ───────────────────────── Boot ─────────────────────────
async function boot() {
  initInputs(); initOutput();
  $('#btnSend').onclick = () => { const t = $('#composer').value.trim(); if (!t && !uploads.some((u) => !u.sent)) return; $('#composer').value = ''; sendChat(t); };
  $('#composer').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#btnSend').click(); } });
  for (const b of document.querySelectorAll('.quick button')) b.onclick = () => sendChat(b.dataset.q);
  $('#btnDemo').onclick = async () => { const f = await fetch('data/demo_forecast.json').then((r) => r.json()); setForecast(f, []); addMsg('system', 'Demo package loaded locally (not sent to the AI). Use it to preview the chart design and exports.'); };
  $('#btnNewSession').onclick = async () => { if (!confirm('Start a new chat session? Your inputs and uploads stay; the conversation and current package are cleared.')) return; session = { id: null, pendingToolUseId: null }; localStorage.removeItem('nzmf.session'); log.innerHTML = ''; for (const u of uploads) u.sent = false; renderUploads(); await ensureSession(); addMsg('system', 'New session started.'); };
  try {
    const h = await fetch('/api/health').then((r) => r.json());
    $('#apiDot').classList.toggle('ok', h.has_credentials); $('#apiStatus').textContent = h.has_credentials ? `${h.model} · effort ${h.effort}` : 'No API key – set ANTHROPIC_API_KEY to enable chat';
  } catch { $('#apiStatus').textContent = 'server offline'; }
  await document.fonts.ready;
  await restoreSession();
  if (!log.children.length) addMsg('system', 'Welcome. 1) Set the period and start time. 2) Enter model totals for rain (and snow). 3) Upload model GIFs/charts and describe each one. 4) Press “Analyse & ask me what you need” – the forecaster will study your data with NZ-specific model knowledge, ask which maps you want, then draw the 6-hourly package.');
}
boot();
