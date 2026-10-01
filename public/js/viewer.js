import { mountNav, settings, fmtNz, fmtUtc, relHours, windowLabelNz, toast, el } from './common.js';
import { Simodel, DEM, DOMAIN, buildLut, scaleFor } from './simodel.js';

const $ = (s) => document.querySelector(s);
mountNav('viewer.html');
$('#brandSub').textContent = settings.brand.name || 'model blend · South Island';

// ───── data ─────
const [META, skill, regions, places] = await Promise.all(['/api/suite/meta', 'data/simodel_skill.json', 'data/nz_regions.json', 'data/nz_places.json'].map((u) => fetch(u).then((r) => r.json())));
$('#suiteStatus').textContent = 'loading terrain…';
const dem = await DEM.load('data/');
const engine = new Simodel({ dem, meta: { layers: META.layers, models: META.models, lattice: META.lattice }, skill, regions });
let products = [], state = { product: null, time: null, model: 'simodel', field: null, iso: true, labels: false, particles: true, relief: true, basemap: settings.basemap === 'online' };

// ───── map ─────
const SI_BOUNDS = L.latLngBounds([DOMAIN.lat0, DOMAIN.lon0], [DOMAIN.lat1, DOMAIN.lon1]);
const map = L.map('map', { zoomControl: true, minZoom: 5, maxZoom: 11, maxBounds: SI_BOUNDS.pad(0.05), maxBoundsViscosity: 0.8, zoomSnap: 0.25, wheelPxPerZoomLevel: 90, attributionControl: true });
map.attributionControl.setPrefix('SIMODEL · terrain: Mapzen/Terrarium · boundaries: Natural Earth');
map.fitBounds([[-47.4, 165.8], [-40.4, 174.6]]);
const online = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 19, opacity: 0.9 });

/** Canvas layer that re-renders on view change: hillshade basemap or data field. */
const CanvasLayer = L.Layer.extend({
  initialize(renderFn, opts) { this._render = renderFn; L.setOptions(this, opts); },
  onAdd(m) { this._map = m; this._c = L.DomUtil.create('canvas', 'leaflet-layer'); this._c.style.position = 'absolute'; this._c.style.pointerEvents = 'none'; this._c.style.opacity = this.options.opacity ?? 1; const pane = m.getPane(this.options.pane || 'overlayPane'); pane.appendChild(this._c); m.on('moveend zoomend resize', this._reset, this); m.on('zoomanim', this._anim, this); this._reset(); },
  onRemove(m) { L.DomUtil.remove(this._c); m.off('moveend zoomend resize', this._reset, this); m.off('zoomanim', this._anim, this); },
  _anim(e) { const scale = this._map.getZoomScale(e.zoom), off = this._map._latLngBoundsToNewLayerBounds(this._map.getBounds(), e.zoom, e.center).min; L.DomUtil.setTransform(this._c, off, scale); },
  _reset() { const size = this._map.getSize(), tl = this._map.containerPointToLayerPoint([0, 0]); L.DomUtil.setPosition(this._c, tl); const dpr = Math.min(2, window.devicePixelRatio || 1); this._c.width = size.x * dpr; this._c.height = size.y * dpr; this._c.style.width = size.x + 'px'; this._c.style.height = size.y + 'px'; this._render(this._c, this._map, dpr); },
  redraw() { if (this._map) this._reset(); },
});

