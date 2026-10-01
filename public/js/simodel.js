/* SIMODEL engine
   - Takes extracted 0.5° lattices from many models/charts (server/suite.js), blends them with regional skill
     weights and bias corrections, and downscales to a fine grid over the South Island with terrain physics:
       precipitation  → linear-theory style upslope enhancement (advected downwind) + elevation term,
                        renormalised so the blended coarse value is conserved at ~0.5° scale
       temperature    → lapse-rate adjustment against the model-scale terrain
       wind/gusts     → ridge speed-up / valley sheltering by elevation anomaly
       snow           → precipitation-type/snow-level masking by terrain height
   - Computes a confidence score (model count, agreement, lead time, readability, time confidence, field
     difficulty) and limits the effective resolution accordingly, so thin data is never shown as crisp detail.
*/

export const DOMAIN = { lon0: 163.0, lon1: 177.6, lat0: -49.8, lat1: -38.2 };   // South Island + 250 km buffer
export const BUFFER_KM = 250;

const FAMILY_OF = { precip_6h: 'precip', precip_24h: 'precip', precip_accum: 'precip', snow_6h: 'snow', snow_24h: 'snow', snow_level: 'level', temp_2m: 'temp', temp_925: 'temp_upper', temp_850: 'temp_upper', mslp: 'mslp', wind_10m: 'wind', gust: 'wind', cloud_total: 'cloud', rh_700: 'cloud', cape: 'convective', thickness_1000_500: 'upper', height_500: 'upper', other: 'other' };
const DIFFICULTY = { precip: 0.8, snow: 0.7, level: 0.85, temp: 0.95, temp_upper: 1.0, mslp: 1.0, wind: 0.85, cloud: 0.8, convective: 0.7, upper: 1.0, other: 0.7 };

// ───────────────────────── DEM ─────────────────────────
export class DEM {
  static async load(base = 'data/') {
    const meta = await fetch(`${base}nz_dem_meta.json`).then((r) => r.json());
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = `${base}nz_dem_z8.png`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const h = new Uint16Array(c.width * c.height);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) h[j] = d[i] * 16 * 4 + (d[i + 1] / 16) * 4; // metres ×4
    return new DEM(h, c.width, c.height, meta);
  }
  constructor(h, w, hgt, meta) { this.h = h; this.w = w; this.hgt = hgt; this.meta = meta; this.n = 2 ** meta.z * 256; }
  // Web-Mercator pixel mapping
  px(lon) { return ((lon + 180) / 360) * this.n - this.meta.px0; }
  py(lat) { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * this.n - this.meta.py0; }
  /** Elevation in metres (bilinear), 0 over sea/outside. */
  at(lat, lon) {
    const x = this.px(lon) - 0.5, y = this.py(lat) - 0.5;
    const i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= this.w - 1 || j >= this.hgt - 1) return 0;
    const tx = x - i, ty = y - j, w = this.w, h = this.h;
    const a = h[j * w + i], b = h[j * w + i + 1], c = h[(j + 1) * w + i], d = h[(j + 1) * w + i + 1];
    return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) / 4;
  }
  /** Mean elevation over a square window of ±half degrees (cheap stride sampling). */
  meanAround(lat, lon, half, steps = 6) {
    let s = 0, n = 0;
    for (let a = -steps; a <= steps; a++) for (let b = -steps; b <= steps; b++) { s += this.at(lat + (a / steps) * half, lon + (b / steps) * half); n++; }
    return s / n;
  }
}

// ───────────────────────── small numeric helpers ─────────────────────────
const toR = Math.PI / 180;
function distKm(lat1, lon1, lat2, lon2) { const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2; return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a))); }
function pointInPoly(lat, lon, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j]; if (((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside; } return inside; }
function cubic(p0, p1, p2, p3, t) { return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t); }
/** Summed-area-table box mean on a grid. */
function boxMean(src, nx, ny, rx, ry) {
  const sat = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 1; j <= ny; j++) { let row = 0; for (let i = 1; i <= nx; i++) { row += src[(j - 1) * nx + (i - 1)]; sat[j * (nx + 1) + i] = sat[(j - 1) * (nx + 1) + i] + row; } }
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) { const j0 = Math.max(0, j - ry), j1 = Math.min(ny, j + ry + 1); for (let i = 0; i < nx; i++) { const i0 = Math.max(0, i - rx), i1 = Math.min(nx, i + rx + 1); const s = sat[j1 * (nx + 1) + i1] - sat[j0 * (nx + 1) + i1] - sat[j1 * (nx + 1) + i0] + sat[j0 * (nx + 1) + i0]; out[j * nx + i] = s / ((j1 - j0) * (i1 - i0)); } }
  return out;
}
function gaussianBlur(src, nx, ny, sigmaCells) {
  if (sigmaCells < 0.4) return src;
  const r = Math.ceil(sigmaCells * 2.5), k = []; let ks = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells)); k.push(v); ks += v; }
  const tmp = new Float32Array(nx * ny), out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0; for (let t = -r; t <= r; t++) { const ii = Math.min(nx - 1, Math.max(0, i + t)); s += src[j * nx + ii] * k[t + r]; } tmp[j * nx + i] = s / ks; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0; for (let t = -r; t <= r; t++) { const jj = Math.min(ny - 1, Math.max(0, j + t)); s += tmp[jj * nx + i] * k[t + r]; } out[j * nx + i] = s / ks; }
  return out;
}

