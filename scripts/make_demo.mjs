// Generates public/data/demo_forecast.json – a physically plausible 24 h example (Tasman low → southerly change)
// so the renderer and UI can be previewed without an API key. Validated against the tool schema.
import fs from 'node:fs';
import { validateForecast, REGION_IDS, CITY_IDS } from '../server/tools.js';

const r = (v) => Math.round(v * 10) / 10;
const labels = ['Thu 6 am – noon', 'Thu noon – 6 pm', 'Thu 6 pm – midnight', 'Fri midnight – 6 am'];
// Per-region: [rain per step (lowland)], [ranges multiplier], base wind dir per step, mean kt per step, temp per step, weather per step
const R = {
  northland:          { rain: [1, 3, 6, 4],   mult: 1.6, dir: [20, 10, 350, 330], kt: [14, 18, 22, 20], t: [16, 17, 15, 14], wx: ['cloudy', 'showers', 'rain', 'showers'], snow: [0, 0, 0, 0], sl: 3000 },
  auckland:           { rain: [1, 4, 9, 5],   mult: 1.4, dir: [30, 20, 10, 340], kt: [14, 18, 24, 22], t: [16, 17, 15, 13], wx: ['cloudy', 'showers', 'rain', 'showers'], snow: [0, 0, 0, 0], sl: 3000 },
  waikato:            { rain: [1, 3, 10, 6],  mult: 1.6, dir: [30, 20, 350, 320], kt: [10, 14, 18, 16], t: [15, 17, 14, 11], wx: ['cloudy', 'cloudy', 'rain', 'showers'], snow: [0, 0, 0, 0], sl: 3000 },
  bay_of_plenty:      { rain: [0, 1, 4, 6],   mult: 2.0, dir: [40, 30, 20, 350], kt: [10, 14, 18, 20], t: [17, 19, 16, 13], wx: ['partly_cloudy', 'cloudy', 'rain', 'rain'], snow: [0, 0, 0, 0], sl: 3000 },
  gisborne:           { rain: [0, 0, 2, 6],   mult: 2.2, dir: [330, 320, 330, 10], kt: [12, 16, 14, 18], t: [19, 22, 17, 13], wx: ['partly_cloudy', 'partly_cloudy', 'cloudy', 'rain'], snow: [0, 0, 0, 0], sl: 3000 },
  hawkes_bay:         { rain: [0, 0, 1, 5],   mult: 2.5, dir: [320, 310, 300, 170], kt: [16, 22, 20, 18], t: [20, 24, 18, 11], wx: ['clear', 'partly_cloudy', 'cloudy', 'rain'], snow: [0, 0, 0, 1], sl: [3000, 3000, 2200, 1100] },
  taranaki:           { rain: [3, 8, 14, 7],  mult: 2.4, dir: [330, 320, 300, 250], kt: [18, 24, 28, 24], t: [15, 16, 13, 11], wx: ['showers', 'rain', 'heavy_rain', 'showers'], snow: [0, 0, 0, 0], sl: 3000 },
  manawatu_whanganui: { rain: [2, 6, 14, 8],  mult: 2.6, dir: [330, 320, 300, 220], kt: [16, 22, 26, 22], t: [15, 17, 13, 10], wx: ['cloudy', 'rain', 'heavy_rain', 'showers'], snow: [0, 0, 1, 4], sl: [3000, 2600, 1900, 1200] },
  wellington:         { rain: [1, 4, 18, 8],  mult: 2.2, dir: [340, 340, 330, 190], kt: [24, 32, 40, 34], t: [14, 15, 12, 9], wx: ['cloudy', 'windy', 'heavy_rain', 'showers'], snow: [0, 0, 0, 1], sl: [3000, 3000, 1800, 900] },
  nelson:             { rain: [1, 4, 10, 3],  mult: 2.2, dir: [330, 320, 300, 240], kt: [8, 12, 16, 14], t: [15, 17, 13, 9], wx: ['cloudy', 'cloudy', 'rain', 'showers'], snow: [0, 0, 1, 3], sl: [3000, 2400, 1600, 1100] },
  tasman:             { rain: [4, 14, 26, 6], mult: 2.8, dir: [330, 320, 290, 240], kt: [10, 14, 18, 16], t: [14, 15, 12, 9], wx: ['rain', 'rain', 'heavy_rain', 'showers'], snow: [0, 1, 4, 4], sl: [2600, 2000, 1400, 1000] },
  marlborough:        { rain: [0, 1, 6, 6],   mult: 2.5, dir: [320, 310, 300, 180], kt: [14, 20, 22, 26], t: [18, 22, 15, 8], wx: ['partly_cloudy', 'windy', 'rain', 'rain'], snow: [0, 0, 1, 5], sl: [3000, 2400, 1500, 800] },
  west_coast:         { rain: [22, 48, 40, 6], mult: 2.8, dir: [330, 320, 300, 220], kt: [12, 18, 20, 16], t: [14, 15, 13, 9], wx: ['rain', 'heavy_rain', 'heavy_rain', 'showers'], snow: [0, 2, 6, 5], sl: [2200, 1800, 1300, 1000] },
  canterbury:         { rain: [0, 1, 3, 12],  mult: 5.0, dir: [320, 310, 300, 190], kt: [18, 28, 30, 26], t: [19, 25, 16, 6], wx: ['clear', 'windy', 'cloudy', 'rain'], snow: [0, 1, 3, 12], sl: [3000, 2300, 1500, 600] },
  otago:              { rain: [0, 1, 6, 10],  mult: 3.0, dir: [320, 300, 220, 190], kt: [14, 22, 24, 24], t: [17, 21, 11, 5], wx: ['clear', 'windy', 'rain', 'sleet'], snow: [0, 1, 6, 10], sl: [3000, 2200, 1000, 500] },
  southland:          { rain: [3, 8, 12, 8],  mult: 4.0, dir: [320, 290, 230, 200], kt: [16, 24, 28, 26], t: [14, 16, 9, 5], wx: ['showers', 'rain', 'showers', 'sleet'], snow: [0, 2, 8, 8], sl: [2400, 1800, 800, 400] },
};
const cityRegion = { whangarei: 'northland', auckland: 'auckland', hamilton: 'waikato', tauranga: 'bay_of_plenty', gisborne: 'gisborne', new_plymouth: 'taranaki', napier: 'hawkes_bay', whanganui: 'manawatu_whanganui', palmerston_north: 'manawatu_whanganui', wellington: 'wellington', nelson: 'nelson', blenheim: 'marlborough', kaikoura: 'marlborough', westport: 'west_coast', hokitika: 'west_coast', franz_josef: 'west_coast', christchurch: 'canterbury', timaru: 'canterbury', queenstown: 'otago', dunedin: 'otago', invercargill: 'southland', milford_sound: 'southland' };
const cityTweak = { kaikoura: [1, 0, -1, -1], franz_josef: [-1, -1, -2, -3], queenstown: [-2, -2, -3, -4], milford_sound: [-1, -1, -3, -4], timaru: [-1, 0, -2, -1], westport: [0, 0, -1, -1], hokitika: [0, 0, -1, -1], palmerston_north: [0, 0, 0, 0], whanganui: [1, 1, 0, 0], blenheim: [1, 2, 0, -1] };