// Hillshade + sea basemap from the DEM (works offline). Light direction NW, Windy-ish dark style.
function renderBase(c, m, dpr) {
  const ctx = c.getContext('2d'); const w = c.width, h = c.height; const img = ctx.createImageData(w, h); const d = img.data;
  const nw = m.containerPointToLatLng([0, 0]), se = m.containerPointToLatLng([w / dpr, h / dpr]);
  const lat0 = nw.lat, lon0 = nw.lng, lat1 = se.lat, lon1 = se.lng;
  const mY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)); const y0 = mY(lat0), y1 = mY(lat1);
  const metresPerPx = (40075016 * Math.cos((lat0 + lat1) / 2 * Math.PI / 180)) / (256 * Math.pow(2, m.getZoom())) / dpr;
  const step = Math.max(1, Math.round(metresPerPx / 350)); // sample spacing in px for slopes
  const online = state.basemap;
  for (let y = 0; y < h; y++) {
    const lat = (2 * Math.atan(Math.exp(y0 + ((y + 0.5) / h) * (y1 - y0))) - Math.PI / 2) * 180 / Math.PI;
    for (let x = 0; x < w; x++) {
      const lon = lon0 + ((x + 0.5) / w) * (lon1 - lon0); const i = (y * w + x) * 4;
      const e = dem.at(lat, lon);
      if (e <= 0) { if (online) { d[i + 3] = 0; continue; } d[i] = 15; d[i + 1] = 27; d[i + 2] = 48; d[i + 3] = 255; continue; }
      const ex = dem.at(lat, lon + (step / w) * (lon1 - lon0)), ey = dem.at(lat - (step / h) * (lat0 - lat1), lon);
      const dzdx = (ex - e) / (step * metresPerPx), dzdy = (ey - e) / (step * metresPerPx);
      const slope = Math.atan(2.2 * Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
      const alt = 42 * Math.PI / 180, az = 315 * Math.PI / 180;
      let shade = Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect) + Math.sin(alt) * Math.cos(slope); shade = Math.max(0, Math.min(1, shade));
      const t = Math.min(1, e / 2600); // elevation tint
      const base = [40 + 30 * t, 48 + 28 * t, 62 + 26 * t];
      const k = 0.55 + 0.75 * shade;
      d[i] = base[0] * k; d[i + 1] = base[1] * k; d[i + 2] = base[2] * k; d[i + 3] = online ? 150 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
let fieldLut = null;
function renderField(c, m, dpr) {
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
  const f = state.field; if (!f) return;
  const w = c.width, h = c.height; const img = ctx.createImageData(w, h); const d = img.data;
  const nw = m.containerPointToLatLng([0, 0]), se = m.containerPointToLatLng([w / dpr, h / dpr]);
  const mY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)); const y0 = mY(nw.lat), y1 = mY(se.lat);
  const g = f.grid, data = f.data, dist = g.dist, lut = fieldLut.lut, pos = fieldLut.pos, tb = fieldLut.transparentBelow;
  const alpha = f.product.family === 'cloud' ? 1 : 0.9;
  const metresPerPx = (40075016 * Math.cos((nw.lat + se.lat) / 2 * Math.PI / 180)) / (256 * Math.pow(2, m.getZoom())) / dpr; const step = Math.max(1, Math.round(metresPerPx / 350));
  const dLon = (se.lng - nw.lng) / w, relief = state.relief;
  for (let y = 0; y < h; y++) {
    const lat = (2 * Math.atan(Math.exp(y0 + ((y + 0.5) / h) * (y1 - y0))) - Math.PI / 2) * 180 / Math.PI;
    const latS = (2 * Math.atan(Math.exp(y0 + ((y + step + 0.5) / h) * (y1 - y0))) - Math.PI / 2) * 180 / Math.PI;
    const fy = (DOMAIN.lat1 - lat) / g.res - 0.5; const j = Math.floor(fy); const ty = fy - j;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const lon = nw.lng + ((x + 0.5) / w) * (se.lng - nw.lng); const fx = (lon - DOMAIN.lon0) / g.res - 0.5; const i = Math.floor(fx);
      // outside the engine domain or beyond the 250-km buffer → dark veil with a soft 25-km edge
      let dKm = 1e4; if (i >= 0 && i < g.nx - 1 && j >= 0 && j < g.ny - 1) { const k = j * g.nx + i; const tx = fx - i; dKm = (dist[k] * (1 - tx) + dist[k + 1] * tx) * (1 - ty) + (dist[k + g.nx] * (1 - tx) + dist[k + g.nx + 1] * tx) * ty; }
      if (dKm > 250) { const veil = Math.min(1, (dKm - 250) / 25); d[o] = 8; d[o + 1] = 12; d[o + 2] = 22; d[o + 3] = 215 * veil; continue; }
      const k = j * g.nx + i; const tx = fx - i;
      const v = (data[k] * (1 - tx) + data[k + 1] * tx) * (1 - ty) + (data[k + g.nx] * (1 - tx) + data[k + g.nx + 1] * tx) * ty;
      if (tb !== null && v < tb) continue;
      const q = Math.round(pos(v) * 1023) * 4;
      let r = lut[q], gg = lut[q + 1], bb = lut[q + 2];
      if (relief) { const e = dem.at(lat, lon); if (e > 0) { const ex = dem.at(lat, lon + step * dLon), ey = dem.at(latS, lon); const dzdx = (ex - e) / (step * metresPerPx), dzdy = (ey - e) / (step * metresPerPx); const slope = Math.atan(2.0 * Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx); const sh = Math.max(0, Math.min(1, Math.cos(0.733) * Math.sin(slope) * Math.cos(5.5 - aspect) + Math.sin(0.733) * Math.cos(slope))); const kk = 0.72 + 0.5 * sh; r *= kk; gg *= kk; bb *= kk; } }
      d[o] = r; d[o + 1] = gg; d[o + 2] = bb; d[o + 3] = lut[q + 3] * alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (state.iso) drawIsolines(ctx, m, dpr, f);
}
function drawIsolines(ctx, m, dpr, f) {
  const fam = f.product.family; let interval = null;
  if (fam === 'mslp') interval = 2; else if (fam === 'temp' || fam === 'temp_upper') interval = 2; else if (fam === 'upper') interval = 4; else if (fam === 'level') interval = 200; else return;
  const g = f.grid; const stride = Math.max(1, Math.round(g.nx / 240)); const nx = Math.floor(g.nx / stride), ny = Math.floor(g.ny / stride);
  const toPt = (i, j) => { const lat = DOMAIN.lat1 - (j * stride + 0.5) * g.res, lon = DOMAIN.lon0 + (i * stride + 0.5) * g.res; const p = m.latLngToContainerPoint([lat, lon]); return [p.x * dpr, p.y * dpr]; };
  const val = (i, j) => f.data[(j * stride) * g.nx + i * stride];
  let vmin = Infinity, vmax = -Infinity; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = val(i, j); if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
  ctx.save(); ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = fam === 'mslp' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)'; ctx.font = `${10 * dpr}px Inter, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const table = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] };
  for (let lv = Math.ceil(vmin / interval) * interval; lv <= vmax; lv += interval) {
    ctx.beginPath(); let labelled = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const p = [val(i, j), val(i + 1, j), val(i + 1, j + 1), val(i, j + 1)]; let code = 0; if (p[0] >= lv) code |= 1; if (p[1] >= lv) code |= 2; if (p[2] >= lv) code |= 4; if (p[3] >= lv) code |= 8; if (!code || code === 15) continue;
      const P = [toPt(i, j), toPt(i + 1, j), toPt(i + 1, j + 1), toPt(i, j + 1)]; const lerp = (a, b, va, vb) => { const t = (lv - va) / (vb - va); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
      const e = [lerp(P[0], P[1], p[0], p[1]), lerp(P[1], P[2], p[1], p[2]), lerp(P[3], P[2], p[3], p[2]), lerp(P[0], P[3], p[0], p[3])];
      for (const [a, b] of table[code]) { ctx.moveTo(e[a][0], e[a][1]); ctx.lineTo(e[b][0], e[b][1]); if (labelled < 2 && (i + j) % 37 === 0 && !state.noText) { labelled++; } }
    }
    ctx.stroke();
  }
  ctx.restore();
}
const baseLayer = new CanvasLayer(renderBase, { pane: 'tilePane', opacity: 1 }).addTo(map);
const fieldLayer = new CanvasLayer(renderField, { pane: 'overlayPane' }).addTo(map);
map.createPane('coast'); map.getPane('coast').style.zIndex = 450; map.getPane('coast').style.pointerEvents = 'none';
L.geoJSON(regions, { pane: 'coast', style: { color: 'rgba(255,255,255,0.55)', weight: 1, fill: false, opacity: 1 } }).addTo(map);
map.createPane('labels'); map.getPane('labels').style.zIndex = 650; map.getPane('labels').style.pointerEvents = 'none';
const labelLayer = L.layerGroup(places.cities.filter((c) => c.lat < -40.3).map((c) => L.marker([c.lat, c.lon], { pane: 'labels', interactive: false, icon: L.divIcon({ className: 'city-label', html: c.name, iconAnchor: [0, 6] }) })));