// ───────────────────────── Lattice (coarse) utilities ─────────────────────────
export class Lattice {
  constructor(spec) { Object.assign(this, spec); this.n = spec.n_lat * spec.n_lon; }
  lat(j) { return this.lat_start + j * this.lat_step; }
  lon(i) { return this.lon_start + i * this.lon_step; }
  /** Fill -999 holes by repeated neighbour averaging (keeps zeros). */
  fill(values) {
    const v = Float32Array.from(values); const { n_lat: ny, n_lon: nx } = this;
    for (let pass = 0; pass < 30; pass++) {
      let holes = 0; const next = Float32Array.from(v);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (v[j * nx + i] > -998) continue; holes++;
        let s = 0, c = 0; for (const [dj, di] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj >= ny || ii >= nx) continue; const q = v[jj * nx + ii]; if (q > -998) { s += q; c++; } }
        if (c) next[j * nx + i] = s / c;
      }
      v.set(next); if (!holes) break;
    }
    for (let k = 0; k < v.length; k++) if (v[k] < -998) v[k] = 0;
    return v;
  }
  /** Bicubic sample at (lat, lon) in lattice coordinates. */
  sample(v, lat, lon) {
    const fx = (lon - this.lon_start) / this.lon_step, fy = (lat - this.lat_start) / this.lat_step;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j; const { n_lat: ny, n_lon: nx } = this;
    const g = (jj, ii) => v[Math.min(ny - 1, Math.max(0, jj)) * nx + Math.min(nx - 1, Math.max(0, ii))];
    const rows = []; for (let r = -1; r <= 2; r++) rows.push(cubic(g(j + r, i - 1), g(j + r, i), g(j + r, i + 1), g(j + r, i + 2), tx));
    return cubic(rows[0], rows[1], rows[2], rows[3], ty);
  }
  bilinear(v, lat, lon) {
    const fx = Math.min(this.n_lon - 1.001, Math.max(0, (lon - this.lon_start) / this.lon_step)), fy = Math.min(this.n_lat - 1.001, Math.max(0, (lat - this.lat_start) / this.lat_step));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, nx = this.n_lon;
    return (v[j * nx + i] * (1 - tx) + v[j * nx + i + 1] * tx) * (1 - ty) + (v[(j + 1) * nx + i] * (1 - tx) + v[(j + 1) * nx + i + 1] * tx) * ty;
  }
}