const lowTrack = [[-42.5, 160.5, 992], [-43.5, 164.5, 988], [-45.0, 168.5, 986], [-46.5, 173.5, 988]];
const highTrack = [[-34.0, 183.0, 1026], [-34.5, 186.0, 1027], [-35.0, 189.0, 1027], [-36.0, 192.0, 1028]];
const high2 = [[-45.0, 148.0, 1022], [-44.0, 151.0, 1024], [-43.0, 154.0, 1026], [-42.0, 158.0, 1028]];
const fronts = [
  [{ kind: 'cold', points: [[-42.5, 160.5], [-45.0, 159.0], [-48.0, 157.0], [-51.0, 154.0]] }, { kind: 'warm', points: [[-42.5, 160.5], [-41.0, 164.0], [-40.0, 167.5]] }],
  [{ kind: 'cold', points: [[-43.5, 164.5], [-45.5, 164.0], [-48.0, 162.5], [-51.0, 160.0]] }, { kind: 'warm', points: [[-43.5, 164.5], [-42.0, 168.0], [-41.0, 171.0]] }],
  [{ kind: 'cold', points: [[-45.0, 168.5], [-44.0, 170.0], [-42.5, 171.0], [-40.5, 172.5], [-38.5, 173.5]] }, { kind: 'cold', points: [[-45.0, 168.5], [-47.5, 167.0], [-50.5, 164.0]] }],
  [{ kind: 'cold', points: [[-46.5, 173.5], [-43.0, 174.5], [-40.5, 175.5], [-37.5, 175.5], [-35.0, 174.0]] }, { kind: 'trough', points: [[-46.5, 173.5], [-49.0, 171.0], [-52.0, 168.0]] }],
];
const headlines = ['Nor\'wester builds, West Coast rain begins', 'Front slams the West Coast', 'Front crosses, Wellington gale', 'Southerly: snow to 500 m in Otago'];
const narratives = [
  'A deepening low in the Tasman Sea drives a strengthening northwesterly over the South Island. Rain sets in on the West Coast and Fiordland while Canterbury warms under the föhn arch.',
  'The warm conveyor pins against the Southern Alps: Westland ranges take 80–120 mm this window, with spillover into the Rakaia and Waitaki headwaters. Gale nor\'westers on the Canterbury Plains.',
  'The cold front crosses the South Island and reaches Wellington with a burst of heavy rain and severe northerly gales through Cook Strait. Snow level falls fast behind the front.',
  'A cold southerly surges up the east coast: snow to 400–600 m in Southland and Otago, 600 m in Canterbury with a 12 cm fall on Porters and Arthur\'s Pass. Rain reaches Hawke\'s Bay and Gisborne by dawn.',
];
const hotspots = [
  [{ name: 'Milford Sound', lat: -44.672, lon: 167.925, rain_mm: 45, snow_cm: 0 }, { name: 'Franz Josef', lat: -43.389, lon: 170.183, rain_mm: 30, snow_cm: 0 }],
  [{ name: 'Cropp River', lat: -43.05, lon: 170.95, rain_mm: 120, snow_cm: 0 }, { name: 'Milford Sound', lat: -44.672, lon: 167.925, rain_mm: 95, snow_cm: 0 }, { name: 'Arthur\'s Pass', lat: -42.942, lon: 171.563, rain_mm: 70, snow_cm: 0 }],
  [{ name: 'Cropp River', lat: -43.05, lon: 170.95, rain_mm: 95, snow_cm: 0 }, { name: 'Tararua Range', lat: -40.8, lon: 175.4, rain_mm: 48, snow_cm: 0 }, { name: 'Milford Rd', lat: -44.8, lon: 168.0, rain_mm: 0, snow_cm: 12 }],
  [{ name: 'Porters Pass', lat: -43.29, lon: 171.73, rain_mm: 0, snow_cm: 12 }, { name: 'Arthur\'s Pass', lat: -42.942, lon: 171.563, rain_mm: 0, snow_cm: 14 }, { name: 'Crown Range', lat: -44.96, lon: 168.95, rain_mm: 0, snow_cm: 15 }, { name: 'Dunedin hills', lat: -45.85, lon: 170.45, rain_mm: 0, snow_cm: 5 }, { name: 'Esk Valley', lat: -39.4, lon: 176.8, rain_mm: 24, snow_cm: 0 }],
];

