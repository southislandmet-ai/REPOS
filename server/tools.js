// Tool definitions for the forecaster. Both tools are client-side (human in the loop):
//  - ask_user: the model asks the forecaster which maps / details it wants before drawing.
//  - emit_forecast: the model hands over the complete, schema-valid 6-hourly forecast package
//    which the browser renders into publication-quality maps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PLACES = JSON.parse(fs.readFileSync(path.join(here, '..', 'public', 'data', 'nz_places.json'), 'utf8'));

export const REGION_IDS = PLACES.regions.map((r) => r.id);
export const CITY_IDS = PLACES.cities.map((c) => c.id);
export const MAP_TYPE_IDS = PLACES.map_types.map((m) => m.id);
export const WEATHER_ENUM = [
  'clear', 'partly_cloudy', 'cloudy', 'drizzle', 'showers', 'rain', 'heavy_rain',
  'thunder', 'sleet', 'snow', 'heavy_snow', 'fog', 'windy', 'frost',
];

const num = { type: 'number' };
const int = { type: 'integer' };
const str = { type: 'string' };
const arr = (items) => ({ type: 'array', items });
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const askUserTool = {
  name: 'ask_user',
  description:
    'Ask the forecaster (the human user) one batched set of questions BEFORE producing the forecast package: ' +
    'which map types they want for each 6-hour step, confirmation of the start time, focus regions, extra hotspots, ' +
    'branding, or anything you genuinely need. Ask everything you need in ONE call (max 6 questions). ' +
    'Do not ask things the user already told you. The UI renders options as checkboxes/radios with an "other" text box.',
  strict: true,
  input_schema: obj({
    intro: { ...str, description: 'One or two sentences: what you have understood from their data/imagery and why you are asking.' },
    questions: arr(obj({
      id: { ...str, description: 'Short machine id, e.g. "maps", "start_time", "focus_regions", "extras".' },
      prompt: { ...str, description: 'The question in plain language.' },
      type: { type: 'string', enum: ['single', 'multi', 'text'] },
      options: arr(obj({
        value: str,
        label: str,
        description: { ...str, description: 'Short helper text; empty string if none.' },
        recommended: { type: 'boolean' },
      })),
      allow_other: { type: 'boolean', description: 'Show a free-text "other" box.' },
    })),
  }),
};

const latLon = { type: 'array', items: num, description: '[lat, lon] with lat negative (southern hemisphere), lon 160–185 (east, positive).' };