// ───────────────────────── Colour scales (legend keys) ─────────────────────────
export const SCALES = {
  precip: { label: 'Precipitation', units: 'mm', stops: [[0, 'rgba(64,120,200,0)'], [0.5, 'rgba(70,130,210,0.45)'], [1, 'rgba(58,123,213,0.8)'], [2, '#2f9ee6'], [4, '#27c4a6'], [6, '#4bd36a'], [10, '#a5e23c'], [15, '#f2e63a'], [20, '#f6b83a'], [30, '#f0832a'], [40, '#e8532a'], [60, '#d12a4e'], [80, '#b11e8a'], [120, '#7b1fa2'], [200, '#4a148c'], [300, '#2a0a5c']] },
  precip_24: { label: 'Precipitation', units: 'mm', stops: [[0, 'rgba(64,120,200,0)'], [1, 'rgba(70,130,210,0.45)'], [3, 'rgba(58,123,213,0.8)'], [6, '#2f9ee6'], [10, '#27c4a6'], [15, '#4bd36a'], [25, '#a5e23c'], [40, '#f2e63a'], [60, '#f6b83a'], [80, '#f0832a'], [100, '#e8532a'], [150, '#d12a4e'], [200, '#b11e8a'], [300, '#7b1fa2'], [450, '#4a148c'], [700, '#2a0a5c']] },
  snow: { label: 'Snowfall', units: 'cm', stops: [[0, 'rgba(200,225,250,0)'], [0.5, 'rgba(200,225,250,0.5)'], [1, '#cfe3f7'], [2, '#b1d2f2'], [5, '#8cbdec'], [10, '#62a1e2'], [15, '#3e82d4'], [20, '#2a63c0'], [30, '#3b3fae'], [50, '#6b2fa3'], [75, '#9a2a8f'], [100, '#c9237a']] },
  temp: { label: 'Temperature', units: '°C', stops: [[-20, '#4b0082'], [-12, '#6a1fb8'], [-8, '#3b4fd8'], [-4, '#2f7fe6'], [0, '#3fb3e8'], [3, '#6fd6d2'], [6, '#9be3a0'], [9, '#cfe77a'], [12, '#f4e65a'], [15, '#f7c548'], [18, '#f49b38'], [21, '#ef6f2a'], [24, '#e23f22'], [27, '#bb1e1e'], [30, '#8b0f1f'], [36, '#4d0515']] },
  wind: { label: 'Wind speed', units: 'kt', stops: [[0, 'rgba(92,107,192,0.55)'], [5, '#3f8fd2'], [10, '#2fb0a6'], [15, '#4cc24c'], [20, '#b3cf2c'], [25, '#f2d12a'], [30, '#f5a623'], [35, '#f06d1e'], [41, '#e8431d'], [48, '#d61c4e'], [56, '#a8138f'], [64, '#6a1b9a'], [80, '#3e0f6b']] },
  mslp: { label: 'MSLP', units: 'hPa', stops: [[960, '#3b0a6b'], [972, '#5b2a9c'], [984, '#3f5ec9'], [992, '#3f9fd9'], [1000, '#6fd0d8'], [1008, '#bfe3b4'], [1013, '#f3eec2'], [1018, '#f6c877'], [1024, '#ef8f4a'], [1032, '#d8502f'], [1040, '#9b1f2b']] },
  pct: { label: 'Cover', units: '%', stops: [[0, 'rgba(255,255,255,0)'], [20, 'rgba(200,210,225,0.35)'], [40, 'rgba(180,190,210,0.55)'], [60, 'rgba(150,160,185,0.7)'], [80, 'rgba(110,120,150,0.85)'], [100, 'rgba(70,80,110,0.95)']] },
  level: { label: 'Snow level', units: 'm', stops: [[0, '#f8fbff'], [300, '#dbe9fb'], [600, '#b6d3f6'], [900, '#86b6ee'], [1200, '#5a95e0'], [1500, '#3b73cc'], [1800, '#3454ae'], [2100, '#3f3d8f'], [2500, '#5a2f78'], [3000, '#6b1f5e']] },
  cape: { label: 'CAPE', units: 'J/kg', stops: [[50, '#e8f3d6'], [200, '#b7e08a'], [500, '#6cc04a'], [1000, '#f1d93a'], [1500, '#f29c2d'], [2000, '#e4502a'], [3000, '#a81d47']] },
  dam: { label: 'Height', units: 'dam', stops: [[480, '#3b0a6b'], [500, '#3f5ec9'], [520, '#3fb3e8'], [540, '#9be3a0'], [552, '#f4e65a'], [564, '#f49b38'], [576, '#e23f22'], [590, '#8b0f1f']] },
};
export function scaleFor(product) {
  const f = product.family, id = product.id;
  if (f === 'precip') return (product.accum_h >= 24 || id === 'precip_total') ? SCALES.precip_24 : SCALES.precip;
  if (f === 'snow') return SCALES.snow; if (f === 'temp' || f === 'temp_upper') return SCALES.temp; if (f === 'wind') return SCALES.wind;
  if (f === 'mslp') return SCALES.mslp; if (f === 'cloud') return SCALES.pct; if (f === 'level') return SCALES.level; if (f === 'convective') return SCALES.cape; if (f === 'upper') return SCALES.dam; return SCALES.pct;
}
function parseColor(c) { if (c.startsWith('rgba')) { const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], Math.round((m[3] ?? 1) * 255)]; } const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; }
/** Build a 1024-entry RGBA lookup table for a scale (smooth gradient). */
export function buildLut(scale, { smooth = true } = {}) {
  // Position along the bar is piecewise-linear in *stop index* (each legend segment has equal width),
  // so the key's evenly spaced tick labels line up with the colours on the map.
  const stops = scale.stops.map(([v, c]) => [v, parseColor(c)]);
  const n = stops.length, vmin = stops[0][0], vmax = stops[n - 1][0];
  const pos = (v) => { if (v <= vmin) return 0; if (v >= vmax) return 1; for (let s = 0; s < n - 1; s++) if (v <= stops[s + 1][0]) return (s + (v - stops[s][0]) / (stops[s + 1][0] - stops[s][0])) / (n - 1); return 1; };
  const lut = new Uint8ClampedArray(1024 * 4);
  for (let k = 0; k < 1024; k++) {
    const u = (k / 1023) * (n - 1); const sIdx = Math.min(n - 2, Math.floor(u)); const t = smooth ? u - sIdx : 0;
    const a = stops[sIdx][1], b = stops[sIdx + 1][1];
    for (let c = 0; c < 4; c++) lut[k * 4 + c] = a[c] + (b[c] - a[c]) * t;
  }
  return { lut, vmin, vmax, pos, stops: scale.stops, transparentBelow: stops[0][0] > 0 ? stops[0][0] : null };
}

// ───────────────────────── Engine ─────────────────────────
export class Simodel {
  constructor({ dem, meta, skill, regions }) {
    this.dem = dem; this.meta = meta; this.skill = skill; this.regions = regions;
    this.lattice = new Lattice(meta.lattice);
    this.sets = []; this.plan = null; this.cache = new Map(); this.gridCache = new Map();
    this._subregionOfCell = this._buildSubregionIndex();
    this._maskCache = new Map();
  }
  setSuite(sets) { this.sets = sets || []; this.cache.clear(); }
  setPlan(plan) { this.plan = plan || null; this.cache.clear(); }

  _buildSubregionIndex() {
    const L = this.lattice, out = new Array(L.n).fill(null);
    for (let j = 0; j < L.n_lat; j++) for (let i = 0; i < L.n_lon; i++) { const lat = L.lat(j), lon = L.lon(i); for (const sr of this.skill.subregions) if (pointInPoly(lat, lon, sr.poly)) { out[j * L.n_lon + i] = sr.id; break; } }
    return out;
  }
  modelInfo(id) { return this.meta.models.find((m) => m.id === id) || { id, name: id, res_km: 25 }; }
  familyOf(layerId) { return FAMILY_OF[layerId] || 'other'; }

