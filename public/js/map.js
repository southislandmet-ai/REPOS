/* NZ chart renderer: Canvas 2D, logical 1600×900 panel, any output scale.
   Everything here is pure drawing – it takes a forecast package (see server/tools.js) and places data. */

export const PANEL_W = 1600;
export const PANEL_H = 900;

const EXTENTS = {
  wide: { lon0: 160.0, lon1: 183.5, lat0: -50.5, lat1: -31.5 },
  nz:   { lon0: 162.6, lon1: 182.4, lat0: -47.9, lat1: -33.9 },
};

const THEME = {
  bg: '#0b1222',
  panel: '#111a2e',
  panelEdge: '#1f2b45',
  text: '#f3f6fb',
  textDim: '#9fb0c9',
  accent: '#38bdf8',
  ocean0: '#d7e7f4',
  ocean1: '#bcd4e8',
  land: '#f5f2ea',
  landEdge: '#8a93a3',
  regionEdge: '#b7b1a2',
  graticule: 'rgba(60,80,110,0.14)',
  isobar: '#2b3a55',
  isobarLabel: '#1f2a40',
  low: '#dc2626',
  high: '#1d4ed8',
};

export const WEATHER_LABEL = {
  clear: 'Fine', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy', drizzle: 'Drizzle', showers: 'Showers',
  rain: 'Rain', heavy_rain: 'Heavy rain', thunder: 'Thunderstorms', sleet: 'Sleet', snow: 'Snow',
  heavy_snow: 'Heavy snow', fog: 'Fog', windy: 'Windy', frost: 'Frost',
};

// Rainfall colour scale (mm) – perceptually ordered, print-friendly.
const RAIN_SCALE = [
  [0, 'rgba(0,0,0,0)'], [0.5, '#e6f0d8'], [2, '#c6e3a6'], [5, '#8fd07a'], [10, '#4fb968'], [15, '#2b9fb8'],
  [25, '#1f6fd1'], [40, '#4338ca'], [60, '#7e22ce'], [90, '#be185d'], [130, '#e11d48'], [200, '#7f1d1d'],
];
const SNOW_SCALE = [
  [0, 'rgba(0,0,0,0)'], [1, '#e8f1fb'], [3, '#c7dcf3'], [6, '#9fc3ea'], [10, '#6fa5df'], [20, '#3f7fd0'],
  [30, '#2a56b8'], [50, '#4c2fa6'], [80, '#7a1f8f'],
];
const TEMP_SCALE = [
  [-10, '#312e81'], [-4, '#4338ca'], [0, '#2563eb'], [4, '#38bdf8'], [8, '#67e8f9'], [12, '#a7f3d0'],
  [16, '#fde68a'], [20, '#fbbf24'], [24, '#f97316'], [28, '#dc2626'], [34, '#7f1d1d'],
];
const WIND_COLORS = [[0, '#6b7280'], [15, '#2563eb'], [25, '#0891b2'], [34, '#16a34a'], [41, '#ca8a04'], [48, '#ea580c'], [56, '#dc2626'], [64, '#7f1d1d']];

function scaleColor(scale, v, interpolate = true) {
  if (v <= scale[0][0]) return scale[0][1];
  for (let i = 1; i < scale.length; i++) {
    if (v < scale[i][0]) {
      if (!interpolate) return scale[i - 1][1];
      const t = (v - scale[i - 1][0]) / (scale[i][0] - scale[i - 1][0]);
      return mixColor(scale[i - 1][1], scale[i][1], t);
    }
  }
  return scale[scale.length - 1][1];
}
function parseColor(c) {
  if (c.startsWith('rgba')) { const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; }
  const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
}
function mixColor(a, b, t) {
  const A = parseColor(a), B = parseColor(b);
  const r = A.map((x, i) => x + (B[i] - x) * t);
  return `rgba(${r[0] | 0},${r[1] | 0},${r[2] | 0},${r[3].toFixed(3)})`;
}
function windColor(kt) { return scaleColor(WIND_COLORS, kt, false); }

// ---------- Projection ----------
function mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)); }
export function makeProjection(extentName, rect) {
  const e = EXTENTS[extentName] || EXTENTS.nz;
  const D = Math.PI / 180;
  const x0 = e.lon0 * D, x1 = e.lon1 * D;
  const y0 = mercY(e.lat1), y1 = mercY(e.lat0); // y0 top (north)
  const sx = rect.w / (x1 - x0), sy = rect.h / (y0 - y1);
  const s = Math.min(sx, sy);
  const ox = rect.x + (rect.w - (x1 - x0) * s) / 2;
  const oy = rect.y + (rect.h - (y0 - y1) * s) / 2;
  const proj = (lat, lon) => {
    if (lon < 0) lon += 360;
    return [ox + (lon * D - x0) * s, oy + (y0 - mercY(lat)) * s];
  };
  const inv = (x, y) => {
    const lon = ((x - ox) / s + x0) / D;
    const my = y0 - (y - oy) / s;
    const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI;
    return [lat, lon];
  };
  return { proj, inv, extent: e, scale: s, rect };
}