const steps = labels.map((label, i) => ({
  index: i + 1,
  t_offset_h: (i + 1) * 6,
  label,
  headline: headlines[i],
  narrative: narratives[i],
  mslp: {
    background_hpa: 1012,
    gradient_hpa_per_deg_lat: 0.6,
    systems: [
      { kind: 'L', lat: lowTrack[i][0], lon: lowTrack[i][1], pressure_hpa: lowTrack[i][2], radius_km: 700, label: 'Tasman low' },
      { kind: 'H', lat: highTrack[i][0], lon: highTrack[i][1], pressure_hpa: highTrack[i][2], radius_km: 1300, label: 'Blocking high' },
      { kind: 'H', lat: high2[i][0], lon: high2[i][1], pressure_hpa: high2[i][2], radius_km: 1200, label: 'Following high' },
    ],
    fronts: fronts[i],
  },
  regions: REGION_IDS.map((id) => {
    const d = R[id];
    const sl = Array.isArray(d.sl) ? d.sl[i] : d.sl;
    return { region_id: id, rain_mm: d.rain[i], rain_max_mm: r(d.rain[i] * d.mult), snow_cm: d.snow[i], snow_level_m: sl, wind_dir_deg: d.dir[i], wind_mean_kt: d.kt[i], wind_gust_kt: Math.round(d.kt[i] * (id === 'canterbury' || id === 'wellington' ? 1.8 : 1.5)), temp_c: d.t[i], weather: d.wx[i] };
  }),
  cities: CITY_IDS.map((cid) => {
    const d = R[cityRegion[cid]]; const tw = cityTweak[cid]?.[i] || 0;
    return { city_id: cid, temp_c: d.t[i] + tw, wind_dir_deg: d.dir[i], wind_kt: cid === 'wellington' ? d.kt[i] + 6 : d.kt[i], weather: d.wx[i] };
  }),
  hotspots: hotspots[i],
  maps: ['mslp', 'rain6h', 'wind', 'snow', 'temp', 'accum'],
}));

