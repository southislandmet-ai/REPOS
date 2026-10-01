// SIMODEL model suite: storage of uploaded model chart sets + Claude vision extraction of gridded fields.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', 'data', 'suite.json');

// ───────────── Layer catalogue (what SIMODEL can ingest and render) ─────────────
export const LAYERS = [
  { id: 'precip_6h', label: '6-Hour Precip & ptype', units: 'mm', accum_h: 6, kind: 'precip', secondary: 'ptype' },
  { id: 'precip_24h', label: '24-Hour Precipitation', units: 'mm', accum_h: 24, kind: 'precip' },
  { id: 'precip_accum', label: 'Total Precip (since run)', units: 'mm', accum_h: 0, kind: 'precip' },
  { id: 'snow_6h', label: '6-Hour Snowfall', units: 'cm', accum_h: 6, kind: 'snow' },
  { id: 'snow_24h', label: '24-Hour Snowfall', units: 'cm', accum_h: 24, kind: 'snow' },
  { id: 'snow_level', label: 'Snow level / freezing level', units: 'm', accum_h: 0, kind: 'level' },
  { id: 'temp_2m', label: '2 m Temperature', units: '°C', accum_h: 0, kind: 'temp' },
  { id: 'temp_925', label: '925 hPa Temperature', units: '°C', accum_h: 0, kind: 'temp_upper' },
  { id: 'temp_850', label: '850 hPa Temperature', units: '°C', accum_h: 0, kind: 'temp_upper' },
  { id: 'mslp', label: 'MSLP / Synoptic', units: 'hPa', accum_h: 0, kind: 'mslp' },
  { id: 'wind_10m', label: '10 m Wind', units: 'kt', accum_h: 0, kind: 'wind', secondary: 'wind_dir' },
  { id: 'gust', label: 'Wind Gusts', units: 'kt', accum_h: 0, kind: 'wind' },
  { id: 'cloud_total', label: 'Total Cloud Cover', units: '%', accum_h: 0, kind: 'cloud' },
  { id: 'rh_700', label: '700 hPa Relative Humidity', units: '%', accum_h: 0, kind: 'cloud' },
  { id: 'cape', label: 'CAPE', units: 'J/kg', accum_h: 0, kind: 'convective' },
  { id: 'thickness_1000_500', label: '1000–500 hPa Thickness', units: 'dam', accum_h: 0, kind: 'upper' },
  { id: 'height_500', label: '500 hPa Height', units: 'dam', accum_h: 0, kind: 'upper' },
  { id: 'other', label: 'Other', units: '', accum_h: 0, kind: 'other' },
];
export const LAYER_IDS = LAYERS.map((l) => l.id);

export const MODELS = [
  { id: 'ecmwf', name: 'ECMWF IFS (HRES)', group: 'Global', res_km: 9 },
  { id: 'ecmwf_ens', name: 'ECMWF ENS (mean/control)', group: 'Global', res_km: 9 },
  { id: 'aifs', name: 'ECMWF AIFS', group: 'Global (AI)', res_km: 28 },
  { id: 'gfs', name: 'GFS (NCEP)', group: 'Global', res_km: 13 },
  { id: 'gefs', name: 'GEFS mean', group: 'Global', res_km: 25 },
  { id: 'ukmo', name: 'UKMO Global', group: 'Global', res_km: 10 },
  { id: 'access_g', name: 'ACCESS-G (BoM)', group: 'Global', res_km: 12 },
  { id: 'icon', name: 'ICON Global (DWD)', group: 'Global', res_km: 13 },
  { id: 'gem', name: 'GEM / GDPS (CMC)', group: 'Global', res_km: 15 },
  { id: 'jma_gsm', name: 'JMA GSM', group: 'Global', res_km: 13 },
  { id: 'arpege', name: 'ARPEGE (Météo-France)', group: 'Global', res_km: 10 },
  { id: 'cma_grapes', name: 'CMA GRAPES/GFS', group: 'Global', res_km: 12 },
  { id: 'kma_gdaps', name: 'KMA GDAPS', group: 'Global', res_km: 12 },
  { id: 'navgem', name: 'NAVGEM (US Navy)', group: 'Global', res_km: 30 },
  { id: 'graphcast', name: 'GraphCast / FourCastNet / Pangu (AI)', group: 'Global (AI)', res_km: 28 },
  { id: 'metservice_wrf', name: 'MetService WRF NZ (4/8 km)', group: 'NZ regional', res_km: 4 },
  { id: 'nzcsm', name: 'NIWA NZCSM (1.5 km)', group: 'NZ regional', res_km: 1.5 },
  { id: 'nzlam', name: 'NIWA NZLAM (12 km)', group: 'NZ regional', res_km: 12 },
  { id: 'access_c', name: 'ACCESS-C / BoM regional', group: 'Regional', res_km: 4 },
  { id: 'icon_d2_like', name: 'High-res WRF (Windy / Meteologix / other)', group: 'Regional', res_km: 3 },
  { id: 'other', name: 'Other / unknown', group: 'Other', res_km: 25 },
];
export const MODEL_IDS = MODELS.map((m) => m.id);