// ───── wind particles (Windy-style) ─────
const ParticleLayer = L.Layer.extend({
  onAdd(m) { this._map = m; this._c = L.DomUtil.create('canvas', 'leaflet-layer'); this._c.style.position = 'absolute'; this._c.style.pointerEvents = 'none'; m.getPane('overlayPane').appendChild(this._c); m.on('moveend zoomend resize', this._reset, this); m.on('movestart', this._stop, this); this._reset(); },
  onRemove(m) { this._stop(); L.DomUtil.remove(this._c); m.off('moveend zoomend resize', this._reset, this); m.off('movestart', this._stop, this); },
  _stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; },
  _reset() {
    this._stop(); const size = this._map.getSize(), tl = this._map.containerPointToLayerPoint([0, 0]); L.DomUtil.setPosition(this._c, tl); this._c.width = size.x; this._c.height = size.y;
    const f = state.field; if (!f || !f.dir || !state.particles) { this._c.getContext('2d').clearRect(0, 0, size.x, size.y); return; }
    const ctx = this._c.getContext('2d'); const n = Math.round((size.x * size.y) / 900); const ps = []; const w = size.x, h = size.y;
    const vec = (x, y) => { const ll = this._map.containerPointToLatLng([x, y]); const s = engine.sampleField(f, ll.lat, ll.lng); if (!s || s.dir == null) return null; const spd = s.value; const r = (270 - s.dir) * Math.PI / 180; return [Math.cos(r) * spd, -Math.sin(r) * spd]; };
    for (let i = 0; i < n; i++) ps.push({ x: Math.random() * w, y: Math.random() * h, age: Math.random() * 80 });
    ctx.fillStyle = 'rgba(0,0,0,0)'; let frame = 0;
    const tick = () => {
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0,0,0,0.92)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.1; ctx.beginPath();
      for (const p of ps) { const v = vec(p.x, p.y); if (!v || p.age++ > 90) { p.x = Math.random() * w; p.y = Math.random() * h; p.age = 0; continue; } const k = 0.045 * Math.pow(2, 7 - this._map.getZoom()) ; const nx = p.x + v[0] * k, ny = p.y + v[1] * k; ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); p.x = nx; p.y = ny; if (nx < 0 || ny < 0 || nx > w || ny > h) p.age = 100; }
      ctx.stroke(); if (++frame < 100000) this._raf = requestAnimationFrame(tick);
    };
    tick();
  },
  redraw() { if (this._map) this._reset(); },
});
const particleLayer = new ParticleLayer().addTo(map);