export const forecastSchema = obj({
  meta: obj({
    title: { ...str, description: 'Headline for the package, e.g. "Deep Tasman low: 48-hour rain & snow outlook".' },
    subtitle: { ...str, description: 'One line: pattern + validity, e.g. "Valid Thu 6 pm – Sat 6 pm NZDT · ECMWF/UKMO/GFS blend".' },
    period_hours: { type: 'integer', enum: [24, 48, 120] },
    start_local: { ...str, description: 'Start of step 1 in local NZ time exactly as given in the inputs, e.g. "Thu 2 Oct 2026 18:00 NZDT".' },
    model_runs_used: { ...str, description: 'e.g. "ECMWF 00Z Thu, GFS 06Z Thu, UKMO 00Z Thu".' },
  }),
  assessment: obj({
    pattern_type: { ...str, description: 'Short pattern name, e.g. "Tasman low → southerly change".' },
    pattern_summary: { ...str, description: '2–4 sentences on the synoptic evolution and the mechanism for the rain/snow.' },
    confidence: { type: 'string', enum: ['low', 'moderate', 'high'] },
    model_weights: arr(obj({
      model: str,
      weight: { ...num, description: '0–1, all weights sum to ~1.' },
      reasoning: str,
    })),
    key_messages: { ...arr(str), description: '3–6 impact-led bullet points for the news article.' },
    uncertainties: { ...arr(str), description: '1–4 bullets: what could change and which model is the outlier.' },
    official_note: { ...str, description: 'Reminder that MetService issues official warnings; name any current warning types to check.' },
  }),
  rain_totals: arr(obj({
    region_id: { type: 'string', enum: REGION_IDS },
    model_mean_mm: { ...num, description: 'Raw mean of the user-supplied model totals for this region (0 if none supplied).' },
    blended_low_mm: num,
    blended_high_mm: num,
    best_estimate_mm: { ...num, description: 'Your orographically-corrected blended total for the period; the step values for this region MUST sum to within 5% of this.' },
    ranges_max_mm: { ...num, description: 'Expected maximum in the wettest ranges/catchment of the region.' },
    note: str,
  })),
  snow_summary: obj({
    headline: str,
    items: arr(obj({
      location: str,
      region_id: { type: 'string', enum: REGION_IDS },
      snow_cm_low: num,
      snow_cm_high: num,
      snow_level_min_m: num,
      timing: str,
      note: str,
    })),
  }),
  steps: arr(obj({
    index: { ...int, description: '1-based step number.' },
    t_offset_h: { ...int, description: 'Hours from the period start at the END of this 6-h window (6, 12, 18 …).' },
    label: { ...str, description: 'Window label in local time, e.g. "Thu 6 pm – midnight".' },
    headline: { ...str, description: '≤ 8 words, e.g. "Front slams the West Coast".' },
    narrative: { ...str, description: '1–3 sentences for this window.' },
    mslp: obj({
      background_hpa: { ...num, description: 'Domain background pressure, typically 1010–1016.' },
      gradient_hpa_per_deg_lat: { ...num, description: 'Large-scale N–S gradient added to the background: positive = pressure rises toward the north (equator). Typical 0–1.0.' },
      systems: arr(obj({
        kind: { type: 'string', enum: ['L', 'H'] },
        lat: num,
        lon: num,
        pressure_hpa: num,
        radius_km: { ...num, description: 'Radius at which the anomaly has decayed to half; 400–1800 km.' },
        label: { ...str, description: 'Optional short tag, e.g. "Tasman low"; empty string if none.' },
      })),
      fronts: arr(obj({
        kind: { type: 'string', enum: ['cold', 'warm', 'occluded', 'stationary', 'trough'] },
        points: { ...arr(latLon), description: '3–8 [lat, lon] points, drawn smoothly in order.' },
      })),
    }),
    regions: arr(obj({
      region_id: { type: 'string', enum: REGION_IDS },
      rain_mm: { ...num, description: 'Regional representative 6-h rainfall (populated lowlands / typical gauge), mm.' },
      rain_max_mm: { ...num, description: '6-h rainfall in the region\'s wettest ranges, mm.' },
      snow_cm: { ...num, description: '6-h fresh snow at the region\'s main pass / hill road elevation, cm (0 if none).' },
      snow_level_m: { ...num, description: 'Snow level in metres above sea level (use 3000 if no snow possible).' },
      wind_dir_deg: { ...num, description: 'Direction the wind blows FROM, degrees true.' },
      wind_mean_kt: num,
      wind_gust_kt: num,
      temp_c: { ...num, description: 'Representative air temperature for the window at the main centre, °C.' },
      weather: { type: 'string', enum: WEATHER_ENUM },
    })),
    cities: arr(obj({
      city_id: { type: 'string', enum: CITY_IDS },
      temp_c: num,
      wind_dir_deg: num,
      wind_kt: num,
      weather: { type: 'string', enum: WEATHER_ENUM },
    })),
    hotspots: { ...arr(obj({
      name: str,
      lat: num,
      lon: num,
      rain_mm: { ...num, description: '6-h total at this spot, mm (0 if snow-only).' },
      snow_cm: { ...num, description: '6-h snow at this spot, cm (0 if none).' },
    })), description: 'Up to 6 named spots with the most newsworthy 6-h values (e.g. Milford Sound, Arthur\'s Pass, Esk Valley).' },
    maps: { ...arr({ type: 'string', enum: MAP_TYPE_IDS }), description: 'Map types to render for this step, as agreed with the user.' },
  })),
});

export const emitForecastTool = {
  name: 'emit_forecast',
  description:
    'Deliver the complete forecast package. Call this ONLY after you know which maps the user wants (either they told you ' +
    'or you asked via ask_user). The browser renders one publication-quality map per (step × map type). ' +
    'Provide EVERY 6-hour step for the whole period (24 h → 4 steps, 48 h → 8, 5 days → 20), ALL 16 regions in every step, ' +
    'all 22 cities in every step, and keep per-region step rainfall summing to the region best_estimate_mm. ' +
    'If asked to revise, re-emit the full package with the changes applied.',
  strict: true,
  eager_input_streaming: true,
  input_schema: forecastSchema,
};

export const TOOLS = [askUserTool, emitForecastTool];

const ajv = new Ajv({ allErrors: true, strict: false });
const validateForecastSchema = ajv.compile(forecastSchema);
const validateAskSchema = ajv.compile(askUserTool.input_schema);