// Extraction lattice: 0.5° over the NZ domain, row-major north→south, west→east.
export const LATTICE = { lat_start: -34.0, lat_step: -0.5, n_lat: 28, lon_start: 165.5, lon_step: 0.5, n_lon: 28 };
export const LATTICE_N = LATTICE.n_lat * LATTICE.n_lon; // 784

const num = { type: 'number' }, str = { type: 'string' };
const arr = (items) => ({ type: 'array', items });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const extractTool = {
  name: 'extract_chart',
  description: `Report everything you can read from ONE weather model chart image: what it is, its model/run/valid time, and the field values on a ${LATTICE.n_lat}×${LATTICE.n_lon} lattice of 0.5° points covering New Zealand. Read values by matching map colours/contours to the legend. Use -999 for points outside the chart or unreadable. Be precise about time: most charts print "Valid: …", "Init: …", and a lead such as "+36h" or "T+036" – copy them exactly and also convert to ISO UTC.`,
  strict: true,
  eager_input_streaming: true,
  input_schema: obj({
    chart: obj({
      layer_id: { type: 'string', enum: LAYER_IDS, description: 'Best-matching layer type.' },
      layer_label: { ...str, description: 'Human label as the chart titles it, e.g. "6-Hour Precip & ptype", "925 hPa Temperature".' },
      units: { ...str, description: 'Units the legend uses (mm, in, °C, °F, hPa, kt, m/s, km/h, %, dam, cm). Report the ORIGINAL units; values below must be in these units too.' },
      model_detected: { ...str, description: 'Model name printed on the chart (e.g. "GFS 0.25°", "ECMWF IFS"), or "" if none.' },
      source_detected: { ...str, description: 'Website/product watermark (windy.com, tropicaltidbits, pivotalweather, weather.us, MetService, …) or "".' },
      run_time_utc: { ...str, description: 'Model initialisation time ISO-8601 UTC like 2026-10-01T00:00Z, or "" if not shown.' },
      valid_time_utc: { ...str, description: 'Valid time ISO-8601 UTC. For accumulations, the END of the accumulation window. "" if truly unreadable.' },
      valid_time_text: { ...str, description: 'The valid-time text exactly as printed (with timezone), for the user to verify.' },
      lead_hours: { ...num, description: 'Forecast hour (e.g. 36). -1 if unknown.' },
      accumulation_hours: { ...num, description: '6, 24, total-since-run (use the lead), or 0 for instantaneous fields.' },
      time_confidence: { ...num, description: '0–1 confidence in valid_time_utc.' },
      domain_covers_nz: { type: 'boolean', description: 'False if NZ is cut off or not the subject of the chart.' },
      legend_summary: { ...str, description: 'One line: colour → value mapping you used.' },
    }),
    values: { ...arr(num), description: `Exactly ${LATTICE_N} numbers in ORIGINAL units, row-major: row 0 is lat ${LATTICE.lat_start}, rows step ${LATTICE.lat_step}°; col 0 is lon ${LATTICE.lon_start}, cols step ${LATTICE.lon_step}°. -999 = unreadable/outside chart. For precipitation use 0 where the map shows none.` },
    secondary_kind: { type: 'string', enum: ['none', 'wind_dir_deg', 'ptype_code'], description: 'ptype_code: 0 none, 1 rain, 2 snow, 3 sleet/mix, 4 freezing rain. wind_dir_deg: direction wind blows FROM.' },
    secondary_values: { ...arr(num), description: `Exactly ${LATTICE_N} numbers if secondary_kind != none, else an empty array.` },
    features: obj({
      systems: arr(obj({ kind: { type: 'string', enum: ['L', 'H'] }, lat: num, lon: num, pressure_hpa: num, label: str })),
      fronts: arr(obj({ kind: { type: 'string', enum: ['cold', 'warm', 'occluded', 'stationary', 'trough'] }, points: arr({ type: 'array', items: num }) })),
    }),
    extremes: { ...arr(obj({ name: str, lat: num, lon: num, value: num })), description: 'Up to 6 notable maxima/minima with the place name you infer.' },
    quality: obj({
      readability: { ...num, description: '0–1: how confidently the colours/contours could be read.' },
      notes: { ...str, description: 'Anything a forecaster should know (occluded legend, projection oddities, NZ at the edge, missing scale…).' },
    }),
  }),
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validateExtract = ajv.compile(extractTool.input_schema);
export function checkExtract(input) {
  const problems = [];
  if (!validateExtract(input)) return validateExtract.errors.slice(0, 10).map((e) => `${e.instancePath} ${e.message}`);
  if (input.values.length !== LATTICE_N) problems.push(`values must have exactly ${LATTICE_N} numbers (got ${input.values.length}).`);
  if (input.secondary_kind !== 'none' && input.secondary_values.length !== LATTICE_N) problems.push(`secondary_values must have exactly ${LATTICE_N} numbers.`);
  if (input.chart.valid_time_utc && Number.isNaN(Date.parse(input.chart.valid_time_utc))) problems.push('valid_time_utc is not parseable ISO-8601.');
  if (input.chart.run_time_utc && Number.isNaN(Date.parse(input.chart.run_time_utc))) problems.push('run_time_utc is not parseable ISO-8601.');
  return problems;
}

/** Convert values to SIMODEL canonical units (mm, cm, °C, hPa, kt, %, m, dam). */
export function toCanonical(layerId, units, values) {
  const u = (units || '').toLowerCase().trim();
  let f = (v) => v;
  if (/^in(ch(es)?)?$/.test(u)) f = (v) => v * 25.4;
  else if (u === '°f' || u === 'f' || u === 'deg f') f = (v) => (v - 32) * 5 / 9;
  else if (u === 'm/s' || u === 'ms-1') f = (v) => v * 1.94384;
  else if (u === 'km/h' || u === 'kmh' || u === 'kph') f = (v) => v / 1.852;
  else if (u === 'mph') f = (v) => v * 0.868976;
  else if (u === 'pa') f = (v) => v / 100;
  else if (u === 'k' || u === 'kelvin') f = (v) => v - 273.15;
  else if (u === 'm' && /height_500|thickness/.test(layerId)) f = (v) => v / 10;
  else if ((u === 'mm' || u === 'cm') && /snow/.test(layerId)) f = u === 'mm' ? (v) => v / 10 : f;
  return values.map((v) => (v <= -998 ? -999 : f(v)));
}

// ───────────── Storage ─────────────
let suite = null;
function load() {
  if (suite) return suite;
  try { suite = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { suite = { sets: [], updated_at: null }; }
  return suite;
}
function save() { suite.updated_at = new Date().toISOString(); fs.writeFileSync(FILE, JSON.stringify(suite)); }
export function getSuite() { return load(); }
export function catalogue() {
  const s = load();
  return {
    updated_at: s.updated_at, plan: s.plan || null,
    sets: s.sets.map((set) => ({ ...set, charts: set.charts.map(({ values, secondary_values, ...c }) => c) })),
  };
}
export function getSet(id) { return load().sets.find((s) => s.id === id) || null; }
export function addSet(set) { const s = load(); set.id = crypto.randomBytes(6).toString('hex'); set.created_at = new Date().toISOString(); s.sets.push(set); save(); return set; }
export function updateSet(id, patch) {
  const set = getSet(id); if (!set) return null;
  if (patch.charts) {
    // reorder / retime: patch.charts = [{id, valid_time_utc?, lead_hours?, order}]
    for (const pc of patch.charts) { const c = set.charts.find((x) => x.id === pc.id); if (!c) continue; if (pc.valid_time_utc !== undefined) { c.valid_time_utc = pc.valid_time_utc; c.user_edited = true; } if (pc.lead_hours !== undefined) c.lead_hours = pc.lead_hours; if (pc.order !== undefined) c.order = pc.order; }
    set.charts.sort((a, b) => a.order - b.order);
  }
  for (const k of ['layer_id', 'layer_label', 'model_id', 'model_name', 'run_time_utc', 'notes']) if (patch[k] !== undefined) set[k] = patch[k];
  set.updated_at = new Date().toISOString(); save(); return set;
}
export function deleteSet(id) { const s = load(); const n = s.sets.length; s.sets = s.sets.filter((x) => x.id !== id); save(); return s.sets.length !== n; }
export function deleteChart(setId, chartId) { const set = getSet(setId); if (!set) return false; set.charts = set.charts.filter((c) => c.id !== chartId); set.charts.forEach((c, i) => (c.order = i)); save(); return true; }
export function clearSuite() { suite = { sets: [], updated_at: null, plan: null }; save(); }
export function setPlan(plan) { load().plan = plan; save(); }

/** Prompt for one chart image. Kept stable for caching; per-image details go in the user turn. */
export const EXTRACT_SYSTEM = `You are a meteorological chart-reading specialist feeding SIMODEL, a New Zealand model-blending map system.
You receive one chart image at a time, from a known numerical weather model. Your job:
1. Identify what the chart shows (layer type, units, model, source website) and its timing (initialisation and VALID time in UTC, lead hours). Charts from windy.com show local time in the bottom bar; tropicaltidbits/pivotalweather print "Init"/"Valid" in UTC; MetService charts are NZ local time (NZST = UTC+12, NZDT = UTC+13; NZDT runs from the last Sunday of September to the first Sunday of April). Convert carefully.
2. Read the field on the fixed 0.5° lattice over New Zealand by matching colours/contours to the legend. Work systematically row by row (north to south), estimating a representative value for each 0.5° cell. Where the chart shows no precipitation, report 0 (not -999). Report -999 only outside the chart's domain or where the map is obscured by labels.
3. Report synoptic features if the chart has isobars/fronts; report notable maxima; be honest in quality.notes and readability.
Lattice: rows lat ${LATTICE.lat_start} to ${LATTICE.lat_start + LATTICE.lat_step * (LATTICE.n_lat - 1)} (step ${LATTICE.lat_step}); cols lon ${LATTICE.lon_start} to ${LATTICE.lon_start + LATTICE.lon_step * (LATTICE.n_lon - 1)} (step ${LATTICE.lon_step}). Row-major, ${LATTICE_N} values.
Reference points to anchor yourself: Auckland (−36.85, 174.76), Wellington (−41.29, 174.78), Christchurch (−43.53, 172.64), Hokitika (−42.72, 170.97), Dunedin (−45.87, 170.50), Invercargill (−46.41, 168.35), Milford Sound (−44.67, 167.93), Gisborne (−38.66, 178.02), Whangārei (−35.73, 174.32). The Southern Alps run SW–NE along the west of the South Island; West Coast maxima and lee minima are expected in westerly flows.
Always answer by calling extract_chart exactly once.`;

// ───────────── Self-sort heuristics (run after per-image extraction) ─────────────
/** Parse a forecast hour out of a filename: f036, _036, +36h, t36, 36hr, h36, 036.png, ecmwf-36 … */
export function leadFromName(name) {
  const s = String(name || '').toLowerCase();
  const pats = [/(?:^|[^a-z0-9])(?:f|t|h|fh|hr|ft|\+)0*(\d{1,3})(?:h|hr|hrs)?(?=[^0-9]|$)/, /(?:^|[^0-9])0*(\d{1,3})\s?(?:h|hr|hrs|hour)(?=[^a-z]|$)/, /(?:^|[^0-9])(\d{3})(?=[^0-9]|$)/];
  for (const p of pats) { const m = s.match(p); if (m) { const v = Number(m[1]); if (v >= 0 && v <= 384) return v; } }
  return null;
}
/**
 * Make the ordering robust: fill missing valid times from run + lead (from the chart or the filename),
 * detect the common step, repair outliers that break monotonic 6-h spacing, flag duplicates.
 * Mutates charts (adds inferred fields) and returns {warnings}.
 */
export function selfSort(charts) {
  const warnings = [];
  const runTimes = charts.map((c) => c.run_time_utc).filter((v) => v && !Number.isNaN(Date.parse(v)));
  const run = runTimes.length ? runTimes.sort((a, b) => runTimes.filter((x) => x === b).length - runTimes.filter((x) => x === a).length)[0] : null;
  const runMs = run ? Date.parse(run) : NaN;
  for (const c of charts) {
    const nameLead = leadFromName(c.name);
    if (c.lead_hours == null || c.lead_hours < 0) { if (nameLead != null) { c.lead_hours = nameLead; c.lead_source = 'filename'; } }
    else if (nameLead != null && Math.abs(nameLead - c.lead_hours) >= 6 && (c.time_confidence ?? 1) < 0.8) { warnings.push(`${c.name}: chart read lead +${c.lead_hours} h but filename says +${nameLead} h – using filename.`); c.lead_hours = nameLead; c.lead_source = 'filename'; }
    const vt = c.valid_time_utc && !Number.isNaN(Date.parse(c.valid_time_utc)) ? Date.parse(c.valid_time_utc) : NaN;
    if (Number.isNaN(vt) && !Number.isNaN(runMs) && c.lead_hours >= 0) { c.valid_time_utc = new Date(runMs + c.lead_hours * 3600e3).toISOString().slice(0, 16) + 'Z'; c.valid_source = 'run+lead'; }
    else if (!Number.isNaN(vt) && !Number.isNaN(runMs) && c.lead_hours >= 0) {
      const implied = runMs + c.lead_hours * 3600e3;
      if (Math.abs(implied - vt) >= 3 * 3600e3) {
        // Prefer the printed valid time unless its confidence is low; typical failure is a local-time/UTC mix-up (12–13 h).
        const diffH = Math.round((vt - implied) / 3600e3);
        if ((c.time_confidence ?? 1) < 0.75 || Math.abs(diffH) === 12 || Math.abs(diffH) === 13) { warnings.push(`${c.name}: valid time ${c.valid_time_utc} disagrees with run+lead by ${diffH} h (likely a local-time caption) – using run+lead.`); c.valid_time_utc = new Date(implied).toISOString().slice(0, 16) + 'Z'; c.valid_source = 'run+lead'; }
        else warnings.push(`${c.name}: valid time and run+lead differ by ${diffH} h – kept the printed valid time; check it.`);
      }
    }
  }
  const dated = charts.filter((c) => c.valid_time_utc && !Number.isNaN(Date.parse(c.valid_time_utc)));
  dated.sort((a, b) => Date.parse(a.valid_time_utc) - Date.parse(b.valid_time_utc));
  // Common step
  const steps = []; for (let i = 1; i < dated.length; i++) steps.push((Date.parse(dated[i].valid_time_utc) - Date.parse(dated[i - 1].valid_time_utc)) / 3600e3);
  const step = steps.length ? steps.slice().sort((a, b) => a - b)[Math.floor(steps.length / 2)] : null;
  // Duplicates
  for (let i = 1; i < dated.length; i++) if (dated[i].valid_time_utc === dated[i - 1].valid_time_utc) { warnings.push(`${dated[i - 1].name} and ${dated[i].name} have the same valid time ${dated[i].valid_time_utc}.`); dated[i].duplicate_of = dated[i - 1].id; }
  // Undated charts: slot them by upload order between dated neighbours using the step
  const undated = charts.filter((c) => !dated.includes(c));
  if (undated.length && dated.length && step) {
    const byUpload = [...charts].sort((a, b) => a.upload_index - b.upload_index);
    for (const c of undated) {
      const idx = byUpload.indexOf(c); let prev = null; for (let k = idx - 1; k >= 0; k--) if (dated.includes(byUpload[k])) { prev = byUpload[k]; break; }
      let next = null; for (let k = idx + 1; k < byUpload.length; k++) if (dated.includes(byUpload[k])) { next = byUpload[k]; break; }
      if (prev) { c.valid_time_utc = new Date(Date.parse(prev.valid_time_utc) + step * 3600e3).toISOString().slice(0, 16) + 'Z'; c.valid_source = 'inferred from sequence'; }
      else if (next) { c.valid_time_utc = new Date(Date.parse(next.valid_time_utc) - step * 3600e3).toISOString().slice(0, 16) + 'Z'; c.valid_source = 'inferred from sequence'; }
      if (c.valid_time_utc) { warnings.push(`${c.name}: no readable valid time – placed in sequence at ${c.valid_time_utc}; please verify.`); dated.push(c); }
    }
    dated.sort((a, b) => Date.parse(a.valid_time_utc) - Date.parse(b.valid_time_utc));
  }
  if (step && ![1, 3, 6, 12, 24].includes(step)) warnings.push(`Unusual time step between charts (${step} h) – check the valid times.`);
  return { warnings, step, run };
}

// ───────────── AI blend-plan review ─────────────
export const planTool = {
  name: 'emit_blend_plan',
  description: 'Deliver the SIMODEL blend plan after reviewing the uploaded model suite: per-model/per-region weight multipliers and bias corrections for each field family, the dominant flow for orographic downscaling, physics settings, and an honest confidence narrative.',
  strict: true,
  input_schema: obj({
    regime: obj({ name: str, summary: { ...str, description: '2–4 sentences on the synoptic situation across the suite and what it means for South Island weather.' } }),
    flow: obj({ direction_deg: { ...num, description: 'Dominant low-level flow direction over the South Island (wind FROM, degrees true) for the main precipitation period.' }, speed_ms: num, varies_in_time: { type: 'boolean' } }),
    physics: obj({ lapse_rate_c_per_km: { ...num, description: '5.0 (saturated/cloudy) … 8.0 (dry föhn). Default 6.0.' }, upslope_gain: { ...num, description: 'Orographic enhancement gain, 1.0 (weak/convective) … 2.2 (strong stable NW flow onto the Alps). Default 1.6.' }, elevation_gain_per_km: { ...num, description: 'Extra enhancement per km above model terrain, 0.2–0.6. Default 0.35.' }, advection_s: { ...num, description: 'Downwind drift of enhancement, 300–1500 s. Default 700.' } }),
    weights: arr(obj({ model_id: { type: 'string', enum: MODEL_IDS }, family: { type: 'string', enum: ['all', 'precip', 'snow', 'temp', 'temp_upper', 'wind', 'mslp', 'level', 'cloud', 'upper', 'convective'] }, subregion: { ...str, description: 'Subregion id from the list, or "" for everywhere.' }, weight_multiplier: { ...num, description: '0.3–2.0 applied on top of the static skill matrix.' }, bias: { ...num, description: 'Override bias (multiplicative for precip/snow/wind, additive °C for temp, metres for level). Use 1 or 0 for none.' }, reason: str })),
    confidence: obj({ overall: { type: 'string', enum: ['very low', 'low', 'medium', 'high'] }, narrative: { ...str, description: 'Plain-language: what SIMODEL can and cannot show with this much data, where to trust detail, what is missing.' }, missing_data: { ...arr(str), description: 'Most valuable additions (e.g. "a second model for 6-h precip", "10 m wind to drive orographic enhancement").' } }),
    model_notes: arr(obj({ model_id: { type: 'string', enum: MODEL_IDS }, note: str })),
  }),
};
const validatePlan = ajv.compile(planTool.input_schema);
export function checkPlan(input) { return validatePlan(input) ? [] : validatePlan.errors.slice(0, 10).map((e) => `${e.instancePath} ${e.message}`); }
export const PLAN_SYSTEM = `You are the senior South Island forecaster reviewing a multi-model suite before SIMODEL downscales it to ~1.5 km.
You will receive: the list of uploaded chart sets (model, layer, run, valid times, lead hours, readability), per-chart summaries including detected synoptic features and extremes, the static regional skill matrix SIMODEL already applies, and the forecaster's notes.
Decide: (1) the regime and dominant low-level flow for the precipitation period; (2) physics settings for the downscaler; (3) weight multipliers and bias overrides where THIS situation departs from the static matrix (e.g. in an easterly rain event the lee/windward roles reverse: Canterbury foothills become windward – reduce ECMWF/GFS lee over-spill corrections and increase their Canterbury weights; in a strong stable NW flow raise upslope_gain; in convective SW flows lower it); (4) an honest confidence narrative tied to the amount and agreement of data – with one model there is no blend and detail must be described as terrain-redistributed single-model guidance; (5) which additional uploads would most improve the output.
Use the NZ knowledge you have: Southern Alps orographic enhancement (coast 2–4 m/yr → 10+ m/yr near the Divide → <1 m/yr in the lee), spillover 20–40 km east of the Divide, Canterbury nor'wester downslope gusts under-done by globals, inland basin cold pools under-done by globals, snow-level drag in heavy precipitation, Cook Strait and Kaikōura funnelling, global models under-doing ranges totals by 35–55% and over-spilling into the lee, convection-permitting NZ models (WRF 4 km, NZCSM 1.5 km) best at day 1–2, ECMWF best synoptic skill, GFS fast/progressive, ACCESS wet in the lee, AIFS/GraphCast smooth low-biased precipitation but excellent pattern.
Answer by calling emit_blend_plan once. Keep weights to the few that matter (≤ 12 entries).`;
