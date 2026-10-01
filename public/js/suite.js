import { mountNav, settings, apiFetch, readSse, fmtNz, fmtUtc, relHours, toast, el, openSettings } from './common.js';
import { Simodel, DEM } from './simodel.js';
import { sampleImageFile } from './gif.js';

const $ = (s) => document.querySelector(s);
mountNav('suite.html');
const META = await fetch('/api/suite/meta').then((r) => r.json());
let state = { model: 'ecmwf', layer: '', queue: [], suite: null, busy: false };

// ───── health ─────
async function health() { try { const h = await apiFetch('/api/health').then((r) => r.json()); $('#apiDot').classList.toggle('ok', h.has_credentials); $('#apiStatus').textContent = h.has_credentials ? `${h.model}` : 'No API key – open Settings'; if (!h.has_credentials && !settings.apiKey && !sessionStorage.getItem('simodel.promptedKey')) { sessionStorage.setItem('simodel.promptedKey', '1'); openSettings(); } } catch { $('#apiStatus').textContent = 'server offline'; } }
document.addEventListener('settings-changed', health);

// ───── step 1: models ─────
function renderModels() {
  const g = $('#modelGrid'); g.innerHTML = '';
  const groups = [...new Set(META.models.map((m) => m.group))];
  for (const grp of groups) { g.append(el('div', { class: 'grp' }, grp)); for (const m of META.models.filter((x) => x.group === grp)) g.append(el('button', { class: `mbtn ${state.model === m.id ? 'on' : ''}`, onclick: () => { state.model = m.id; renderModels(); } }, m.name, el('small', {}, `~${m.res_km} km grid`))); }
}
// ───── step 2: layer ─────
function renderLayers() {
  const p = $('#layerPick'); p.innerHTML = '';
  p.append(el('button', { class: `btn small ${state.layer === '' ? 'on' : ''}`, onclick: () => { state.layer = ''; renderLayers(); } }, 'Auto-detect'));
  for (const l of META.layers.filter((l) => l.id !== 'other')) p.append(el('button', { class: `btn small ${state.layer === l.id ? 'on' : ''}`, onclick: () => { state.layer = l.id; renderLayers(); } }, l.label));
}
// ───── step 3: queue ─────
async function addFiles(files) {
  for (const f of files) {
    const item = { id: Math.random().toString(36).slice(2), name: f.name, status: 'preparing…', frame: null };
    state.queue.push(item); renderQueue();
    try { const r = await sampleImageFile(f); const fr = r.frames[0]; item.frame = fr; item.thumb = makeThumb(fr.preview); item.status = r.animated ? `animated (${r.total_frames} frames) – first frame used` : 'ready'; }
    catch (e) { item.status = 'failed: ' + e.message; }
    renderQueue();
  }
}
function makeThumb(dataUrl) { return new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); const s = 220 / im.width; c.width = 220; c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.7)); }; im.src = dataUrl; }); }
let dragIdx = null;
function renderQueue() {
  const q = $('#queue'); q.innerHTML = '';
  state.queue.forEach((it, i) => {
    const row = el('div', { class: 'qitem', draggable: true,
      ondragstart: () => { dragIdx = i; row.classList.add('dragging'); }, ondragend: () => row.classList.remove('dragging'),
      ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); if (dragIdx === null || dragIdx === i) return; const [m] = state.queue.splice(dragIdx, 1); state.queue.splice(i, 0, m); dragIdx = null; renderQueue(); } },
      el('div', { class: 'n' }, i + 1), el('img', { src: it.frame?.preview || '' }), el('div', {}, el('div', { class: 'nm' }, it.name), el('div', { class: `st ${it.status === 'ready' ? 'ok' : it.status.startsWith('failed') ? 'bad' : ''}` }, it.status)),
      el('button', { class: 'btn small ghost', onclick: () => { state.queue.splice(i, 1); renderQueue(); } }, '✕'));
    q.append(row);
  });
  $('#btnAnalyze').disabled = state.busy || !state.queue.some((x) => x.frame);
  $('#analyzeStatus').textContent = state.queue.length ? `${state.queue.length} chart${state.queue.length === 1 ? '' : 's'} queued · upload order is only a hint, the AI sorts by valid time` : '';
}
async function analyze() {
  const ready = state.queue.filter((x) => x.frame); if (!ready.length) return;
  if (!settings.apiKey) { const h = await apiFetch('/api/health').then((r) => r.json()).catch(() => ({})); if (!h.has_credentials) { openSettings(); return; } }
  state.busy = true; renderQueue(); $('#progress').hidden = false; $('#progress i').style.width = '2%';
  const thumbs = await Promise.all(ready.map((x) => x.thumb));
  const body = { model_id: state.model, declared_layer: state.layer, notes: $('#setNotes').value.trim(), images: ready.map((x, i) => ({ name: x.name, media_type: x.frame.media_type, data: x.frame.data, thumb: thumbs[i] })) };
  try {
    const res = await apiFetch('/api/suite/analyze', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); toast(e.error || `Failed (${res.status})`, 'error'); if (res.status === 401) openSettings(); return; }
    let setResult = null;
    await readSse(res, (ev, d) => {
      if (ev === 'progress') { const it = ready[d.index]; if (it) { it.status = `reading… ${Math.round(d.chars / 1024)} KB`; renderQueue(); } }
      if (ev === 'chart') { const it = ready[d.index]; if (it) { it.status = d.result?.error ? `failed: ${d.result.error}` : `✓ ${d.result.layer_label} · valid ${d.result.valid_time_utc || '?'} (+${d.result.lead_hours} h)`; } $('#progress i').style.width = `${Math.round((d.done / d.total) * 100)}%`; renderQueue(); }
      if (ev === 'set') setResult = d.set;
      if (ev === 'error') toast(d.text, 'error');
    });
    if (setResult) {
      toast(`Added ${setResult.charts.length} charts: ${setResult.model_name} · ${setResult.layer_label}`, 'ok');
      if (setResult.sort_warnings?.length) toast(`${setResult.sort_warnings.length} ordering note(s) – check the set below`, 'error');
      state.queue = []; renderQueue(); await loadSuite();
    }
  } catch (e) { toast(`Network error: ${e.message}`, 'error'); }
  finally { state.busy = false; renderQueue(); $('#progress').hidden = true; }
}