  /** Charts normalised to a flat list with family, accumulation hours, time (ms). */
  _charts() {
    const out = [];
    for (const set of this.sets) for (const c of set.charts) {
      if (!c.valid_time_utc || Number.isNaN(Date.parse(c.valid_time_utc))) continue;
      const layer = c.layer_id === 'other' || !c.layer_id ? set.layer_id : c.layer_id;
      const fam = this.familyOf(layer);
      let accum = Number(c.accumulation_hours) || 0;
      if (fam === 'precip' || fam === 'snow') { if (!accum) accum = layer.endsWith('_24h') ? 24 : layer === 'precip_accum' ? -1 : 6; }
      out.push({ set, chart: c, layer, family: fam, accum_h: accum, t: Date.parse(c.valid_time_utc), model_id: set.model_id, run_t: c.run_time_utc ? Date.parse(c.run_time_utc) : (set.run_time_utc ? Date.parse(set.run_time_utc) : NaN) });
    }
    return out;
  }

  /** Available products given the uploaded data (changes with what the user supplies). */
  products() {
    const charts = this._charts(); const prods = new Map();
    const add = (id, label, family, accum_h, chart, derived = false) => {
      if (!prods.has(id)) prods.set(id, { id, label, family, accum_h, times: new Map(), models: new Set(), derived, units: scaleFor({ family, accum_h, id }).units });
      const p = prods.get(id); const key = new Date(chart.t).toISOString();
      if (!p.times.has(key)) p.times.set(key, new Set()); p.times.get(key).add(chart.model_id); p.models.add(chart.model_id);
    };
    for (const c of charts) {
      if (c.family === 'precip' || c.family === 'snow') {
        const base = c.family === 'precip' ? 'precip' : 'snow';
        if (c.accum_h === -1) add(`${base}_total`, `${c.family === 'precip' ? 'Precipitation' : 'Snow'} total since run`, c.family, -1, c);
        else add(`${base}_${c.accum_h}h`, `${c.accum_h}-hour ${c.family === 'precip' ? 'precipitation' : 'snowfall'}`, c.family, c.accum_h, c);
      } else add(c.layer, this.meta.layers.find((l) => l.id === c.layer)?.label || c.layer, c.family, 0, c);
    }
    // Derived: 24-h totals from consecutive 6-h/12-h windows; running accumulation from a complete series.
    for (const base of ['precip', 'snow']) {
      for (const sub of [6, 12]) {
        const p = prods.get(`${base}_${sub}h`); if (!p || prods.has(`${base}_24h`)) continue;
        const need = 24 / sub;
        for (const model of p.models) {
          const times = [...p.times.entries()].filter(([, ms]) => ms.has(model)).map(([k]) => Date.parse(k)).sort((a, b) => a - b);
          for (const tEnd of times) { let ok = true; for (let k = 1; k < need; k++) if (!times.includes(tEnd - k * sub * 3600e3)) { ok = false; break; } if (ok) add(`${base}_24h`, `24-hour ${base === 'precip' ? 'precipitation' : 'snowfall'}`, base, 24, { t: tEnd, model_id: model }, true); }
        }
      }
      const p6 = prods.get(`${base}_6h`) || prods.get(`${base}_12h`) || prods.get(`${base}_3h`);
      if (p6 && !prods.has(`${base}_total`)) { for (const [k, ms] of p6.times) for (const m of ms) add(`${base}_run_total`, `${base === 'precip' ? 'Precipitation' : 'Snow'} accumulated (from first chart)`, base, -2, { t: Date.parse(k), model_id: m }, true); }
    }
    // Derived snow-on-ground mask when a snow level or temperature exists alongside precip.
    const list = [...prods.values()].map((p) => ({ ...p, times: [...p.times.keys()].sort(), timeModels: Object.fromEntries([...p.times.entries()].map(([k, v]) => [k, [...v]])), models: [...p.models] }));
    const order = ['precip', 'snow', 'temp', 'wind', 'mslp', 'level', 'temp_upper', 'cloud', 'convective', 'upper', 'other'];
    list.sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family) || Number(a.derived) - Number(b.derived) || Math.abs(a.accum_h || 0) - Math.abs(b.accum_h || 0));
    return list;
  }

  /** Coverage summary for the catalogue: per product, first/last valid time and lead from now. */
  coverage(now = Date.now()) {
    return this.products().map((p) => { const first = Date.parse(p.times[0]), last = Date.parse(p.times[p.times.length - 1]); return { ...p, first, last, hours_ahead: Math.round((last - now) / 3600e3), hours_from_now_first: Math.round((first - now) / 3600e3), n_times: p.times.length }; });
  }

  // ───── weights & bias ─────
  _weightBias(modelId, family, subregionId) {
    const sk = this.skill.models[modelId]; const info = this.modelInfo(modelId);
    let w = sk ? (sk.base[family] ?? 0.8) : Math.min(1.3, Math.max(0.6, 0.6 + 6 / (info.res_km || 25)));
    let bias = family === 'temp' || family === 'temp_upper' || family === 'level' ? 0 : 1; let note = '';
    const reg = sk?.regional?.[subregionId]?.[family];
    if (reg) { w *= reg.w ?? 1; if (reg.bias !== undefined) bias = reg.bias; note = reg.note || ''; }
    // AI blend plan overrides (if the forecaster ran the review step)
    const pl = this.plan?.weights?.find((x) => x.model_id === modelId && (x.family === family || x.family === 'all') && (!x.subregion || x.subregion === subregionId));
    if (pl) { w *= pl.weight_multiplier ?? 1; if (pl.bias !== undefined && pl.bias !== null) bias = pl.bias; }
    return { w, bias, note };
  }
  _correct(v, family, bias) {
    if (v <= -998) return v;
    if (family === 'precip' || family === 'snow' || family === 'wind') { const f = Math.min(1.8, Math.max(0.6, 1 / (bias || 1))); return v * f; }
    if (family === 'temp' || family === 'temp_upper' || family === 'level') return v - (bias || 0);
    return v;
  }

  /** Charts usable for a product at time t (ms). Returns [{model_id, values(Float32Array canonical, corrected), weightCells, chart, interpolated, lead_h}] */
  _members(product, t) {
    const charts = this._charts(); const L = this.lattice; const out = [];
    const byModel = new Map();
    const matches = (c) => {
      if (product.family === 'precip' || product.family === 'snow') { const base = product.family; if (product.id === `${base}_total`) return c.family === base && c.accum_h === -1; if (product.id.endsWith('_24h') && product.derived) return false; return c.family === base && c.accum_h === product.accum_h; }
      return c.layer === product.id;
    };
    for (const c of charts) { if (!matches(c)) continue; if (!byModel.has(c.model_id)) byModel.set(c.model_id, []); byModel.get(c.model_id).push(c); }
    for (const [model_id, list] of byModel) {
      list.sort((a, b) => a.t - b.t);
      const exact = list.find((c) => Math.abs(c.t - t) < 1800e3);
      let values = null, chart = exact?.chart, interpolated = false, secondary = null, lead_h = exact ? (Number.isNaN(exact.run_t) ? exact.chart.lead_hours : (exact.t - exact.run_t) / 3600e3) : -1;
      if (exact) { values = L.fill(exact.chart.values); secondary = exact.chart.secondary_values?.length ? L.fill(exact.chart.secondary_values) : null; }
      else if (!(product.family === 'precip' || product.family === 'snow')) {
        const before = [...list].reverse().find((c) => c.t < t), after = list.find((c) => c.t > t);
        if (before && after && after.t - before.t <= 6.5 * 3600e3) {
          const a = L.fill(before.chart.values), b = L.fill(after.chart.values), f = (t - before.t) / (after.t - before.t);
          values = new Float32Array(a.length); for (let k = 0; k < a.length; k++) values[k] = a[k] * (1 - f) + b[k] * f; chart = after.chart; interpolated = true; lead_h = after.chart.lead_hours;
        }
      }
      if (!values) continue;
      const corrected = new Float32Array(values.length), weights = new Float32Array(values.length); const notes = new Set();
      const q = (chart.quality?.readability ?? 0.7) * (chart.time_confidence ?? 0.8) * (interpolated ? 0.85 : 1);
      for (let k = 0; k < values.length; k++) { const { w, bias, note } = this._weightBias(model_id, product.family, this._subregionOfCell[k]); corrected[k] = this._correct(values[k], product.family, bias); weights[k] = w * q; if (note) notes.add(note); }
      out.push({ model_id, values: corrected, raw: values, weights, chart, interpolated, lead_h, secondary, notes: [...notes] });
    }
    return out;
  }

  /** Derived 24-h and running totals are sums of member windows. */
  _derivedMembers(product, t) {
    const base = product.family;
    const sub = this.products().find((p) => p.id === `${base}_6h`) || this.products().find((p) => p.id === `${base}_12h`) || this.products().find((p) => p.id === `${base}_3h`);
    if (!sub) return [];
    const windows = product.id.endsWith('_24h') ? Array.from({ length: 24 / sub.accum_h }, (_, k) => t - k * sub.accum_h * 3600e3) : sub.times.map((x) => Date.parse(x)).filter((x) => x <= t);
    const perModel = new Map();
    for (const tw of windows) for (const m of this._members(sub, tw)) { if (!perModel.has(m.model_id)) perModel.set(m.model_id, { ...m, values: new Float32Array(m.values.length), n: 0 }); const acc = perModel.get(m.model_id); for (let k = 0; k < acc.values.length; k++) acc.values[k] += m.values[k]; acc.n++; }
    return [...perModel.values()].filter((m) => (product.id.endsWith('_24h') ? m.n === windows.length : m.n > 0));
  }

  /** Weighted blend of members on the coarse lattice. */
  _blend(members) {
    const n = this.lattice.n, mean = new Float32Array(n), spread = new Float32Array(n), count = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      let sw = 0, s = 0, c = 0; for (const m of members) { const v = m.values[k]; if (v <= -998) continue; sw += m.weights[k]; s += m.weights[k] * v; c++; }
      if (!sw) { mean[k] = -999; continue; }
      const mu = s / sw; let varw = 0; for (const m of members) { const v = m.values[k]; if (v <= -998) continue; varw += m.weights[k] * (v - mu) ** 2; }
      mean[k] = mu; spread[k] = c > 1 ? Math.sqrt(varw / sw) : 0; count[k] = c;
    }
    return { mean: this.lattice.fill(mean), spread, count };
  }

  /** Flow for orographic downscaling: wind product at t, else geostrophic from MSLP lattice, else plan/default. */
  _flow(t) {
    const prods = this.products(); const L = this.lattice; const n = L.n; const u = new Float32Array(n), v = new Float32Array(n);
    const wp = prods.find((p) => p.id === 'wind_10m');
    if (wp) { const ms = this._members(wp, t).filter((m) => m.secondary); if (ms.length) { const b = this._blend(ms); for (let k = 0; k < n; k++) { const spd = Math.max(0, b.mean[k]) / 1.94384, dir = ms[0].secondary[k]; const r = (270 - dir) * toR; u[k] = spd * Math.cos(r); v[k] = spd * Math.sin(r); } return { u, v, source: 'wind_10m' }; } }
    const mp = prods.find((p) => p.id === 'mslp');
    if (mp) { const ms = this._members(mp, t); if (ms.length) { const b = this._blend(ms); for (let j = 0; j < L.n_lat; j++) for (let i = 0; i < L.n_lon; i++) { const k = j * L.n_lon + i; const lat = L.lat(j); const dpx = ((b.mean[j * L.n_lon + Math.min(L.n_lon - 1, i + 1)] - b.mean[j * L.n_lon + Math.max(0, i - 1)]) * 100) / (2 * L.lon_step * 111320 * Math.cos(lat * toR)); const dpy = -((b.mean[Math.min(L.n_lat - 1, j + 1) * L.n_lon + i] - b.mean[Math.max(0, j - 1) * L.n_lon + i]) * 100) / (2 * Math.abs(L.lat_step) * 111320); const f = Math.abs(2 * 7.2921e-5 * Math.sin(lat * toR)); const ug = dpy / (1.2 * f), vg = -dpx / (1.2 * f); const cs = Math.cos(-20 * toR), sn = Math.sin(-20 * toR); u[k] = (ug * cs - vg * sn) * 0.7; v[k] = (ug * sn + vg * cs) * 0.7; } return { u, v, source: 'mslp (geostrophic)' }; } }
    const dir = this.plan?.flow?.direction_deg ?? 290, spd = this.plan?.flow?.speed_ms ?? 12; const r = (270 - dir) * toR;
    u.fill(spd * Math.cos(r)); v.fill(spd * Math.sin(r)); return { u, v, source: this.plan?.flow ? 'blend plan' : 'climatological NW default' };
  }

  // ───── confidence ─────
  _confidence(product, members, blend) {
    const n = members.length; const reasons = [];
    const cModels = n >= 4 ? 0.95 : n === 3 ? 0.85 : n === 2 ? 0.72 : n === 1 ? 0.42 : 0;
    reasons.push(`${n} model${n === 1 ? '' : 's'} at this time`);
    let agree = 1; if (n > 1) { let s = 0, c = 0; for (let k = 0; k < blend.mean.length; k++) { if (blend.count[k] < 2) continue; const mu = Math.abs(blend.mean[k]); const scale = product.family === 'precip' || product.family === 'snow' ? Math.max(3, mu) : product.family === 'temp' || product.family === 'temp_upper' ? 3 : product.family === 'mslp' ? 4 : product.family === 'wind' ? Math.max(8, mu) : Math.max(1, mu); s += Math.min(1.5, blend.spread[k] / scale); c++; } agree = c ? Math.max(0, 1 - (s / c)) : 1; reasons.push(`model agreement ${Math.round(agree * 100)}%`); }
    const lead = Math.max(0, ...members.map((m) => m.lead_h || 0)); const cLead = lead <= 48 ? 1 : Math.max(0.55, 1 - (lead - 48) / 240); if (lead > 48) reasons.push(`lead time +${Math.round(lead)} h`);
    const read = members.reduce((a, m) => a + (m.chart.quality?.readability ?? 0.7), 0) / Math.max(1, n); const tconf = members.reduce((a, m) => a + (m.chart.time_confidence ?? 0.8), 0) / Math.max(1, n);
    if (read < 0.7) reasons.push('charts hard to read'); if (tconf < 0.7) reasons.push('valid times uncertain'); if (members.some((m) => m.interpolated)) reasons.push('time-interpolated');
    const hiRes = members.some((m) => (this.modelInfo(m.model_id).res_km || 25) <= 5); if (hiRes) reasons.push('includes a convection-permitting NZ model');
    const diff = DIFFICULTY[product.family] ?? 0.8;
    let score = cModels * (0.55 + 0.45 * agree) * cLead * (0.6 + 0.4 * read) * (0.7 + 0.3 * tconf) * diff * (hiRes ? 1.12 : 1);
    score = Math.min(1, score);
    const level = score >= 0.66 ? 'high' : score >= 0.45 ? 'medium' : score >= 0.28 ? 'low' : 'very low';
    // Output grid is always 0.015° (~1.2 km E–W at 44°S); confidence sets how much detail survives (Gaussian smoothing).
    const resolution_deg = 0.015;
    const smooth_cells = level === 'high' ? 0 : level === 'medium' ? 1.6 : level === 'low' ? 3.5 : 7;
    const effective_deg = resolution_deg * Math.max(1, smooth_cells * 2.2);
    return { score, level, resolution_deg, smooth_cells, reasons, lead_h: lead, agreement: agree, n_models: n, km: Math.round(effective_deg * 111 * Math.cos(44 * toR) * 10) / 10 };
  }

  // ───── fine grid machinery ─────
  _grid(res) {
    const key = res.toFixed(4);
    if (this.gridCache.has(key)) return this.gridCache.get(key);
    const nx = Math.round((DOMAIN.lon1 - DOMAIN.lon0) / res), ny = Math.round((DOMAIN.lat1 - DOMAIN.lat0) / res);
    const h = new Float32Array(nx * ny), lat = new Float32Array(ny), lon = new Float32Array(nx);
    for (let j = 0; j < ny; j++) lat[j] = DOMAIN.lat1 - (j + 0.5) * res; for (let i = 0; i < nx; i++) lon[i] = DOMAIN.lon0 + (i + 0.5) * res;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = this.dem.at(lat[j], lon[i]);
    const hSmoothModel = boxMean(h, nx, ny, Math.round(0.25 / res), Math.round(0.25 / res)); // model-scale terrain (~0.5°)
    const hLocal = gaussianBlur(h, nx, ny, Math.max(0.5, 0.03 / res));                       // ~3 km smoothed for slopes
    const dhdx = new Float32Array(nx * ny), dhdy = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) { const dx = res * 111320 * Math.cos(lat[j] * toR), dy = res * 111320; for (let i = 0; i < nx; i++) { const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1); dhdx[j * nx + i] = (hLocal[j * nx + i1] - hLocal[j * nx + i0]) / ((i1 - i0) * dx); dhdy[j * nx + i] = (hLocal[j0 * nx + i] - hLocal[j1 * nx + i]) / ((j1 - j0) * dy); } }
    const mask = this._mask(res, nx, ny, lat, lon);
    const g = { res, nx, ny, lat, lon, h, hSmoothModel, dhdx, dhdy, mask, dist: this._lastDist };
    if (this.gridCache.size > 6) this.gridCache.clear();
    this.gridCache.set(key, g); return g;
  }
  /** 1 = inside South Island + 250 km coastal buffer, 0 = outside (never shown). Computed coarsely and upsampled. */
  _mask(res, nx, ny, lat, lon) {
    const SI = new Set(['nelson', 'tasman', 'marlborough', 'west_coast', 'canterbury', 'otago', 'southland']);
    if (!this._coastPts) { const pts = []; for (const f of this.regions.features) { if (!SI.has(f.properties.id)) continue; const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const poly of polys) for (let k = 0; k < poly[0].length; k += 2) pts.push(poly[0][k]); } this._coastPts = pts; }
    const cres = 0.1, cnx = Math.round((DOMAIN.lon1 - DOMAIN.lon0) / cres), cny = Math.round((DOMAIN.lat1 - DOMAIN.lat0) / cres);
    if (!this._coarseMask) {
      const cm = new Float32Array(cnx * cny);
      for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) { const la = DOMAIN.lat1 - (j + 0.5) * cres, lo = DOMAIN.lon0 + (i + 0.5) * cres; let best = 1e9; for (const [plon, plat] of this._coastPts) { const d = distKm(la, lo, plat, plon); if (d < best) { best = d; if (best < 20) break; } } cm[j * cnx + i] = best; }
      this._coarseMask = cm;
    }
    const out = new Uint8Array(nx * ny), dist = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const fx = Math.min(cnx - 1.001, Math.max(0, (lon[i] - DOMAIN.lon0) / cres - 0.5)), fy = Math.min(cny - 1.001, Math.max(0, (DOMAIN.lat1 - lat[j]) / cres - 0.5)); const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0; const cm = this._coarseMask; const d = (cm[j0 * cnx + i0] * (1 - tx) + cm[j0 * cnx + i0 + 1] * tx) * (1 - ty) + (cm[(j0 + 1) * cnx + i0] * (1 - tx) + cm[(j0 + 1) * cnx + i0 + 1] * tx) * ty; out[j * nx + i] = d <= BUFFER_KM ? 1 : 0; dist[j * nx + i] = d; }
    this._lastDist = dist;
    return out;
  }

  /**
   * Main entry: produce a fine field for a product at time (ISO) for 'simodel' blend or one model.
   * Returns {grid, data, dir?, confidence, members, notes, flowSource, scale}
   */
  field(productId, timeIso, { model = 'simodel' } = {}) {
    const key = `${productId}|${timeIso}|${model}|${this.plan ? 'p' : 'n'}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const product = this.products().find((p) => p.id === productId); if (!product) return null;
    const t = Date.parse(timeIso);
    let members = product.derived ? this._derivedMembers(product, t) : this._members(product, t);
    if (model !== 'simodel') members = members.filter((m) => m.model_id === model);
    if (!members.length) return null;
    const blend = this._blend(members);
    const conf = model === 'simodel' ? this._confidence(product, members, blend) : { ...this._confidence(product, members, blend), level: 'single model', score: 0.4, resolution_deg: 0.015, smooth_cells: 2.5, km: 4, reasons: ['single model – no blending'] };
    const g = this._grid(conf.resolution_deg);
    const L = this.lattice; const fam = product.family; const { nx, ny } = g;
    const F0 = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F0[j * nx + i] = L.sample(blend.mean, g.lat[j], g.lon[i]);
    let data = F0, dir = null, notes = [...new Set(members.flatMap((m) => m.notes))], flowSource = null;
    const gamma = this.plan?.physics?.lapse_rate_c_per_km ?? 6.0;
    if (fam === 'precip' || fam === 'snow') {
      for (let k = 0; k < F0.length; k++) if (F0[k] < 0) F0[k] = 0;
      const flow = this._flow(t); flowSource = flow.source;
      const E = new Float32Array(nx * ny); const tau = this.plan?.physics?.advection_s ?? 700; const aUp = this.plan?.physics?.upslope_gain ?? 1.6; const aElev = this.plan?.physics?.elevation_gain_per_km ?? 0.35;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; if (g.h[k] <= 0 && g.hSmoothModel[k] < 5) { E[k] = 1; continue; }
        const u = L.bilinear(flow.u, g.lat[j], g.lon[i]), v = L.bilinear(flow.v, g.lat[j], g.lon[i]);
        // evaluate upslope slightly upwind (cloud water drifts downwind before falling out)
        const dxDeg = (u * tau) / (111320 * Math.cos(g.lat[j] * toR)), dyDeg = (v * tau) / 111320;
        const iu = Math.min(nx - 1, Math.max(0, Math.round(i - dxDeg / g.res))), ju = Math.min(ny - 1, Math.max(0, Math.round(j + dyDeg / g.res)));
        const w = u * g.dhdx[ju * nx + iu] + v * g.dhdy[ju * nx + iu];                      // vertical velocity proxy m/s
        const up = Math.exp(aUp * Math.max(-0.6, Math.min(0.9, w)));
        const elev = 1 + aElev * ((g.h[k] - g.hSmoothModel[k]) / 1000);
        E[k] = Math.min(3.2, Math.max(0.3, up * Math.min(1.6, Math.max(0.6, elev))));
      }
      const Em = boxMean(E, nx, ny, Math.round(0.25 / g.res), Math.round(0.25 / g.res));
      data = new Float32Array(nx * ny); for (let k = 0; k < data.length; k++) data[k] = Math.max(0, F0[k] * (E[k] / Math.max(0.2, Em[k])));
      if (fam === 'snow' || (fam === 'precip' && product.id !== 'precip_total')) {
        // snow masking by terrain height vs snow level / temperature
        const sl = this._snowLevelField(t, g); if (sl) { for (let k = 0; k < data.length; k++) { if (fam === 'snow' && g.h[k] < sl[k] - 100) data[k] *= Math.max(0, (g.h[k] - (sl[k] - 300)) / 200); } notes.push('Snow masked below the snow level'); }
      }
    } else if (fam === 'temp') {
      data = new Float32Array(nx * ny); for (let k = 0; k < data.length; k++) data[k] = g.h[k] > 0 ? F0[k] - gamma * (g.h[k] - g.hSmoothModel[k]) / 1000 : F0[k];
      notes.push(`Lapse rate ${gamma} °C/km applied to sub-model-scale terrain`);
    } else if (fam === 'wind') {
      data = new Float32Array(nx * ny); for (let k = 0; k < data.length; k++) { const f = g.h[k] > 0 ? Math.min(1.8, Math.max(0.65, 1 + 0.5 * (g.h[k] - g.hSmoothModel[k]) / 1000)) : 1; data[k] = Math.max(0, F0[k] * f); }
      const sec = members.find((m) => m.secondary)?.secondary; if (sec) { dir = new Float32Array(nx * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) dir[j * nx + i] = L.bilinear(sec, g.lat[j], g.lon[i]); }
      notes.push('Ridge speed-up / valley sheltering by elevation anomaly');
    } else if (fam === 'level') {
      data = F0;
    } else { data = F0; }
    if (conf.smooth_cells > 0.4) data = gaussianBlur(data, nx, ny, conf.smooth_cells);
    const out = { product, grid: g, data, dir, confidence: conf, members: members.map((m) => ({ model_id: m.model_id, model: this.modelInfo(m.model_id).name, interpolated: m.interpolated, lead_h: m.lead_h, readability: m.chart.quality?.readability, chart_name: m.chart.name })), notes, flowSource, scale: scaleFor(product), coarse: blend, time: timeIso };
    if (this.cache.size > 24) this.cache.clear();
    this.cache.set(key, out); return out;
  }
  _snowLevelField(t, g) {
    const prods = this.products(); const sp = prods.find((p) => p.id === 'snow_level'); const L = this.lattice;
    if (sp) { const ms = this._members(sp, t); if (ms.length) { const b = this._blend(ms); const out = new Float32Array(g.nx * g.ny); for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) out[j * g.nx + i] = L.sample(b.mean, g.lat[j], g.lon[i]); return out; } }
    const tp = prods.find((p) => p.id === 'temp_2m'); if (!tp) return null; const ms = this._members(tp, t); if (!ms.length) return null;
    const b = this._blend(ms); const gamma = 6.0; const out = new Float32Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const k = j * g.nx + i; const tModel = L.sample(b.mean, g.lat[j], g.lon[i]); const hModel = g.hSmoothModel[k]; out[k] = Math.max(0, hModel + ((tModel - 1.0) / gamma) * 1000); }
    return out;
  }
  /** Value at a point for the picker. */
  sampleField(fieldObj, lat, lon) {
    const g = fieldObj.grid; const fx = (lon - DOMAIN.lon0) / g.res - 0.5, fy = (DOMAIN.lat1 - lat) / g.res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy); if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return null;
    if (!g.mask[j * g.nx + i]) return null;
    const tx = fx - i, ty = fy - j, d = fieldObj.data, nx = g.nx;
    const v = (d[j * nx + i] * (1 - tx) + d[j * nx + i + 1] * tx) * (1 - ty) + (d[(j + 1) * nx + i] * (1 - tx) + d[(j + 1) * nx + i + 1] * tx) * ty;
    return { value: v, elevation: g.h[j * nx + i], dir: fieldObj.dir ? fieldObj.dir[j * nx + i] : null };
  }
}