// ---------- Pressure field ----------
const R_EARTH = 6371;
function distKm(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function buildPressureField(mslp, extent, step = 0.25) {
  const lon0 = extent.lon0 - 6, lon1 = extent.lon1 + 6, lat0 = extent.lat0 - 6, lat1 = extent.lat1 + 6;
  const nx = Math.round((lon1 - lon0) / step) + 1, ny = Math.round((lat1 - lat0) / step) + 1;
  const data = new Float32Array(nx * ny);
  const bg = mslp.background_hpa ?? 1013, g = mslp.gradient_hpa_per_deg_lat ?? 0;
  const systems = (mslp.systems || []).map((s) => ({ ...s, base: bg + g * (s.lat + 40), lon: s.lon < 0 ? s.lon + 360 : s.lon }));
  for (let j = 0; j < ny; j++) {
    const lat = lat0 + j * step;
    for (let i = 0; i < nx; i++) {
      const lon = lon0 + i * step;
      let p = bg + g * (lat + 40);
      for (const s of systems) {
        const d = distKm(lat, lon, s.lat, s.lon);
        const r = Math.max(150, s.radius_km || 700);
        p += (s.pressure_hpa - s.base) * Math.exp(-Math.LN2 * (d / r) ** 2);
      }
      data[j * nx + i] = p;
    }
  }
  return { data, nx, ny, lon0, lat0, step, bg, g };
}
function sampleField(f, lat, lon) {
  if (lon < 0) lon += 360;
  const fx = (lon - f.lon0) / f.step, fy = (lat - f.lat0) / f.step;
  const i = Math.max(0, Math.min(f.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(f.ny - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - i)), ty = Math.min(1, Math.max(0, fy - j));
  const p00 = f.data[j * f.nx + i], p10 = f.data[j * f.nx + i + 1], p01 = f.data[(j + 1) * f.nx + i], p11 = f.data[(j + 1) * f.nx + i + 1];
  return (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
}
/** Geostrophic wind (SH) at a point, reduced and backed for the surface. Returns {u, v, kt, dir}. */
function fieldWind(f, lat, lon, overLand) {
  const dl = 0.25;
  const dpdx = (sampleField(f, lat, lon + dl) - sampleField(f, lat, lon - dl)) * 100 / (2 * dl * 111320 * Math.cos(lat * Math.PI / 180));
  const dpdy = (sampleField(f, lat + dl, lon) - sampleField(f, lat - dl, lon)) * 100 / (2 * dl * 111320);
  const fcor = Math.abs(2 * 7.2921e-5 * Math.sin(lat * Math.PI / 180));
  const rho = 1.2;
  // Southern hemisphere geostrophic: u = (1/ρ|f|) ∂p/∂y, v = −(1/ρ|f|) ∂p/∂x
  let u = dpdy / (rho * fcor), v = -dpdx / (rho * fcor);
  const reduce = overLand ? 0.5 : 0.68;
  const back = (overLand ? 28 : 15) * Math.PI / 180; // turn toward low pressure (to the right in SH ⇒ clockwise)
  const cs = Math.cos(-back), sn = Math.sin(-back);
  const u2 = (u * cs - v * sn) * reduce, v2 = (u * sn + v * cs) * reduce;
  return vecToWind(u2, v2);
}
function vecToWind(u, v) {
  const ms = Math.hypot(u, v);
  const kt = ms * 1.94384;
  const dir = (270 - Math.atan2(v, u) * 180 / Math.PI + 360) % 360; // direction wind blows FROM
  return { u, v, kt, dir };
}
function windToVec(dir, kt) {
  const ms = kt / 1.94384, r = (270 - dir) * Math.PI / 180;
  return { u: ms * Math.cos(r), v: ms * Math.sin(r) };
}

// ---------- Marching squares ----------
function contours(f, level, extentMargin) {
  const segs = [];
  const { nx, ny, data } = f;
  const idx = (i, j) => j * nx + i;
  const interp = (pa, pb, a, b) => a + (level - pa) / (pb - pa) * (b - a);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const p = [data[idx(i, j)], data[idx(i + 1, j)], data[idx(i + 1, j + 1)], data[idx(i, j + 1)]];
      let code = 0;
      if (p[0] >= level) code |= 1; if (p[1] >= level) code |= 2; if (p[2] >= level) code |= 4; if (p[3] >= level) code |= 8;
      if (code === 0 || code === 15) continue;
      const lon = f.lon0 + i * f.step, lat = f.lat0 + j * f.step, s = f.step;
      // Edge points: 0 bottom(j), 1 right, 2 top(j+1), 3 left   (grid coordinates lon,lat)
      const e = [
        [interp(p[0], p[1], lon, lon + s), lat],
        [lon + s, interp(p[1], p[2], lat, lat + s)],
        [interp(p[3], p[2], lon, lon + s), lat + s],
        [lon, interp(p[0], p[3], lat, lat + s)],
      ];
      const table = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] };
      for (const [a, b] of table[code]) segs.push([e[a], e[b]]);
    }
  }
  return joinSegments(segs);
}
function joinSegments(segs) {
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const byStart = new Map();
  const used = new Array(segs.length).fill(false);
  segs.forEach((s, i) => { for (const k of [key(s[0]), key(s[1])]) { if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(i); } });
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let line = [segs[i][0], segs[i][1]];
    for (const dirEnd of [1, 0]) {
      for (;;) {
        const end = dirEnd ? line[line.length - 1] : line[0];
        const cands = byStart.get(key(end)) || [];
        let next = -1;
        for (const c of cands) if (!used[c]) { next = c; break; }
        if (next < 0) break;
        used[next] = true;
        const s = segs[next];
        const other = key(s[0]) === key(end) ? s[1] : s[0];
        if (dirEnd) line.push(other); else line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}

// ---------- Geometry helpers ----------
function catmullRom(points, segments = 12) {
  if (points.length < 3) return points.slice();
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let t = 0; t < segments; t++) {
      const s = t / segments, s2 = s * s, s3 = s2 * s;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
function pointInPoly(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/);
  const lines = []; let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function fmtLon(lon) { const l = ((lon % 360) + 360) % 360; return l > 180 ? `${(360 - l).toFixed(1)}°W` : `${l.toFixed(1)}°E`; }
function ellipsize(ctx, text, maxW) { let t = String(text || ''); if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
function fmtMm(v) { return v >= 10 ? Math.round(v).toString() : (Math.round(v * 2) / 2).toString(); }
function compass(deg) { const d = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']; return d[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]; }
function ktToKmh(kt) { return Math.round(kt * 1.852); }

// ---------- Weather glyphs ----------
function drawGlyph(ctx, kind, x, y, s = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const sun = (ox, oy, r) => {
    ctx.fillStyle = '#f59e0b'; ctx.strokeStyle = '#f59e0b';
    ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(ox + Math.cos(a) * (r + 2), oy + Math.sin(a) * (r + 2)); ctx.lineTo(ox + Math.cos(a) * (r + 5), oy + Math.sin(a) * (r + 5)); ctx.stroke(); }
  };
  const cloud = (ox, oy, fill = '#ffffff', stroke = '#64748b') => {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke;
    ctx.beginPath(); ctx.arc(ox - 5, oy + 2, 5, Math.PI * 0.5, Math.PI * 1.5); ctx.arc(ox - 1, oy - 3, 6, Math.PI, Math.PI * 1.9); ctx.arc(ox + 6, oy, 5, Math.PI * 1.3, Math.PI * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
  };
  const drops = (n, color = '#2563eb', oy = 9) => { ctx.strokeStyle = color; ctx.lineWidth = 2; for (let i = 0; i < n; i++) { const dx = -6 + i * (12 / Math.max(1, n - 1)); ctx.beginPath(); ctx.moveTo(dx, oy); ctx.lineTo(dx - 2, oy + 5); ctx.stroke(); } };
  const flakes = (n, oy = 10) => { ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.4; for (let i = 0; i < n; i++) { const dx = -6 + i * (12 / Math.max(1, n - 1)); for (let a = 0; a < 3; a++) { const r = a * Math.PI / 3; ctx.beginPath(); ctx.moveTo(dx - Math.cos(r) * 3, oy - Math.sin(r) * 3); ctx.lineTo(dx + Math.cos(r) * 3, oy + Math.sin(r) * 3); ctx.stroke(); } } };
  switch (kind) {
    case 'clear': sun(0, 0, 6); break;
    case 'partly_cloudy': sun(-4, -4, 5); cloud(2, 3); break;
    case 'cloudy': cloud(0, 0, '#e5e7eb', '#64748b'); break;
    case 'drizzle': cloud(0, -3, '#e5e7eb'); drops(3, '#60a5fa', 8); break;
    case 'showers': sun(-5, -6, 4); cloud(2, 0); drops(2, '#2563eb', 9); break;
    case 'rain': cloud(0, -3, '#cbd5e1', '#475569'); drops(3, '#2563eb', 8); break;
    case 'heavy_rain': cloud(0, -3, '#94a3b8', '#334155'); drops(4, '#1d4ed8', 8); break;
    case 'thunder': cloud(0, -3, '#94a3b8', '#334155'); ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.moveTo(1, 4); ctx.lineTo(-3, 10); ctx.lineTo(0, 10); ctx.lineTo(-2, 16); ctx.lineTo(4, 8); ctx.lineTo(1, 8); ctx.lineTo(3, 4); ctx.closePath(); ctx.fill(); break;
    case 'sleet': cloud(0, -3, '#cbd5e1', '#475569'); drops(2, '#2563eb', 8); flakes(1, 12); break;
    case 'snow': cloud(0, -3, '#e5e7eb', '#475569'); flakes(3, 11); break;
    case 'heavy_snow': cloud(0, -3, '#cbd5e1', '#334155'); flakes(4, 11); break;
    case 'fog': ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-8, i * 5); ctx.lineTo(8, i * 5); ctx.stroke(); } break;
    case 'windy': ctx.strokeStyle = '#475569'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(5, -4); ctx.arc(5, -1.5, 2.5, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-9, 3); ctx.lineTo(8, 3); ctx.arc(8, 6, 3, -Math.PI / 2, Math.PI / 2); ctx.stroke(); break;
    case 'frost': ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.6; for (let a = 0; a < 3; a++) { const r = a * Math.PI / 3; ctx.beginPath(); ctx.moveTo(-Math.cos(r) * 7, -Math.sin(r) * 7); ctx.lineTo(Math.cos(r) * 7, Math.sin(r) * 7); ctx.stroke(); } break;
    default: cloud(0, 0);
  }
  ctx.restore();
}

// ---------- Wind barb ----------
function drawBarb(ctx, x, y, dirFrom, kt, color, len = 30) {
  if (kt < 2) { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke(); return; }
  ctx.save(); ctx.translate(x, y);
  ctx.rotate((dirFrom + 180) * Math.PI / 180); // staff points toward where the wind is coming from (up = north)
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, len); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  let v = Math.round(kt / 5) * 5, pos = len;
  const side = 1; // Southern Hemisphere: barbs on the left of the staff when looking upwind  ⇒ +x after our rotation
  const fullLen = 12, step = 6;
  while (v >= 50) { ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(side * fullLen, pos - 3); ctx.lineTo(0, pos - 7); ctx.closePath(); ctx.fill(); pos -= 8; v -= 50; }
  while (v >= 10) { ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(side * fullLen, pos + 4); ctx.stroke(); pos -= step; v -= 10; }
  if (v >= 5) { if (pos === len) pos -= step; ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(side * fullLen * 0.5, pos + 2); ctx.stroke(); }
  ctx.restore();
}

// ---------- Main renderer ----------
export class ChartRenderer {
  constructor({ regions, places, brand }) {
    this.regions = regions;          // GeoJSON FeatureCollection
    this.places = places;            // nz_places.json
    this.brand = brand || {};
    this._fieldCache = new Map();
  }

  /** Render one panel. kind ∈ map type ids or 'overview'. Returns the canvas. */
  render({ forecast, stepIndex, kind, scale = 1, canvas = null, extent = null }) {
    const cv = canvas || document.createElement('canvas');
    cv.width = PANEL_W * scale; cv.height = PANEL_H * scale;
    const ctx = cv.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.textBaseline = 'alphabetic';
    this._drawBackground(ctx);
    if (kind === 'overview') { this._drawOverview(ctx, forecast); return cv; }
    const step = forecast.steps[stepIndex];
    const mapRect = { x: 28, y: 28, w: 1010, h: 844 };
    const ext = extent || (kind === 'mslp' ? 'wide' : 'nz');
    const P = makeProjection(ext, mapRect);
    const field = this._field(forecast, stepIndex, P.extent);
    this._drawMapFrame(ctx, mapRect, P);
    ctx.save(); roundRect(ctx, mapRect.x, mapRect.y, mapRect.w, mapRect.h, 18); ctx.clip();
    this._drawBase(ctx, P, mapRect);
    switch (kind) {
      case 'mslp': this._layerRegions(ctx, P, null); this._layerIsobars(ctx, P, field, true); this._layerFronts(ctx, P, step); this._layerSystems(ctx, P, step, field); this._layerCities(ctx, P, step, 'weather'); break;
      case 'rain6h': this._layerRegions(ctx, P, (r) => scaleColor(RAIN_SCALE, r.rain_mm), step); this._layerIsobars(ctx, P, field, false, 0.35); this._layerFronts(ctx, P, step, 0.75); { const hb = this._layerHotspots(ctx, P, step, 'rain'); this._layerRegionLabels(ctx, P, step, (r) => r.rain_mm > 0.4 ? `${fmtMm(r.rain_mm)}` : '0', 'mm', null, hb); } break;
      case 'accum': { const acc = this._accumulated(forecast, stepIndex); this._layerRegions(ctx, P, (r) => scaleColor(RAIN_SCALE, acc[r.region_id] * (24 / Math.max(24, forecast.meta.period_hours / 2))), step); this._layerIsobars(ctx, P, field, false, 0.25); this._layerRegionLabels(ctx, P, step, (r) => fmtMm(acc[r.region_id]), 'mm'); break; }
      case 'wind': this._layerRegions(ctx, P, null); this._layerIsobars(ctx, P, field, false, 0.45); this._layerBarbs(ctx, P, field, step); this._layerFronts(ctx, P, step, 0.8); this._layerSystems(ctx, P, step, field, true); this._layerRegionLabels(ctx, P, step, (r) => `${compass(r.wind_dir_deg)} ${Math.round(r.wind_mean_kt)}`, 'kt', (r) => `gusts ${ktToKmh(r.wind_gust_kt)} km/h`); break;
      case 'snow': this._layerRegions(ctx, P, (r) => scaleColor(SNOW_SCALE, r.snow_cm), step); this._layerIsobars(ctx, P, field, false, 0.3); this._layerFronts(ctx, P, step, 0.7); { const hb = this._layerHotspots(ctx, P, step, 'snow'); this._layerRegionLabels(ctx, P, step, (r) => r.snow_cm > 0.4 ? `${fmtMm(r.snow_cm)}` : '0', 'cm', (r) => `snow level ${Math.round(r.snow_level_m / 50) * 50} m`, hb, (r) => r.snow_cm < 0.4 && r.snow_level_m >= 2000); } break;
      case 'temp': this._layerRegions(ctx, P, (r) => mixColor('rgba(255,255,255,0)', scaleColor(TEMP_SCALE, r.temp_c), 0.75), step); this._layerIsobars(ctx, P, field, false, 0.25); this._layerFronts(ctx, P, step, 0.7); this._layerCities(ctx, P, step, 'temp'); break;
      default: this._layerRegions(ctx, P, null);
    }
    this._layerCoastLabels(ctx, P);
    ctx.restore();
    this._drawMapChrome(ctx, mapRect, forecast, step, kind, P);
    this._drawSidebar(ctx, forecast, stepIndex, kind);
    return cv;
  }

  // ----- caches -----
  _field(forecast, stepIndex, extent) {
    const k = `${forecast.meta.title}|${stepIndex}|${extent.lon0}`;
    if (!this._fieldCache.has(k)) {
      if (this._fieldCache.size > 60) this._fieldCache.clear();
      this._fieldCache.set(k, buildPressureField(forecast.steps[stepIndex].mslp, extent));
    }
    return this._fieldCache.get(k);
  }
  _accumulated(forecast, stepIndex) {
    const acc = {};
    for (let i = 0; i <= stepIndex; i++) for (const r of forecast.steps[i].regions) acc[r.region_id] = (acc[r.region_id] || 0) + r.rain_mm;
    return acc;
  }
  _regionData(step) { const m = new Map(); for (const r of step.regions) m.set(r.region_id, r); return m; }
  _regionName(id) { return this.places.regions.find((r) => r.id === id)?.name || id; }

  // ----- background & frames -----
  _drawBackground(ctx) {
    const g = ctx.createLinearGradient(0, 0, PANEL_W, PANEL_H);
    g.addColorStop(0, '#0a1020'); g.addColorStop(1, '#0f1b33');
    ctx.fillStyle = g; ctx.fillRect(0, 0, PANEL_W, PANEL_H);
  }
  _drawMapFrame(ctx, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    roundRect(ctx, r.x, r.y, r.w, r.h, 18); ctx.fillStyle = THEME.ocean1; ctx.fill();
    ctx.restore();
  }
  _drawBase(ctx, P, r) {
    const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    g.addColorStop(0, THEME.ocean0); g.addColorStop(1, THEME.ocean1);
    ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
    // Graticule
    ctx.strokeStyle = THEME.graticule; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.font = '500 12px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(40,60,90,0.5)';
    for (let lon = 150; lon <= 190; lon += 5) { const [x0, y0] = P.proj(P.extent.lat1, lon), [x1, y1] = P.proj(P.extent.lat0, lon); if (x0 < r.x || x0 > r.x + r.w) continue; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.fillText(`${lon > 180 ? 360 - lon + '°W' : lon + '°E'}`, x0 + 4, r.y + r.h - 26); }
    for (let lat = -55; lat <= -25; lat += 5) { const [x0, y0] = P.proj(lat, P.extent.lon0), [x1] = P.proj(lat, P.extent.lon1); if (y0 < r.y || y0 > r.y + r.h) continue; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke(); if (y0 > r.y + 70) ctx.fillText(`${-lat}°S`, r.x + 8, y0 - 4); }
  }
  _tracePolys(ctx, P, feature) {
    const g = feature.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    ctx.beginPath();
    for (const poly of polys) for (const ring of poly) ring.forEach(([lon, lat], i) => { const [x, y] = P.proj(lat, lon); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath();
  }
  _layerRegions(ctx, P, colorFn, step) {
    const data = step ? this._regionData(step) : null;
    // Land fill first (all regions) for a clean coastline shadow
    ctx.save(); ctx.shadowColor = 'rgba(30,50,80,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    for (const f of this.regions.features) { this._tracePolys(ctx, P, f); ctx.fillStyle = THEME.land; ctx.fill(); }
    ctx.restore();
    for (const f of this.regions.features) {
      this._tracePolys(ctx, P, f);
      if (colorFn && data) { const r = data.get(f.properties.id); if (r) { ctx.fillStyle = colorFn(r); ctx.fill(); } }
      ctx.strokeStyle = THEME.regionEdge; ctx.lineWidth = 0.9; ctx.stroke();
    }
    // Coastline on top
    ctx.strokeStyle = THEME.landEdge; ctx.lineWidth = 1.4;
    for (const f of this.regions.features) { this._tracePolys(ctx, P, f); ctx.stroke(); }
  }
  _layerIsobars(ctx, P, field, labels, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha;
    const min = Math.floor(Math.min(...field.data) / 4) * 4, max = Math.ceil(Math.max(...field.data) / 4) * 4;
    const placed = [];
    for (let lv = min; lv <= max; lv += 4) {
      const lines = contours(field, lv);
      ctx.strokeStyle = THEME.isobar; ctx.lineWidth = lv % 20 === 0 ? 2.2 : 1.4; ctx.lineJoin = 'round';
      for (const line of lines) {
        if (line.length < 4) continue;
        const pts = line.map(([lon, lat]) => P.proj(lat, lon));
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        if (labels && pts.length > 30) {
          // choose a label spot inside the frame, away from other labels
          for (const frac of [0.5, 0.3, 0.7, 0.15, 0.85]) {
            const i = Math.floor(pts.length * frac), [x, y] = pts[i];
            const rr = P.rect; if (x < rr.x + 40 || x > rr.x + rr.w - 40 || y < rr.y + 60 || y > rr.y + rr.h - 40) continue;
            if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 90)) continue;
            const [x2, y2] = pts[Math.min(pts.length - 1, i + 3)];
            let ang = Math.atan2(y2 - y, x2 - x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
            ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.font = '700 13px Inter, system-ui, sans-serif';
            const w = ctx.measureText(String(lv)).width + 10;
            ctx.fillStyle = 'rgba(245,247,250,0.95)'; roundRect(ctx, -w / 2, -9, w, 18, 5); ctx.fill();
            ctx.fillStyle = THEME.isobarLabel; ctx.textAlign = 'center'; ctx.fillText(String(lv), 0, 5); ctx.restore();
            placed.push([x, y]); break;
          }
        }
      }
    }
    ctx.restore();
  }
  _layerFronts(ctx, P, step, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const f of step.mslp.fronts || []) {
      const pts = catmullRom(f.points.map(([lat, lon]) => P.proj(lat, lon)), 10);
      if (pts.length < 2) continue;
      const color = { cold: '#1d4ed8', warm: '#dc2626', occluded: '#7e22ce', stationary: '#1d4ed8', trough: '#475569' }[f.kind];
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 7; ctx.setLineDash([]); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 3.5;
      if (f.kind === 'trough') ctx.setLineDash([14, 10]);
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
      if (f.kind === 'trough') continue;
      // symbols every ~34px on the side the front is moving toward (heuristic, hemisphere-aware)
      let acc = 0, n = 0;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const seg = Math.hypot(x1 - x0, y1 - y0); acc += seg;
        if (acc < 34) continue; acc = 0;
        const tx = (x1 - x0) / seg, ty = (y1 - y0) / seg;
        let nx = -ty, ny = tx; // one normal (screen coords, y down)
        const east = nx, north = -ny;
        const want = f.kind === 'warm' ? (-north + 0.4 * east) : (east + 0.3 * north);
        if (want < 0) { nx = -nx; ny = -ny; }
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, s = 9;
        const alt = f.kind === 'occluded' ? n % 2 === 0 : f.kind === 'stationary' ? n % 2 === 0 : f.kind === 'cold';
        const stCol = f.kind === 'stationary' ? (n % 2 === 0 ? '#1d4ed8' : '#dc2626') : color;
        ctx.fillStyle = stCol; ctx.strokeStyle = stCol;
        if (f.kind === 'stationary' && n % 2 === 1) { nx = -nx; ny = -ny; }
        if (alt) { ctx.beginPath(); ctx.moveTo(mx - tx * s, my - ty * s); ctx.lineTo(mx + nx * s * 1.3, my + ny * s * 1.3); ctx.lineTo(mx + tx * s, my + ty * s); ctx.closePath(); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(mx, my, s * 0.9, Math.atan2(ny, nx) - Math.PI / 2, Math.atan2(ny, nx) + Math.PI / 2); ctx.closePath(); ctx.fill(); }
        n++;
      }
    }
    ctx.restore();
  }
  _layerSystems(ctx, P, step, field, compact = false) {
    const r = P.rect;
    for (const s of step.mslp.systems || []) {
      const [x, y] = P.proj(s.lat, s.lon);
      if (x < r.x + 30 || x > r.x + r.w - 30 || y < r.y + 70 || y > r.y + r.h - 30) continue;
      const col = s.kind === 'L' ? THEME.low : THEME.high;
      ctx.save(); ctx.textAlign = 'center';
      ctx.font = `800 ${compact ? 34 : 46}px Inter, system-ui, sans-serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(s.kind, x, y + (compact ? 12 : 16));
      ctx.fillStyle = col; ctx.fillText(s.kind, x, y + (compact ? 12 : 16));
      ctx.font = '700 15px Inter, system-ui, sans-serif'; ctx.lineWidth = 4; ctx.strokeText(`${Math.round(s.pressure_hpa)}`, x, y + (compact ? 30 : 36)); ctx.fillStyle = '#1f2a40'; ctx.fillText(`${Math.round(s.pressure_hpa)}`, x, y + (compact ? 30 : 36));
      if (s.label && !compact) { ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.lineWidth = 4; ctx.strokeText(s.label, x, y - 26); ctx.fillStyle = 'rgba(31,42,64,0.85)'; ctx.fillText(s.label, x, y - 26); }
      ctx.restore();
    }
  }
  _layerBarbs(ctx, P, field, step) {
    const r = P.rect, spacing = 58;
    const regionVec = step.regions.map((rg) => { const f = this.regions.features.find((ft) => ft.properties.id === rg.region_id); const v = windToVec(rg.wind_dir_deg, rg.wind_mean_kt); return { lat: f.properties.lat, lon: f.properties.lon, ...v }; });
    for (let y = r.y + 70; y < r.y + r.h - 30; y += spacing) {
      for (let x = r.x + 40; x < r.x + r.w - 30; x += spacing) {
        const [lat, lon] = P.inv(x + (((y / spacing) | 0) % 2) * spacing / 2, y);
        if (lat < -60 || lat > -20) continue;
        const nearest = regionVec.reduce((b, v) => { const d = distKm(lat, lon, v.lat, v.lon); return d < b.d ? { d, v } : b; }, { d: 1e9, v: null });
        const overLand = this._isLand(lat, lon);
        const geo = fieldWind(field, lat, lon, overLand);
        let u = geo.u, v = geo.v;
        if (nearest.v && nearest.d < 260) {
          // IDW blend of regional values, weight decays with distance from land
          let su = 0, sv = 0, sw = 0;
          for (const rv of regionVec) { const d = Math.max(20, distKm(lat, lon, rv.lat, rv.lon)); if (d > 320) continue; const w = 1 / (d * d); su += rv.u * w; sv += rv.v * w; sw += w; }
          const wBlend = overLand ? 0.85 : Math.max(0, 1 - nearest.d / 260) * 0.7;
          if (sw > 0) { u = (su / sw) * wBlend + u * (1 - wBlend); v = (sv / sw) * wBlend + v * (1 - wBlend); }
        }
        const w = vecToWind(u, v);
        drawBarb(ctx, x, y, w.dir, w.kt, windColor(w.kt), 26);
      }
    }
  }
  _isLand(lat, lon) {
    for (const f of this.regions.features) {
      const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (const poly of polys) if (pointInPoly([lon, lat], poly[0])) return true;
    }
    return false;
  }
  _layerRegionLabels(ctx, P, step, textFn, unit, subFn = null, avoid = [], skipFn = null) {
    const data = this._regionData(step);
    const offsets = { auckland: [26, -10], nelson: [-6, -22], tasman: [-30, 4], marlborough: [26, 0], wellington: [30, 12], hawkes_bay: [16, 6], gisborne: [12, -8], bay_of_plenty: [18, 10], taranaki: [-26, 0], manawatu_whanganui: [0, 12], waikato: [-6, 10], west_coast: [-36, 0], canterbury: [12, 6], otago: [10, 14], southland: [-10, 12], northland: [-22, -8] };
    ctx.save(); ctx.textAlign = 'center';
    const placed = [...avoid];
    for (const f of this.regions.features) {
      const id = f.properties.id, d = data.get(id); if (!d || (skipFn && skipFn(d))) continue;
      const [x0, y0] = P.proj(f.properties.lat, f.properties.lon); const off = offsets[id] || [0, 0];
      const x = x0 + off[0]; let y = y0 + off[1];
      const main = textFn(d), sub = subFn ? subFn(d) : '';
      ctx.font = '800 17px Inter, system-ui, sans-serif';
      const w = Math.max(44, ctx.measureText(`${main} ${unit}`).width + 16);
      const h = sub ? 42 : 28;
      const wFull = Math.max(w, sub ? ctx.measureText(sub).width * 0.75 + 16 : 0);
      for (let tries = 0; tries < 4; tries++) { if (!placed.some(([px, py, pw, ph]) => x - wFull / 2 < px + pw && x + wFull / 2 > px && y - 14 < py + ph && y - 14 + h > py)) break; y += h + 4; }
      placed.push([x - wFull / 2, y - 14, wFull, h]);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.strokeStyle = 'rgba(31,42,64,0.35)'; ctx.lineWidth = 1;
      roundRect(ctx, x - w / 2, y - 14, Math.max(w, sub ? ctx.measureText(sub).width * 0.75 + 16 : 0), h, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111827'; ctx.fillText(main, x - (unit ? 7 : 0), y + 6);
      if (unit) { ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.fillStyle = '#4b5563'; ctx.textAlign = 'left'; ctx.fillText(unit, x + ctx.measureText(main).width * 0.5 + 2 - 7 + (main.length > 2 ? 8 : 4), y + 6); ctx.textAlign = 'center'; }
      if (sub) { ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.fillStyle = '#374151'; ctx.fillText(sub, x, y + 22); }
    }
    ctx.restore();
  }
  _layerHotspots(ctx, P, step, which) {
    const spots = (step.hotspots || []).filter((h) => (which === 'rain' ? h.rain_mm > 0 : h.snow_cm > 0)).slice(0, 6);
    const boxes = [];
    ctx.save();
    spots.forEach((h, i) => {
      const [x, y] = P.proj(h.lat, h.lon);
      const txt = which === 'rain' ? `${h.name} ${fmtMm(h.rain_mm)} mm` : `${h.name} ${fmtMm(h.snow_cm)} cm`;
      ctx.font = '700 13px Inter, system-ui, sans-serif';
      const w = ctx.measureText(txt).width + 18, right = x < P.rect.x + P.rect.w / 2;
      const lx = right ? x + 18 : x - 18 - w, ly = y - 12 + (i % 2) * 6;
      ctx.strokeStyle = '#111827'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(right ? lx : lx + w, ly + 12); ctx.stroke();
      ctx.fillStyle = '#111827'; roundRect(ctx, lx, ly, w, 24, 12); ctx.fill();
      ctx.fillStyle = which === 'rain' ? '#fde047' : '#bfdbfe'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#111827'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(txt, lx + 9, ly + 17);
      boxes.push([lx, ly, w, 24]);
    });
    ctx.restore();
    return boxes;
  }
  _layerCities(ctx, P, step, mode) {
    const byId = new Map(step.cities.map((c) => [c.city_id, c]));
    const placed = [];
    const overlaps = (bx, by, bw, bh) => placed.some(([px, py, pw, ph]) => bx < px + pw && bx + bw > px && by < py + ph && by + bh > py);
    ctx.save();
    for (const c of this.places.cities) {
      const d = byId.get(c.id); if (!d) continue;
      if (mode === 'weather' && !['whangarei', 'auckland', 'hamilton', 'tauranga', 'gisborne', 'new_plymouth', 'napier', 'wellington', 'nelson', 'hokitika', 'christchurch', 'queenstown', 'dunedin', 'invercargill'].includes(c.id)) continue;
      const [x, y] = P.proj(c.lat, c.lon);
      const r = P.rect; if (x < r.x + 20 || x > r.x + r.w - 20 || y < r.y + 60 || y > r.y + r.h - 20) continue;
      ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      const right = c.anchor !== 'left';
      if (mode === 'weather') {
        let bx = right ? x + 10 : x - 10 - 112, by = y - 15;
        if (overlaps(bx, by, 112, 30)) { by = y + 6; if (overlaps(bx, by, 112, 30)) { by = y - 38; if (overlaps(bx, by, 112, 30)) continue; } }
        placed.push([bx, by, 112, 30]);
        ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.strokeStyle = 'rgba(31,42,64,0.3)'; ctx.lineWidth = 1; roundRect(ctx, bx, by, 112, 30, 8); ctx.fill(); ctx.stroke();
        drawGlyph(ctx, d.weather, bx + 17, by + 15, 0.95);
        ctx.fillStyle = '#111827'; ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(c.name, bx + 34, by + 13);
        ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.fillStyle = '#374151'; ctx.fillText(`${Math.round(d.temp_c)}° ${compass(d.wind_dir_deg)} ${Math.round(d.wind_kt)} kt`, bx + 34, by + 25);
      } else {
        const t = Math.round(d.temp_c), txt = `${t}°`;
        ctx.font = '800 15px Inter, system-ui, sans-serif';
        const w = ctx.measureText(txt).width + 14, nameW = ctx.measureText(c.name).width * 0.78;
        let bx = right ? x + 8 : x - 8 - w - nameW - 8, by = y - 12;
        if (overlaps(bx, by, w + nameW + 8, 24)) { by = y + 8; if (overlaps(bx, by, w + nameW + 8, 24)) continue; }
        placed.push([bx, by, w + nameW + 8, 24]);
        ctx.fillStyle = scaleColor(TEMP_SCALE, d.temp_c); roundRect(ctx, bx, by, w, 24, 7); ctx.fill();
        ctx.fillStyle = (t >= 16 && t < 24) ? '#111827' : '#fff'; ctx.textAlign = 'center'; ctx.fillText(txt, bx + w / 2, by + 17);
        ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.fillStyle = '#111827'; ctx.textAlign = 'left'; ctx.fillText(c.name, bx + w + 5, by + 16);
      }
    }
    ctx.restore();
  }
  _layerCoastLabels(ctx, P) {
    const labels = [['TASMAN SEA', -40.5, 166.5], ['PACIFIC OCEAN', -34.6, 179.2], ['Cook Strait', -41.45, 174.3], ['Foveaux Strait', -46.75, 167.9]];
    ctx.save(); ctx.textAlign = 'center';
    for (const [t, lat, lon] of labels) { const [x, y] = P.proj(lat, lon); const r = P.rect; if (x < r.x + 50 || x > r.x + r.w - 50 || y < r.y + 70 || y > r.y + r.h - 20) continue; ctx.font = (t === t.toUpperCase() ? '600 13px' : 'italic 500 12px') + ' Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(40,60,90,0.5)'; ctx.fillText(t, x, y); }
    ctx.restore();
  }
  _drawMapChrome(ctx, r, forecast, step, kind, P) {
    const typeName = this.places.map_types.find((m) => m.id === kind)?.name || kind;
    // Title pill
    ctx.save(); ctx.font = '800 20px Inter, system-ui, sans-serif';
    const title = `${typeName}`;
    const tw = ctx.measureText(title).width;
    ctx.fillStyle = 'rgba(17,24,39,0.92)'; roundRect(ctx, r.x + 16, r.y + 16, tw + 32, 40, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(title, r.x + 32, r.y + 43);
    // Valid window pill
    ctx.font = '700 16px Inter, system-ui, sans-serif';
    const valid = `${step.label}`; const vw = ctx.measureText(valid).width;
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; roundRect(ctx, r.x + 16 + tw + 40, r.y + 20, vw + 28, 32, 10); ctx.fill();
    ctx.fillStyle = '#111827'; ctx.fillText(valid, r.x + 16 + tw + 54, r.y + 42);
    // Timeline
    const n = forecast.steps.length, tlW = Math.min(360, n * 22), x0 = r.x + r.w - 16 - tlW, y0 = r.y + 24;
    ctx.fillStyle = 'rgba(17,24,39,0.85)'; roundRect(ctx, x0 - 10, y0 - 8, tlW + 20, 30, 10); ctx.fill();
    for (let i = 0; i < n; i++) { const x = x0 + (i + 0.5) * (tlW / n); ctx.fillStyle = i === step.index - 1 ? THEME.accent : i < step.index - 1 ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(x, y0 + 7, i === step.index - 1 ? 6 : 3.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'right'; ctx.fillText(`STEP ${step.index}/${n} · +${step.t_offset_h} h`, x0 + tlW + 6, y0 + 36);
    // Legend
    this._drawLegend(ctx, r, kind, forecast);
    // Attribution
    ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(31,42,64,0.75)'; ctx.textAlign = 'right';
    ctx.fillText('Model-blend guidance · not an official warning · see MetService for warnings', r.x + r.w - 14, r.y + r.h - 10);
    ctx.restore();
  }
  _drawLegend(ctx, r, kind, forecast) {
    const scale = kind === 'rain6h' || kind === 'accum' ? RAIN_SCALE : kind === 'snow' ? SNOW_SCALE : kind === 'temp' ? TEMP_SCALE : kind === 'wind' ? WIND_COLORS : null;
    if (!scale) {
      if (kind === 'mslp') {
        const x = r.x + 16, y = r.y + r.h - 86; ctx.fillStyle = 'rgba(255,255,255,0.93)'; roundRect(ctx, x, y, 236, 68, 10); ctx.fill();
        ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = '#111827'; ctx.textAlign = 'left'; ctx.fillText('Isobars every 4 hPa · fronts:', x + 10, y + 18);
        const items = [['cold', '#1d4ed8'], ['warm', '#dc2626'], ['occluded', '#7e22ce'], ['trough', '#475569']];
        items.forEach(([n, c], i) => { const lx = x + 10 + i * 56; ctx.strokeStyle = c; ctx.lineWidth = 3; if (n === 'trough') ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(lx, y + 36); ctx.lineTo(lx + 24, y + 36); ctx.stroke(); ctx.setLineDash([]); ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.fillStyle = '#374151'; ctx.fillText(n, lx, y + 56); });
      }
      return;
    }
    const unit = kind === 'temp' ? '°C' : kind === 'wind' ? 'kt (mean)' : kind === 'snow' ? 'cm / 6 h' : kind === 'accum' ? 'mm (scaled to period)' : 'mm / 6 h';
    const title = kind === 'accum' ? 'Running rainfall total' : kind === 'temp' ? 'Temperature' : kind === 'wind' ? 'Wind speed' : kind === 'snow' ? 'Fresh snow' : 'Rainfall';
    const entries = scale.slice(kind === 'temp' || kind === 'wind' ? 0 : 1);
    const cell = 22, w = entries.length * cell + 20, x = r.x + 16, y = r.y + r.h - 78;
    ctx.fillStyle = 'rgba(255,255,255,0.93)'; roundRect(ctx, x, y, Math.max(w, 200), 60, 10); ctx.fill();
    ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = '#111827'; ctx.textAlign = 'left'; ctx.fillText(`${title} (${unit})`, x + 10, y + 17);
    entries.forEach(([v, c], i) => { ctx.fillStyle = c; ctx.fillRect(x + 10 + i * cell, y + 24, cell, 14); ctx.font = '600 9.5px Inter, system-ui, sans-serif'; ctx.fillStyle = '#374151'; ctx.textAlign = 'center'; ctx.fillText(String(v), x + 10 + i * cell, y + 50); });
  }

  // ----- sidebar -----
  _drawSidebar(ctx, forecast, stepIndex, kind) {
    const step = forecast.steps[stepIndex];
    const x = 1064, w = 1600 - x - 28, top = 28;
    roundRect(ctx, x, top, w, 844, 18); ctx.fillStyle = THEME.panel; ctx.fill(); ctx.strokeStyle = THEME.panelEdge; ctx.lineWidth = 1; ctx.stroke();
    let y = top + 30;
    // Brand bar
    const brand = this.brand.name || 'Weather Desk';
    ctx.save(); ctx.font = '800 15px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.accent; ctx.textAlign = 'left'; ctx.fillText(brand.toUpperCase(), x + 26, y);
    ctx.restore();
    y += 18; ctx.font = '500 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.textAlign = 'left'; ctx.fillText((forecast.meta.model_runs_used || '').slice(0, 70), x + 26, y);
    y += 14; ctx.fillStyle = THEME.panelEdge; ctx.fillRect(x + 26, y, w - 52, 1); y += 30;
    // Package title
    ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.textAlign = 'left';
    ctx.fillText(forecast.meta.title.toUpperCase().slice(0, 60), x + 26, y); y += 24;
    // Step headline
    ctx.font = '800 30px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.text;
    for (const line of wrapText(ctx, step.headline, w - 52).slice(0, 2)) { ctx.fillText(line, x + 26, y); y += 36; }
    ctx.font = '700 15px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.accent; ctx.fillText(step.label, x + 26, y); y += 26;
    ctx.font = '400 15px Inter, system-ui, sans-serif'; ctx.fillStyle = '#d6deeb';
    for (const line of wrapText(ctx, step.narrative, w - 52).slice(0, 5)) { ctx.fillText(line, x + 26, y); y += 22; }
    y += 10;
    // Content block by kind
    const rows = this._sidebarRows(forecast, stepIndex, kind);
    if (rows.title) { ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText(rows.title.toUpperCase(), x + 26, y); y += 14; }
    const maxV = Math.max(1, ...rows.items.map((i) => i.value));
    for (const it of rows.items.slice(0, 8)) {
      y += 24;
      ctx.font = '600 14px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.text; ctx.textAlign = 'left'; ctx.fillText(it.label, x + 26, y);
      ctx.textAlign = 'right'; ctx.font = '800 14px Inter, system-ui, sans-serif'; ctx.fillText(it.display, x + w - 26, y);
      const bw = w - 52, bh = 6; y += 8;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, x + 26, y, bw, bh, 3); ctx.fill();
      ctx.fillStyle = it.color || THEME.accent; roundRect(ctx, x + 26, y, Math.max(6, bw * Math.min(1, it.value / maxV)), bh, 3); ctx.fill();
      if (it.sub) { ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.textAlign = 'right'; ctx.fillText(it.sub, x + w - 26, y + 20); y += 14; }
      y += 6;
    }
    // Key message + confidence at the bottom
    const by = top + 844 - 150;
    ctx.fillStyle = THEME.panelEdge; ctx.fillRect(x + 26, by - 16, w - 52, 1);
    ctx.textAlign = 'left'; ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText('PATTERN', x + 26, by + 4);
    ctx.font = '600 14px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.text;
    let yy = by + 24; for (const line of wrapText(ctx, forecast.assessment.pattern_type, w - 180).slice(0, 2)) { ctx.fillText(line, x + 26, yy); yy += 18; }
    const conf = forecast.assessment.confidence; const cc = { low: '#f87171', moderate: '#fbbf24', high: '#34d399' }[conf] || THEME.accent;
    ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.textAlign = 'right'; ctx.fillText('CONFIDENCE', x + w - 26, by + 4);
    ctx.fillStyle = cc; roundRect(ctx, x + w - 26 - 92, by + 12, 92, 24, 12); ctx.fill(); ctx.fillStyle = '#0b1222'; ctx.font = '800 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(conf.toUpperCase(), x + w - 26 - 46, by + 29);
    // Model weights chips
    let cx = x + 26, cy = by + 66; ctx.textAlign = 'left';
    for (const m of forecast.assessment.model_weights.slice(0, 6)) {
      const t = `${m.model} ${Math.round(m.weight * 100)}%`; ctx.font = '600 11px Inter, system-ui, sans-serif'; const tw = ctx.measureText(t).width + 16;
      if (cx + tw > x + w - 26) { cx = x + 26; cy += 26; if (cy > top + 844 - 40) break; }
      ctx.fillStyle = 'rgba(56,189,248,0.14)'; roundRect(ctx, cx, cy, tw, 20, 10); ctx.fill(); ctx.fillStyle = '#bae6fd'; ctx.fillText(t, cx + 8, cy + 14); cx += tw + 6;
    }
    ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.textAlign = 'left';
    ctx.fillText(ellipsize(ctx, `${this.brand.tagline || 'AI-assisted multi-model blend'} · ${forecast.meta.subtitle}`, w - 52), x + 26, top + 844 - 18);
  }
  _sidebarRows(forecast, stepIndex, kind) {
    const step = forecast.steps[stepIndex];
    const name = (id) => this._regionName(id).replace(' / Tairāwhiti', '');
    if (kind === 'rain6h') return { title: 'Wettest regions this window (lowland · ranges)', items: [...step.regions].sort((a, b) => b.rain_max_mm - a.rain_max_mm).filter((r) => r.rain_max_mm > 0).map((r) => ({ label: name(r.region_id), value: r.rain_max_mm, display: `${fmtMm(r.rain_mm)} · ${fmtMm(r.rain_max_mm)} mm`, color: scaleColor(RAIN_SCALE, Math.max(2, r.rain_max_mm)) })) };
    if (kind === 'accum') { const acc = this._accumulated(forecast, stepIndex); const tot = new Map(forecast.rain_totals.map((t) => [t.region_id, t])); return { title: `Running total to +${step.t_offset_h} h (of period estimate)`, items: Object.entries(acc).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0).map(([id, v]) => ({ label: name(id), value: v, display: `${fmtMm(v)} mm`, sub: tot.get(id) ? `of ${fmtMm(tot.get(id).best_estimate_mm)} mm · ranges to ${fmtMm(tot.get(id).ranges_max_mm)}` : '', color: scaleColor(RAIN_SCALE, Math.max(2, v / 2)) })) }; }
    if (kind === 'wind') return { title: 'Strongest winds (mean · gust)', items: [...step.regions].sort((a, b) => b.wind_gust_kt - a.wind_gust_kt).map((r) => ({ label: `${name(r.region_id)} · ${compass(r.wind_dir_deg)}`, value: r.wind_gust_kt, display: `${Math.round(r.wind_mean_kt)} kt · ${ktToKmh(r.wind_gust_kt)} km/h`, color: windColor(r.wind_mean_kt) })) };
    if (kind === 'snow') return { title: 'Snow this window (fresh · snow level)', items: [...step.regions].filter((r) => r.snow_cm > 0 || r.snow_level_m < 1500).sort((a, b) => b.snow_cm - a.snow_cm).map((r) => ({ label: name(r.region_id), value: Math.max(0.5, r.snow_cm), display: `${fmtMm(r.snow_cm)} cm · ${Math.round(r.snow_level_m / 50) * 50} m`, color: '#93c5fd' })) };
    if (kind === 'temp') return { title: 'Temperatures (main centres)', items: [...step.cities].sort((a, b) => b.temp_c - a.temp_c).filter((_, i, a) => i < 4 || i >= a.length - 4).map((c) => ({ label: this.places.cities.find((p) => p.id === c.city_id)?.name || c.city_id, value: c.temp_c + 15, display: `${Math.round(c.temp_c)} °C · ${WEATHER_LABEL[c.weather] || c.weather}`, color: scaleColor(TEMP_SCALE, c.temp_c) })) };
    // mslp: systems + fronts + headline cities
    const items = step.mslp.systems.map((s) => ({ label: `${s.kind === 'L' ? 'Low' : 'High'} ${s.label ? '· ' + s.label : ''}`.trim(), value: s.kind === 'L' ? 1040 - s.pressure_hpa : s.pressure_hpa - 990, display: `${Math.round(s.pressure_hpa)} hPa`, sub: `${Math.abs(s.lat).toFixed(1)}°S ${fmtLon(s.lon)}`, color: s.kind === 'L' ? '#f87171' : '#60a5fa' }));
    const fr = {}; for (const f of step.mslp.fronts) fr[f.kind] = (fr[f.kind] || 0) + 1; const frTxt = Object.entries(fr).map(([k, n]) => `${n} ${k}`).join(', '); if (frTxt) items.push({ label: 'Fronts / troughs', value: 0.1, display: frTxt, color: '#94a3b8' });
    return { title: 'Pressure systems', items };
  }

  _drawOverview(ctx, forecast) {
    const a = forecast.assessment;
    const x = 28, w = 1600 - 56;
    roundRect(ctx, x, 28, w, 844, 18); ctx.fillStyle = THEME.panel; ctx.fill(); ctx.strokeStyle = THEME.panelEdge; ctx.stroke();
    let y = 72;
    ctx.font = '800 15px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.accent; ctx.textAlign = 'left'; ctx.fillText((this.brand.name || 'Weather Desk').toUpperCase(), x + 36, y);
    ctx.textAlign = 'right'; ctx.font = '500 13px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText(`${forecast.meta.model_runs_used} · from ${forecast.meta.start_local}`, x + w - 36, y);
    y += 44; ctx.textAlign = 'left'; ctx.font = '800 40px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.text;
    for (const l of wrapText(ctx, forecast.meta.title, 900).slice(0, 2)) { ctx.fillText(l, x + 36, y); y += 46; }
    ctx.font = '500 17px Inter, system-ui, sans-serif'; ctx.fillStyle = '#c7d2e3'; ctx.fillText(forecast.meta.subtitle, x + 36, y); y += 34;
    const cc = { low: '#f87171', moderate: '#fbbf24', high: '#34d399' }[a.confidence];
    ctx.fillStyle = cc; roundRect(ctx, x + 36, y - 16, 150, 28, 14); ctx.fill(); ctx.fillStyle = '#0b1222'; ctx.font = '800 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`CONFIDENCE ${a.confidence.toUpperCase()}`, x + 111, y + 3);
    ctx.textAlign = 'left'; ctx.fillStyle = THEME.text; ctx.font = '700 15px Inter, system-ui, sans-serif'; ctx.fillText(a.pattern_type, x + 206, y + 3); y += 36;
    ctx.font = '400 15px Inter, system-ui, sans-serif'; ctx.fillStyle = '#d6deeb';
    for (const l of wrapText(ctx, a.pattern_summary, 880).slice(0, 5)) { ctx.fillText(l, x + 36, y); y += 22; }
    y += 14; ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText('KEY MESSAGES', x + 36, y); y += 10;
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    for (const k of a.key_messages.slice(0, 6)) { ctx.font = '600 15px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.accent; ctx.beginPath(); ctx.arc(x + 44, y + 14, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = THEME.text; const ls = wrapText(ctx, k, 860).slice(0, 2); for (const l of ls) { y += 20; ctx.fillText(l, x + 58, y); } y += 8; }
    y += 20; ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText('UNCERTAINTY', x + 36, y);
    ctx.font = '400 13px Inter, system-ui, sans-serif'; ctx.fillStyle = '#c7d2e3';
    for (const u of a.uncertainties.slice(0, 3)) { for (const l of wrapText(ctx, '• ' + u, 880).slice(0, 2)) { y += 18; ctx.fillText(l, x + 36, y); } }
    // Timeline strip: wettest-region 6-h rain per step
    const ty = 700, th = 90, tx = x + 36, tw = 880, n = forecast.steps.length;
    ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText('6-HOURLY RAIN TIMELINE (WETTEST REGION, RANGES) · SNOW LEVEL MIN', tx, ty - 12);
    const peaks = forecast.steps.map((st) => Math.max(...st.regions.map((rg) => rg.rain_max_mm)));
    const pk = Math.max(1, ...peaks); const bw = tw / n;
    forecast.steps.forEach((st, i) => {
      const h = Math.max(3, (peaks[i] / pk) * (th - 30)); const bx = tx + i * bw;
      ctx.fillStyle = scaleColor(RAIN_SCALE, Math.max(2, peaks[i])); roundRect(ctx, bx + 2, ty + th - 24 - h, bw - 4, h, 3); ctx.fill();
      const slMin = Math.min(...st.regions.map((rg) => rg.snow_level_m));
      if (slMin < 1500) { ctx.fillStyle = '#bfdbfe'; ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`❄ ${Math.round(slMin / 100) * 100} m`, bx + bw / 2, ty + th - 28 - h); }
      ctx.fillStyle = '#e5e7eb'; ctx.font = '700 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(peaks[i])}`, bx + bw / 2, ty + th - 10);
      if (n <= 8 || i % Math.ceil(n / 8) === 0) { ctx.fillStyle = THEME.textDim; ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.fillText(st.label.length > 18 && n > 8 ? `+${st.t_offset_h} h` : st.label, bx + bw / 2, ty + th + 4); }
    });
    ctx.textAlign = 'left';
    // Right column: model weights & rain totals table
    const rx = x + 960, rw = w - 960 - 36; let ry = 120;
    ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText('MODEL WEIGHTS FOR THIS EVENT', rx, ry); ry += 8;
    for (const m of a.model_weights.slice(0, 7)) { ry += 22; ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.text; ctx.fillText(m.model, rx, ry); ctx.textAlign = 'right'; ctx.fillText(`${Math.round(m.weight * 100)}%`, rx + rw, ry); ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, rx, ry + 6, rw, 5, 2); ctx.fill(); ctx.fillStyle = THEME.accent; roundRect(ctx, rx, ry + 6, rw * Math.min(1, m.weight), 5, 2); ctx.fill(); ry += 8; }
    ry += 30; ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText(`${forecast.meta.period_hours}-HOUR RAIN: MODEL MEAN → BLEND (RANGES MAX)`, rx, ry); ry += 6;
    const totals = [...forecast.rain_totals].sort((p, q) => q.best_estimate_mm - p.best_estimate_mm).slice(0, 9);
    const mx = Math.max(1, ...totals.map((t) => t.ranges_max_mm));
    for (const t of totals) { ry += 24; ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.text; ctx.fillText(this._regionName(t.region_id).replace(' / Tairāwhiti', ''), rx, ry); ctx.textAlign = 'right'; ctx.fillText(`${fmtMm(t.model_mean_mm)} → ${fmtMm(t.blended_low_mm)}–${fmtMm(t.blended_high_mm)} (${fmtMm(t.ranges_max_mm)})`, rx + rw, ry); ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, rx, ry + 6, rw, 5, 2); ctx.fill(); ctx.fillStyle = scaleColor(RAIN_SCALE, Math.max(2, t.best_estimate_mm)); roundRect(ctx, rx, ry + 6, rw * (t.best_estimate_mm / mx), 5, 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(rx + rw * Math.min(1, t.ranges_max_mm / mx) - 1, ry + 4, 2, 9); ry += 8; }
    if (forecast.snow_summary.items.length) { ry += 30; ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.fillText('SNOW', rx, ry); ry += 20; ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.text; for (const l of wrapText(ctx, forecast.snow_summary.headline, rw).slice(0, 2)) { ctx.fillText(l, rx, ry); ry += 18; } ctx.font = '400 12px Inter, system-ui, sans-serif'; ctx.fillStyle = '#c7d2e3'; for (const it of forecast.snow_summary.items.slice(0, 3)) { ry += 18; ctx.fillText(`${it.location}: ${fmtMm(it.snow_cm_low)}–${fmtMm(it.snow_cm_high)} cm, level to ${Math.round(it.snow_level_min_m)} m, ${it.timing}`.slice(0, 70), rx, ry); } }
    ctx.font = '500 12px Inter, system-ui, sans-serif'; ctx.fillStyle = THEME.textDim; ctx.textAlign = 'left';
    wrapText(ctx, a.official_note, w - 72).slice(0, 2).forEach((l, i) => ctx.fillText(l, x + 36, 872 - 40 + i * 16));
  }
}