// ───── suite catalogue ─────
let engine = null;
async function loadSuite() {
  const [cat, fields] = await Promise.all([fetch('/api/suite').then((r) => r.json()), fetch('/api/suite/fields').then((r) => r.json())]);
  state.suite = cat;
  if (!engine) { const [skill, regions] = await Promise.all([fetch('data/simodel_skill.json').then((r) => r.json()), fetch('data/nz_regions.json').then((r) => r.json())]); engine = new Simodel({ dem: null, meta: { layers: META.layers, models: META.models, lattice: META.lattice }, skill, regions }); }
  engine.setSuite(fields.sets); engine.setPlan(fields.plan);
  renderSets(); renderCoverage(); renderPlan();
}
function renderPlan() {
  const p = state.suite?.plan; const box = $('#planText');
  if (!p) { box.textContent = state.suite?.sets?.length ? 'Run the review to weight models by region and set the physics for this situation.' : 'Once sets are in the suite, run the AI review: it weighs each model by region and field for this situation, picks the flow and physics for downscaling, and tells you honestly what the data can support.'; return; }
  box.innerHTML = '';
  const lvl = p.confidence.overall; box.append(el('div', {}, el('span', { class: `conf ${lvl.startsWith('very') ? 'very' : lvl}` }, `SIMODEL CONFIDENCE ${lvl.toUpperCase()}`), el('b', {}, p.regime.name), el('span', { class: 'help' }, ` · flow ${Math.round(p.flow.direction_deg)}° at ${Math.round(p.flow.speed_ms)} m/s · lapse ${p.physics.lapse_rate_c_per_km} °C/km · reviewed ${fmtNz(p.created_at)}`)));
  box.append(el('p', { style: 'margin:6px 0' }, p.regime.summary), el('p', { style: 'margin:6px 0' }, p.confidence.narrative));
  if (p.confidence.missing_data?.length) box.append(el('div', { class: 'help' }, 'Most valuable additions: ', p.confidence.missing_data.join(' · ')));
  if (p.weights?.length) box.append(el('details', {}, el('summary', {}, `${p.weights.length} regional weight adjustments`), el('ul', { class: 'help' }, ...p.weights.map((w) => el('li', {}, `${META.models.find((m) => m.id === w.model_id)?.name || w.model_id} · ${w.family} · ${w.subregion || 'everywhere'} × ${w.weight_multiplier}${w.bias && w.bias !== 1 ? ` bias ${w.bias}` : ''} — ${w.reason}`)))));
  if (p.model_notes?.length) box.append(el('details', {}, el('summary', {}, 'Model notes'), el('ul', { class: 'help' }, ...p.model_notes.map((n) => el('li', {}, `${META.models.find((m) => m.id === n.model_id)?.name || n.model_id}: ${n.note}`)))));
}
function renderCoverage() {
  const box = $('#coverage'); box.innerHTML = '';
  const cov = engine.coverage(); $('#covHint').textContent = cov.length ? `${cov.length} product${cov.length === 1 ? '' : 's'} · ${state.suite.sets.length} set${state.suite.sets.length === 1 ? '' : 's'} · ${new Set(state.suite.sets.map((s) => s.model_id)).size} model(s)` : '';
  if (!cov.length) { box.append(el('div', { class: 'help' }, 'Nothing uploaded yet.')); return; }
  const now = Date.now(); const tmin = Math.min(now, ...cov.map((c) => c.first)), tmax = Math.max(now + 6 * 3600e3, ...cov.map((c) => c.last));
  const pct = (t) => `${((t - tmin) / (tmax - tmin)) * 100}%`;
  for (const c of cov) {
    const bar = el('div', { class: 'bar' });
    const models = c.models; models.forEach((m, mi) => { const times = c.times.filter((t) => c.timeModels[t].includes(m)).map((t) => Date.parse(t)); for (const t of times) bar.append(el('i', { class: `m${(mi % 5) + 1}`, style: `left:${pct(t - 3 * 3600e3)}; width:${((6 * 3600e3) / (tmax - tmin)) * 100}%; top:${2 + mi * 3}px; height:${Math.max(3, 14 - models.length * 2)}px`, title: `${META.models.find((x) => x.id === m)?.name} · ${fmtNz(new Date(t).toISOString())}` })); });
    bar.append(el('div', { class: 'now', style: `left:${pct(now)}`, title: 'now' }));
    const nM = models.length; const quality = nM >= 3 ? 'blend ready' : nM === 2 ? 'basic blend' : 'single model';
    box.append(el('div', { class: 'covrow' }, el('div', {}, el('b', {}, c.label), el('div', { class: 'help' }, `${nM} model${nM === 1 ? '' : 's'} · ${c.n_times} times · ${quality}${c.derived ? ' · derived' : ''}`)), bar, el('div', { class: 'lead' }, `${fmtNz(c.times[0], { weekday: 'short', hour: 'numeric', hourCycle: 'h23' })} → ${fmtNz(c.times[c.times.length - 1], { weekday: 'short', hour: 'numeric', hourCycle: 'h23' })}`, el('br'), `out to ${relHours(c.times[c.times.length - 1])} from now`)));
  }
}
function renderSets() {
  const box = $('#sets'); box.innerHTML = '';
  if (!state.suite.sets.length) { box.append(el('div', { class: 'help' }, 'No sets yet. Add charts on the left.')); return; }
  for (const set of [...state.suite.sets].reverse()) {
    const warn = set.sort_warnings || [];
    const head = el('div', { class: 'hd' }, el('b', {}, set.model_name), el('span', { class: 'pill' }, set.layer_label), set.run_time_utc ? el('span', { class: 'pill' }, `run ${fmtUtc(set.run_time_utc)}`) : null, el('span', { class: 'pill' }, `${set.charts.length} charts · ${set.time_step_h ? set.time_step_h + '-hourly' : 'step ?'}`), set.mixed_layers ? el('span', { class: 'pill warn' }, 'mixed chart types detected') : null, warn.length ? el('span', { class: 'pill bad' }, `${warn.length} ordering note${warn.length === 1 ? '' : 's'}`) : null,
      el('span', { style: 'margin-left:auto' }, el('select', { onchange: async (e) => { await apiFetch(`/api/suite/set/${set.id}`, { method: 'PUT', body: JSON.stringify({ layer_id: e.target.value, layer_label: META.layers.find((l) => l.id === e.target.value)?.label }) }); loadSuite(); } }, ...META.layers.map((l) => el('option', { value: l.id, selected: l.id === set.layer_id }, l.label))), ' ', el('button', { class: 'btn small ghost', onclick: async () => { if (!confirm('Remove this set?')) return; await apiFetch(`/api/suite/set/${set.id}`, { method: 'DELETE' }); loadSuite(); } }, 'remove')));
    const strip = el('div', { class: 'strip' });
    let dragFrom = null;
    set.charts.forEach((c, i) => {
      const fr = el('div', { class: 'fr', draggable: true, title: `${c.name}\n${c.valid_time_text || ''}\n${c.legend_summary || ''}\n${c.quality?.notes || ''}`,
        ondragstart: () => { dragFrom = i; }, ondragover: (e) => { e.preventDefault(); fr.classList.add('dragover'); }, ondragleave: () => fr.classList.remove('dragover'),
        ondrop: async (e) => { e.preventDefault(); fr.classList.remove('dragover'); if (dragFrom === null || dragFrom === i) return; const order = set.charts.map((x) => x.id); const [m] = order.splice(dragFrom, 1); order.splice(i, 0, m); await apiFetch(`/api/suite/set/${set.id}`, { method: 'PUT', body: JSON.stringify({ charts: order.map((id, k) => ({ id, order: k })) }) }); dragFrom = null; loadSuite(); } },
        el('span', { class: 'idx' }, i + 1), el('img', { src: c.thumb || '' }),
        el('button', { class: 'del', title: 'remove chart', onclick: async () => { await apiFetch(`/api/suite/set/${set.id}/chart/${c.id}`, { method: 'DELETE' }); loadSuite(); } }, '✕'),
        el('div', { class: 't' }, el('b', {}, c.valid_time_utc ? fmtNz(c.valid_time_utc, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : 'time ?'), `${c.valid_time_utc ? fmtUtc(c.valid_time_utc) : ''}${c.lead_hours >= 0 ? ` · +${c.lead_hours}h` : ''}${c.valid_source ? ' *' : ''}`));
      fr.ondblclick = () => editTime(set, c);
      strip.append(fr);
    });
    const notes = el('div', { class: 'help', style: 'margin-top:6px' }, `Drag frames to reorder · double-click a frame to correct its valid time · * = time inferred (${set.charts.filter((c) => c.valid_source).length}) · readability ${Math.round(100 * set.charts.reduce((a, c) => a + (c.quality?.readability ?? 0), 0) / set.charts.length)}%`);
    const warnBox = warn.length ? el('ul', { class: 'help', style: 'margin:6px 0 0 16px; color:#fde68a' }, ...warn.map((w) => el('li', {}, w))) : null;
    box.append(el('div', { class: 'set' }, head, strip, notes, warnBox));
  }
}
async function editTime(set, c) {
  const v = prompt(`Valid time for ${c.name} (UTC, e.g. 2026-10-02T06:00Z). Current: ${c.valid_time_utc || 'unknown'}\nPrinted on chart: ${c.valid_time_text || '—'}`, c.valid_time_utc || '');
  if (v === null) return; if (Number.isNaN(Date.parse(v))) return toast('Not a valid ISO time', 'error');
  const iso = new Date(v).toISOString().slice(0, 16) + 'Z';
  const order = set.charts.map((x) => ({ id: x.id, valid_time_utc: x.id === c.id ? iso : x.valid_time_utc })).sort((a, b) => Date.parse(a.valid_time_utc || 0) - Date.parse(b.valid_time_utc || 0)).map((x, k) => ({ ...x, order: k }));
  await apiFetch(`/api/suite/set/${set.id}`, { method: 'PUT', body: JSON.stringify({ charts: order }) }); loadSuite();
}
async function runPlan() {
  const b = $('#btnPlan'); b.disabled = true; b.textContent = 'Reviewing…';
  try { const r = await apiFetch('/api/suite/plan', { method: 'POST', body: JSON.stringify({ notes: $('#planNotes').value.trim() }) }); const d = await r.json(); if (!r.ok) { toast(d.error || 'Review failed', 'error'); if (r.status === 401) openSettings(); } else { toast('Blend plan ready', 'ok'); await loadSuite(); } }
  catch (e) { toast(e.message, 'error'); } finally { b.disabled = false; b.textContent = 'Run blend review'; }
}

// ───── boot ─────
renderModels(); renderLayers(); renderQueue();
const dz = $('#dropZone'); dz.onclick = () => $('#fileInput').click(); $('#fileInput').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); }; dz.ondragleave = () => dz.classList.remove('drag'); dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); };
document.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (files.length) addFiles(files); });
$('#btnAnalyze').onclick = analyze; $('#btnClearQueue').onclick = () => { state.queue = []; renderQueue(); };
$('#btnClearSuite').onclick = async () => { if (!confirm('Delete every uploaded set and the blend plan?')) return; await apiFetch('/api/suite', { method: 'DELETE' }); loadSuite(); };
$('#btnPlan').onclick = runPlan;
await health(); await loadSuite();