// ───── UI: products / models / timeline / legend / confidence ─────
const swatch = (p) => { const s = scaleFor(p); return `linear-gradient(90deg, ${s.stops.slice(1).map(([, c]) => c).join(',')})`; };
function renderLayersCtl() {
  const box = $('#layersCtl'); box.innerHTML = '';
  if (!products.length) { box.append(el('div', { class: 'help' }, 'No products – upload charts in the Model Suite.')); return; }
  const fams = [['precip', 'Precipitation'], ['snow', 'Snow'], ['temp', 'Temperature'], ['wind', 'Wind'], ['mslp', 'Pressure'], ['level', 'Snow level'], ['temp_upper', 'Upper-air temperature'], ['cloud', 'Cloud & humidity'], ['convective', 'Convection'], ['upper', 'Upper air'], ['other', 'Other']];
  for (const [fid, name] of fams) { const list = products.filter((p) => p.family === fid); if (!list.length) continue; box.append(el('h4', {}, name)); for (const p of list) box.append(el('div', { class: `lay ${state.product?.id === p.id ? 'on' : ''}`, onclick: () => selectProduct(p.id) }, el('span', { class: 'sw', style: `background:${swatch(p)}` }), p.label, el('small', {}, `${p.models.length}m · ${p.times.length}t`))); }
}
function renderModelsCtl() {
  const box = $('#modelsCtl'); box.innerHTML = ''; if (!state.product) return;
  box.append(el('h4', { style: 'font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:0 0 6px' }, 'Source'));
  const avail = state.time ? state.product.timeModels[state.time] || [] : state.product.models;
  const row = (id, label, sub) => el('div', { class: `mrow ${state.model === id ? 'on' : ''}`, onclick: () => { state.model = id; refresh(); } }, el('span', { class: `dot ${id === 'simodel' || avail.includes(id) ? '' : 'off'}` }), el('span', {}, el('b', {}, label), sub ? el('div', { class: 'help' }, sub) : null));
  box.append(row('simodel', 'SIMODEL blend', `${avail.length} model${avail.length === 1 ? '' : 's'} at this time · terrain-downscaled`));
  for (const mid of state.product.models) box.append(row(mid, META.models.find((m) => m.id === mid)?.name || mid, avail.includes(mid) ? 'single model, terrain-redistributed' : 'not available at this time'));
}
function renderTimeline() {
  const box = $('#timelineCtl'); const p = state.product; if (!p) { box.hidden = true; return; } box.hidden = false; box.innerHTML = '';
  const times = p.times; const t0 = Date.parse(times[0]), t1 = Date.parse(times[times.length - 1]); const span = Math.max(1, t1 - t0);
  const tl = el('div', { class: 'tl' }, el('div', { class: 'track' }));
  // show 6-hourly ticks across the span; ticks with data are bright
  const stepMs = (p.accum_h > 0 ? p.accum_h : 6) * 3600e3; const have = new Set(times.map((t) => Date.parse(t)));
  for (let t = t0; t <= t1 + 1; t += stepMs) { const iso = new Date(t).toISOString().slice(0, 16) + 'Z'; const has = have.has(t); const canInterp = !has && !['precip', 'snow'].includes(p.family); if (!has && !canInterp) continue; const pct = ((t - t0) / span) * 100; tl.append(el('div', { class: `tick ${has ? 'has' : 'interp'} ${state.time === iso ? 'on' : ''}`, style: `left:${pct}%`, title: `${fmtNz(iso)} · ${fmtUtc(iso)}`, onclick: () => { state.time = iso; refresh(); } })); if (times.length <= 12 || Math.round((t - t0) / stepMs) % Math.ceil(times.length / 8) === 0) tl.append(el('div', { class: 'lab', style: `left:${pct}%` }, fmtNz(iso, { weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).replace(/ NZ[DS]T/, ''))); }
  const cur = el('div', { class: 'cur' }, el('b', {}, p.accum_h > 0 ? windowLabelNz(state.time, p.accum_h) : fmtNz(state.time)), el('small', {}, `${fmtUtc(state.time)} · ${relHours(state.time)} from now`));
  const prev = el('button', { class: 'btn small', onclick: () => stepTime(-1) }, '‹'), next = el('button', { class: 'btn small', onclick: () => stepTime(1) }, '›');
  const play = el('button', { class: 'btn small', onclick: () => { if (state.playing) { clearInterval(state.playing); state.playing = null; play.textContent = '▶'; } else { state.playing = setInterval(() => stepTime(1, true), 1300); play.textContent = '⏸'; } } }, state.playing ? '⏸' : '▶');
  box.append(play, prev, next, tl, cur);
}
function stepTime(d, loop = false) { const p = state.product; const i = p.times.indexOf(state.time); let n = i + d; if (n >= p.times.length) n = loop ? 0 : p.times.length - 1; if (n < 0) n = 0; state.time = p.times[n]; refresh(); }
function renderLegend() {
  const box = $('#legendCtl'); const f = state.field; if (!f) { box.hidden = true; return; } box.hidden = false; box.innerHTML = '';
  const s = f.scale; const title = `${f.product.label}`;
  box.append(el('div', { class: 'ttl' }, el('span', {}, title), el('span', { style: 'color:var(--dim)' }, s.units)));
  const c = el('canvas', { width: 600, height: 14 }); const ctx = c.getContext('2d'); const lut = fieldLut.lut; for (let x = 0; x < 600; x++) { const q = Math.round((x / 599) * 1023) * 4; ctx.fillStyle = `rgba(${lut[q]},${lut[q + 1]},${lut[q + 2]},${lut[q + 3] / 255})`; ctx.fillRect(x, 0, 1, 14); }
  box.append(c);
  const ticks = el('div', { class: 'ticks', style: 'position:relative;height:14px' }); s.stops.forEach(([v], i, a) => { if (a.length > 10 && i % 2 === 1 && i !== a.length - 1) return; ticks.append(el('span', { style: `position:absolute;left:${(i / (a.length - 1)) * 100}%;transform:translateX(${i === 0 ? '0' : i === a.length - 1 ? '-100%' : '-50%'})` }, String(v))); }); box.append(ticks);
  box.append(el('div', { class: 'help', style: 'margin-top:4px' }, `${state.model === 'simodel' ? 'SIMODEL blend' : META.models.find((m) => m.id === state.model)?.name} · ${f.confidence.km} km effective detail · ${f.product.accum_h > 0 ? `${f.product.accum_h}-h window ending ` : ''}${fmtNz(state.time)}`));
}
function renderConfidence() {
  const box = $('#confCtl'); const f = state.field; if (!f) { box.hidden = true; return; } box.hidden = false; box.innerHTML = '';
  const c = f.confidence; const cls = c.level === 'high' ? 'high' : c.level === 'medium' ? 'medium' : c.level === 'low' ? 'low' : 'very';
  box.append(el('div', { style: 'display:flex;align-items:center;gap:8px' }, el('span', { class: `conf ${cls}` }, c.level.toUpperCase()), el('span', { class: 'lvl' }, `SIMODEL confidence ${Math.round(c.score * 100)}%`)));
  box.append(el('div', { class: 'help', style: 'margin-top:4px' }, c.reasons.join(' · ')));
  box.append(el('div', { class: 'help', style: 'margin-top:4px' }, `Detail limited to ~${c.km} km${c.level === 'high' ? ' (full resolution)' : ' because the data is thin – add more models/times to sharpen it'}.`));
  if (f.flowSource) box.append(el('div', { class: 'help', style: 'margin-top:4px' }, `Orographic flow from: ${f.flowSource}`));
  const plan = engine.plan; if (plan) box.append(el('div', { class: 'help', style: 'margin-top:4px' }, `Blend plan: ${plan.regime.name}`));
  if (f.members.length) box.append(el('details', { style: 'margin-top:6px' }, el('summary', {}, `${f.members.length} member${f.members.length === 1 ? '' : 's'} · bias notes`), el('ul', { class: 'help', style: 'margin:4px 0 0 14px' }, ...f.members.map((m) => el('li', {}, `${m.model}${m.interpolated ? ' (time-interpolated)' : ''} · +${Math.round(m.lead_h || 0)} h · read ${Math.round((m.readability ?? 0.7) * 100)}%`)), ...f.notes.slice(0, 6).map((n) => el('li', { style: 'color:#fde68a' }, n)))));
}
function selectProduct(id) { const p = products.find((x) => x.id === id); if (!p) return; state.product = p; if (!p.times.includes(state.time)) state.time = p.times.find((t) => Date.parse(t) >= Date.now()) || p.times[0]; refresh(); }
function refresh() {
  renderLayersCtl(); renderModelsCtl(); renderTimeline();
  if (!state.product) { state.field = null; fieldLayer.redraw(); renderLegend(); renderConfidence(); return; }
  const t0 = performance.now();
  try { state.field = engine.field(state.product.id, state.time, { model: state.model }); } catch (e) { console.error(e); toast(`Could not compute field: ${e.message}`, 'error'); state.field = null; }
  if (state.field) fieldLut = buildLut(state.field.scale);
  fieldLayer.redraw(); particleLayer.redraw(); renderLegend(); renderConfidence();
  $('#suiteStatus').textContent = state.field ? `${state.product.label} · computed in ${Math.round(performance.now() - t0)} ms · grid ${state.field.grid.nx}×${state.field.grid.ny}` : 'no data at this time';
  renderModelsCtl();
}

// ───── picker ─────
map.on('mousemove', (e) => { const f = state.field; const box = $('#pickerCtl'); if (!f) { box.hidden = true; return; } const s = engine.sampleField(f, e.latlng.lat, e.latlng.lng); if (!s) { box.hidden = true; return; } box.hidden = false; const pt = map.latLngToContainerPoint(e.latlng); box.style.left = `${pt.x + 16}px`; box.style.top = `${pt.y + 16}px`; box.style.right = 'auto'; box.style.bottom = 'auto'; const u = f.scale.units; box.innerHTML = `<b>${s.value.toFixed(u === 'mm' || u === 'cm' ? 1 : u === '°C' ? 1 : 0)} ${u}</b>${s.dir != null ? ` · from ${Math.round(s.dir)}°` : ''}<br><span class="help">${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)} · ${Math.round(s.elevation)} m asl</span>`; });
map.on('mouseout', () => { $('#pickerCtl').hidden = true; });

// ───── tools ─────
function setBasemap(on) { state.basemap = on; settings.basemap = on ? 'online' : 'simodel'; if (on) { online.addTo(map); online.bringToBack(); } else map.removeLayer(online); baseLayer.redraw(); $('#btnBasemap').classList.toggle('primary', on); }
$('#btnBasemap').onclick = () => setBasemap(!state.basemap);
$('#btnLabels').onclick = () => { state.labels = !state.labels; state.labels ? labelLayer.addTo(map) : map.removeLayer(labelLayer); $('#btnLabels').classList.toggle('primary', state.labels); };
$('#btnIso').onclick = () => { state.iso = !state.iso; fieldLayer.redraw(); $('#btnIso').classList.toggle('primary', state.iso); };
$('#btnWind').onclick = () => { state.particles = !state.particles; particleLayer.redraw(); $('#btnWind').classList.toggle('primary', state.particles); };
$('#btnIso').classList.add('primary'); $('#btnWind').classList.add('primary'); $('#btnRelief').classList.add('primary'); if (state.basemap) setBasemap(true);
$('#btnRelief').onclick = () => { state.relief = !state.relief; fieldLayer.redraw(); $('#btnRelief').classList.toggle('primary', state.relief); };
$('#btnExport').onclick = async () => {
  if (!state.field) return;
  const size = map.getSize(); const dpr = 2; const out = document.createElement('canvas'); out.width = size.x * dpr; out.height = size.y * dpr; const ctx = out.getContext('2d');
  ctx.fillStyle = '#0b1222'; ctx.fillRect(0, 0, out.width, out.height);
  const tmpB = document.createElement('canvas'); tmpB.width = out.width; tmpB.height = out.height; renderBase(tmpB, map, dpr); ctx.drawImage(tmpB, 0, 0);
  const tmpF = document.createElement('canvas'); tmpF.width = out.width; tmpF.height = out.height; renderField(tmpF, map, dpr); ctx.drawImage(tmpF, 0, 0);
  // coastlines
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2 * dpr; for (const f of regions.features) { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const poly of polys) { ctx.beginPath(); poly[0].forEach(([lon, lat], i) => { const p = map.latLngToContainerPoint([lat, lon]); i ? ctx.lineTo(p.x * dpr, p.y * dpr) : ctx.moveTo(p.x * dpr, p.y * dpr); }); ctx.closePath(); ctx.stroke(); } } ctx.restore();
  // key panel (always present on exports)
  const f = state.field, s = f.scale; const pw = 560 * dpr / 2, ph = 150 * dpr / 2, px = out.width - pw - 24 * dpr / 2 * 2, py = out.height - ph - 24 * dpr;
  ctx.fillStyle = 'rgba(13,20,38,0.9)'; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 14 * dpr / 2 * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = `800 ${13 * dpr}px Inter, sans-serif`; ctx.fillText(`${f.product.label} (${s.units})`, px + 16 * dpr, py + 24 * dpr);
  ctx.font = `600 ${10 * dpr}px Inter, sans-serif`; ctx.fillStyle = '#9fb0c9'; ctx.fillText(`${f.product.accum_h > 0 ? windowLabelNz(state.time, f.product.accum_h) : fmtNz(state.time)} · ${fmtUtc(state.time)} · ${state.model === 'simodel' ? 'SIMODEL blend' : META.models.find((m) => m.id === state.model)?.name} · confidence ${f.confidence.level} · ~${f.confidence.km} km detail`, px + 16 * dpr, py + 40 * dpr);
  const lut = fieldLut.lut; const bx = px + 16 * dpr, by = py + 52 * dpr, bw = pw - 32 * dpr, bh = 14 * dpr; for (let x = 0; x < bw; x++) { const q = Math.round((x / (bw - 1)) * 1023) * 4; ctx.fillStyle = `rgba(${lut[q]},${lut[q + 1]},${lut[q + 2]},${lut[q + 3] / 255})`; ctx.fillRect(bx + x, by, 1, bh); }
  ctx.fillStyle = '#e5e7eb'; ctx.font = `600 ${9 * dpr}px Inter, sans-serif`; ctx.textAlign = 'center'; s.stops.forEach(([v], i, a) => { if (a.length > 10 && i % 2 === 1 && i !== a.length - 1) return; const x = bx + (i / (a.length - 1)) * bw; ctx.fillText(String(v), Math.min(bx + bw - 8 * dpr, Math.max(bx + 8 * dpr, x)), by + bh + 12 * dpr); });
  ctx.textAlign = 'left'; ctx.fillStyle = '#38bdf8'; ctx.font = `800 ${11 * dpr}px Inter, sans-serif`; ctx.fillText(`SIMODEL${settings.brand.name ? ' · ' + settings.brand.name : ''}`, px + 16 * dpr, py + ph - 10 * dpr);
  ctx.fillStyle = '#9fb0c9'; ctx.font = `500 ${8.5 * dpr}px Inter, sans-serif`; ctx.textAlign = 'right'; ctx.fillText('Model-blend guidance · not an official warning · MetService for warnings', px + pw - 16 * dpr, py + ph - 10 * dpr);
  out.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `simodel-${f.product.id}-${state.time.replace(/[:]/g, '')}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
};
document.addEventListener('keydown', (e) => { if (e.target.closest('input,textarea')) return; if (e.key === 'ArrowRight') stepTime(1); if (e.key === 'ArrowLeft') stepTime(-1); });

// ───── boot ─────
async function loadSuite() {
  const data = await fetch('/api/suite/fields').then((r) => r.json());
  engine.setSuite(data.sets); engine.setPlan(data.plan); products = engine.products();
  $('#emptyCtl').hidden = products.length > 0;
  if (products.length) { const pref = products.find((p) => p.family === 'precip') || products[0]; selectProduct(state.product?.id && products.some((p) => p.id === state.product.id) ? state.product.id : pref.id); }
  else { $('#suiteStatus').textContent = 'no products'; renderLayersCtl(); }
}
await loadSuite();