const totals = REGION_IDS.map((id) => {
  const d = R[id]; const best = d.rain.reduce((a, b) => a + b, 0);
  const mean = r(best * (id === 'west_coast' ? 0.7 : id === 'canterbury' ? 1.3 : 0.95));
  return { region_id: id, model_mean_mm: mean, blended_low_mm: r(best * 0.75), blended_high_mm: r(best * 1.3), best_estimate_mm: best, ranges_max_mm: r(best * d.mult), note: id === 'west_coast' ? 'Global totals scaled ×1.4 for the ranges; MetService WRF closest.' : id === 'canterbury' ? 'Global spillover trimmed on the plains; headwaters keep NW rain then the southerly adds 10–15 mm.' : '' };
});

const forecast = {
  meta: { title: 'Tasman low, then a snowy southerly', subtitle: 'Valid Thu 6 am – Fri 6 am NZDT · ECMWF / UKMO / GFS / MetService WRF blend', period_hours: 24, start_local: 'Thu 2 Oct 2026 06:00 NZDT', model_runs_used: 'ECMWF 00Z Thu · UKMO 00Z Thu · GFS 06Z Thu · WRF 00Z Thu' },
  assessment: {
    pattern_type: 'Tasman low → cold front → southerly change',
    pattern_summary: 'A 988 hPa low tracks southeast across the southern Tasman Sea and passes south of Stewart Island overnight. Its warm conveyor delivers 12–18 hours of heavy northwest rain to Westland and Fiordland before the cold front crosses the South Island late Thursday afternoon. Behind it a vigorous southerly surges up the east coast with a sharp snow-level drop, reaching the lower North Island after midnight.',
    confidence: 'high',
    model_weights: [{ model: 'ECMWF', weight: 0.35, reasoning: 'Consistent track for three runs; best frontal timing.' }, { model: 'MetService WRF', weight: 0.25, reasoning: 'Resolves Alps; drives West Coast peak totals.' }, { model: 'UKMO', weight: 0.2, reasoning: 'Agrees with ECMWF on the southerly timing.' }, { model: 'GFS', weight: 0.2, reasoning: '3 h faster and colder; used for the cold tail.' }],
    key_messages: ['Westland ranges 150–200 mm, Cropp River up to 250 mm by midnight Thursday', 'Severe gale nor\'westers on the Canterbury Plains Thursday afternoon, gusts 110–130 km/h', 'Wellington: heavy rain and severe northerly gale 6 pm – midnight, Cook Strait gusts 130 km/h', 'Snow to 500 m in Otago and Southland overnight, 10–15 cm on Crown Range, Lindis and Porters Pass', 'Hawke\'s Bay and Gisborne turn wet from dawn Friday as the southerly reaches the coast'],
    uncertainties: ['GFS is 3 h faster with the front: if right, Wellington\'s heaviest rain is 3–6 pm rather than 6 pm – midnight.', 'Snow level in Canterbury depends on the depth of the cold pool; 400 m possible on the plains edge if GFS\'s colder 850 hPa verifies.'],
    official_note: 'Model-based guidance only. MetService is the official warning authority – check current Orange/Red heavy rain, snow and strong wind warnings before publishing.',
  },
  rain_totals: totals,
  snow_summary: { headline: 'Significant snow for the inland South Island passes from Thursday evening', items: [{ location: 'Crown Range / Lindis Pass', region_id: 'otago', snow_cm_low: 10, snow_cm_high: 20, snow_level_min_m: 500, timing: 'Thu evening – Fri morning', note: 'Road closures likely overnight.' }, { location: 'Porters / Arthur\'s Pass', region_id: 'canterbury', snow_cm_low: 10, snow_cm_high: 18, snow_level_min_m: 600, timing: 'after midnight Thu', note: 'SH73 chains or closure.' }, { location: 'Milford Road', region_id: 'southland', snow_cm_low: 15, snow_cm_high: 30, snow_level_min_m: 400, timing: 'Thu evening onward', note: 'Avalanche programme likely.' }, { location: 'Desert Road / Remutaka Hill', region_id: 'manawatu_whanganui', snow_cm_low: 2, snow_cm_high: 6, snow_level_min_m: 900, timing: 'Fri dawn', note: 'Brief, lighter falls in the North Island.' }] },
  steps,
};

const problems = validateForecast(forecast);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
fs.writeFileSync(new URL('../public/data/demo_forecast.json', import.meta.url), JSON.stringify(forecast));
console.log('demo forecast OK:', forecast.steps.length, 'steps,', JSON.stringify(forecast).length, 'bytes');