/** Semantic checks beyond the JSON schema. Returns a list of human-readable problems (empty = OK). */
export function validateForecast(input) {
  const problems = [];
  if (!validateForecastSchema(input)) {
    for (const e of validateForecastSchema.errors.slice(0, 25)) {
      problems.push(`${e.instancePath || '/'} ${e.message}`);
    }
    return problems;
  }
  const expectedSteps = input.meta.period_hours / 6;
  if (input.steps.length !== expectedSteps) {
    problems.push(`steps: expected ${expectedSteps} six-hour steps for a ${input.meta.period_hours} h period, got ${input.steps.length}.`);
  }
  input.steps.forEach((s, i) => {
    if (s.index !== i + 1) problems.push(`steps[${i}].index should be ${i + 1}.`);
    if (s.t_offset_h !== (i + 1) * 6) problems.push(`steps[${i}].t_offset_h should be ${(i + 1) * 6}.`);
    const got = new Set(s.regions.map((r) => r.region_id));
    const missing = REGION_IDS.filter((id) => !got.has(id));
    if (missing.length) problems.push(`steps[${i}].regions missing: ${missing.join(', ')}.`);
    if (s.regions.length !== got.size) problems.push(`steps[${i}].regions has duplicate region ids.`);
    const gotCities = new Set(s.cities.map((c) => c.city_id));
    const missingCities = CITY_IDS.filter((id) => !gotCities.has(id));
    if (missingCities.length) problems.push(`steps[${i}].cities missing: ${missingCities.join(', ')}.`);
    if (!s.maps.length) problems.push(`steps[${i}].maps is empty – at least one map type per step.`);
    if (!s.mslp.systems.length) problems.push(`steps[${i}].mslp.systems is empty – at least one high or low.`);
    for (const sys of s.mslp.systems) {
      if (sys.lat > -15 || sys.lat < -70 || sys.lon < 140 || sys.lon > 200) {
        problems.push(`steps[${i}] system "${sys.label || sys.kind}" at (${sys.lat}, ${sys.lon}) is outside the chart domain (lat −70…−15, lon 140…200).`);
      }
      if (sys.kind === 'L' && sys.pressure_hpa > s.mslp.background_hpa + 2) problems.push(`steps[${i}] low "${sys.label}" has pressure above background.`);
      if (sys.kind === 'H' && sys.pressure_hpa < s.mslp.background_hpa - 2) problems.push(`steps[${i}] high "${sys.label}" has pressure below background.`);
    }
    for (const f of s.mslp.fronts) {
      if (f.points.length < 2) problems.push(`steps[${i}] a ${f.kind} front has fewer than 2 points.`);
      for (const p of f.points) {
        if (p.length !== 2 || p[0] > -15 || p[0] < -70 || p[1] < 140 || p[1] > 200) {
          problems.push(`steps[${i}] a ${f.kind} front point ${JSON.stringify(p)} is not [lat, lon] inside the domain.`);
          break;
        }
      }
    }
    for (const r of s.regions) {
      if (r.rain_mm < 0 || r.rain_max_mm < r.rain_mm) problems.push(`steps[${i}] ${r.region_id}: rain_max_mm must be ≥ rain_mm ≥ 0.`);
      if (r.wind_gust_kt < r.wind_mean_kt) problems.push(`steps[${i}] ${r.region_id}: gust must be ≥ mean wind.`);
      if (r.snow_cm > 0 && r.snow_level_m > 2500) problems.push(`steps[${i}] ${r.region_id}: snow_cm > 0 but snow level above 2500 m.`);
    }
  });
  // Consistency of totals.
  const totalsById = new Map(input.rain_totals.map((t) => [t.region_id, t]));
  for (const id of REGION_IDS) {
    const t = totalsById.get(id);
    if (!t) { problems.push(`rain_totals missing ${id}.`); continue; }
    const sum = input.steps.reduce((a, s) => a + (s.regions.find((r) => r.region_id === id)?.rain_mm || 0), 0);
    const tol = Math.max(2, t.best_estimate_mm * 0.07);
    if (Math.abs(sum - t.best_estimate_mm) > tol) {
      problems.push(`rain_totals ${id}: step rain_mm sums to ${sum.toFixed(1)} mm but best_estimate_mm is ${t.best_estimate_mm} mm (tolerance ±${tol.toFixed(1)}).`);
    }
    if (t.blended_low_mm > t.best_estimate_mm || t.blended_high_mm < t.best_estimate_mm) {
      problems.push(`rain_totals ${id}: best_estimate_mm must lie within blended_low_mm…blended_high_mm.`);
    }
  }
  const w = input.assessment.model_weights.reduce((a, m) => a + m.weight, 0);
  if (input.assessment.model_weights.length && Math.abs(w - 1) > 0.1) problems.push(`model_weights sum to ${w.toFixed(2)}; they should sum to 1.`);
  return problems;
}

export function validateAsk(input) {
  if (validateAskSchema(input)) {
    if (!input.questions.length) return ['ask_user needs at least one question.'];
    return [];
  }
  return validateAskSchema.errors.slice(0, 10).map((e) => `${e.instancePath || '/'} ${e.message}`);
}
