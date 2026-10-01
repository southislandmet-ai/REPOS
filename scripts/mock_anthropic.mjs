// A tiny stand-in for the Anthropic Messages API used by `npm run smoke`.
// It streams: turn 1 → ask_user tool call, turn 2 → emit_forecast (the demo package), turn 3 → closing text.
// Start with: node scripts/mock_anthropic.mjs   then run the app with ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=test
import http from 'node:http';
import fs from 'node:fs';

const demo = JSON.parse(fs.readFileSync(new URL('../public/data/demo_forecast.json', import.meta.url), 'utf8'));
const PORT = Number(process.env.MOCK_PORT || 4010);

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  res.end();
}
function textTurn(id, text, stop = 'end_turn') {
  return [
    ['message_start', { message: { id, type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
    ...text.match(/.{1,20}/gs).map((t) => ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: t } }]),
    ['content_block_stop', { index: 0 }],
    ['message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', {}],
  ];
}
function toolTurn(id, name, input, preText) {
  const json = JSON.stringify(input);
  const chunks = json.match(/.{1,4000}/gs);
  return [
    ['message_start', { message: { id, type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
    ['content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'Studying the frames: a Tasman low with a trailing cold front…' } }],
    ['content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig' } }],
    ['content_block_stop', { index: 0 }],
    ['content_block_start', { index: 1, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { index: 1, delta: { type: 'text_delta', text: preText } }],
    ['content_block_stop', { index: 1 }],
    ['content_block_start', { index: 2, content_block: { type: 'tool_use', id: `toolu_${id}`, name, input: {} } }],
    ...chunks.map((c) => ['content_block_delta', { index: 2, delta: { type: 'input_json_delta', partial_json: c } }]),
    ['content_block_stop', { index: 2 }],
    ['message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 500 } }],
    ['message_stop', {}],
  ];
}
const askInput = {
  intro: 'I can see a deepening Tasman low with a trailing cold front in your ECMWF loop, and your tables point to a West Coast focus with a southerly snow event behind. Before I draw, a few choices:',
  questions: [
    { id: 'maps', prompt: 'Which maps do you want for every 6-hour step?', type: 'multi', allow_other: true, options: [
      { value: 'mslp', label: 'MSLP & fronts', description: 'Isobars, highs/lows, fronts', recommended: true },
      { value: 'rain6h', label: '6-hour rainfall', description: 'Regional shading + hotspots', recommended: true },
      { value: 'wind', label: 'Wind & gusts', description: 'Barbs and gust labels', recommended: true },
      { value: 'snow', label: 'Snow & snow level', description: 'Fresh snow and snow level', recommended: true },
      { value: 'temp', label: 'Temperature', description: '', recommended: false },
      { value: 'accum', label: 'Running rainfall total', description: '', recommended: false } ] },
    { id: 'extras', prompt: 'Any extra hotspots or passes you want named on the maps?', type: 'text', allow_other: true, options: [] },
  ],
};

// Synthetic 0.5° lattice for the mock extractor (28×28, lat -34..-47.5, lon 165.5..179): NW-flow precipitation
// maximum on the West Coast decaying east, with a lead-dependent front position; temp decreasing south; wind NW.
function synthLattice(layer, lead, modelId) {
  const vals = [], sec = []; const bias = modelId === 'gfs' ? 0.8 : modelId === 'ukmo' ? 0.95 : 1.0;
  for (let j = 0; j < 28; j++) for (let i = 0; i < 28; i++) {
    const lat = -34 - j * 0.5, lon = 165.5 + i * 0.5;
    const alpsDist = (lon - (170.2 + (lat + 43.5) * -0.9)) ; // distance east of the Alps axis (deg)
    const frontLon = 166 + lead / 6 * 1.3;
    const si = lat < -40.4 && lon > 166 && lon < 174.5 && lat > -47.5;
    let v = 0;
    if (layer === 'precip_6h' || layer === 'precip_24h') {
      const west = Math.max(0, 1 - Math.abs(alpsDist + 0.4) / 1.2);
      const near = Math.exp(-Math.pow((lon - frontLon) / 1.8, 2));
      v = si ? (4 + 40 * west * near + 6 * near) * bias * (layer === 'precip_24h' ? 3 : 1) : Math.max(0, 3 * near);
      if (alpsDist > 0.6) v *= 0.25;
      sec.push(v > 0.5 && lat < -43 && alpsDist < 0 && lead > 12 ? 2 : v > 0.5 ? 1 : 0);
    } else if (layer === 'temp_2m') { v = 22 + (lat + 34) * 0.9 - (alpsDist > 0 ? 0 : 3) - lead * 0.15 + (modelId === 'gfs' ? -0.8 : 0); }
    else if (layer === 'mslp') { v = 1012 - 14 * Math.exp(-(Math.pow(lat + 46 + lead / 8, 2) + Math.pow((lon - 163 - lead / 3) * 0.6, 2)) / 12) + 0.5 * (lat + 42); }
    else if (layer === 'wind_10m') { v = 15 + 12 * Math.exp(-Math.pow((lon - frontLon) / 2.5, 2)) + (si ? -4 : 0); sec.push(300 - lead * 1.5); }
    else v = 50;
    vals.push(Math.round(v * 10) / 10);
  }
  const secondary_kind = layer === 'precip_6h' ? 'ptype_code' : layer === 'wind_10m' ? 'wind_dir_deg' : 'none';
  return { vals, sec: secondary_kind === 'none' ? [] : sec, secondary_kind };
}
function extractTurn(id, payload) {
  const user = payload.messages[0].content.find((b) => b.type === 'text')?.text || '';
  const name = (user.match(/File name: "([^"]+)"/) || [])[1] || 'chart.png';
  const modelName = (user.match(/forecaster\): ([^.]+)\./) || [])[1] || 'GFS';
  const modelId = /ECMWF/i.test(modelName) ? 'ecmwf' : /UKMO/i.test(modelName) ? 'ukmo' : 'gfs';
  const layer = (user.match(/layer_id (\w+)/) || [])[1] || (/temp/i.test(name) ? 'temp_2m' : /mslp|synop/i.test(name) ? 'mslp' : /wind/i.test(name) ? 'wind_10m' : 'precip_6h');
  const lead = Number((name.match(/(\d{2,3})/) || [0, 6])[1]);
  const run = '2026-10-01T00:00Z'; const valid = new Date(Date.parse(run) + lead * 3600e3).toISOString().slice(0, 16) + 'Z';
  const { vals, sec, secondary_kind } = synthLattice(layer, lead, modelId);
  const unitsOf = { precip_6h: 'mm', precip_24h: 'mm', temp_2m: '°C', mslp: 'hPa', wind_10m: 'kt' };
  const input = {
    chart: { layer_id: layer, layer_label: layer === 'precip_6h' ? '6-Hour Precip & ptype' : layer, units: unitsOf[layer] || '', model_detected: modelName, source_detected: 'mock', run_time_utc: run, valid_time_utc: /nodate/.test(name) ? '' : valid, valid_time_text: `Valid ${valid}`, lead_hours: lead, accumulation_hours: layer === 'precip_6h' ? 6 : layer === 'precip_24h' ? 24 : 0, time_confidence: 0.9, domain_covers_nz: true, legend_summary: 'synthetic' },
    values: vals, secondary_kind, secondary_values: sec,
    features: { systems: layer === 'mslp' ? [{ kind: 'L', lat: -46 - lead / 8, lon: 163 + lead / 3, pressure_hpa: 998, label: 'Tasman low' }] : [], fronts: [] },
    extremes: [{ name: 'Cropp River', lat: -43.05, lon: 170.95, value: Math.max(...vals) }],
    quality: { readability: 0.85, notes: 'mock extraction' },
  };
  return toolTurn(id, 'extract_chart', input, '');
}
const planInput = {
  regime: { name: 'Tasman low → NW flow → southerly change', summary: 'A deepening Tasman low drives a moist northwesterly onto the Alps before a front crosses and a cooler southwesterly follows. Classic West Coast rain, lee föhn, then east-coast showers.' },
  flow: { direction_deg: 300, speed_ms: 16, varies_in_time: true },
  physics: { lapse_rate_c_per_km: 5.5, upslope_gain: 1.9, elevation_gain_per_km: 0.4, advection_s: 800 },
  weights: [{ model_id: 'gfs', family: 'precip', subregion: 'canterbury_plains', weight_multiplier: 0.7, bias: 1.4, reason: 'GFS over-spills NW rain onto the plains in this regime.' }, { model_id: 'ecmwf', family: 'precip', subregion: 'west_coast_ranges', weight_multiplier: 1.2, bias: 0.6, reason: 'Consistent run-to-run; scale ranges up.' }],
  confidence: { overall: 'medium', narrative: 'Two to three global models agree on the pattern; the West Coast maximum is robust but its magnitude is under-done by all globals. No NZ convection-permitting model is in the suite, so fine detail is terrain-redistributed guidance.', missing_data: ['MetService WRF or NZCSM 6-h precip', '10 m wind to drive the orographic enhancement'] },
  model_notes: [{ model_id: 'gfs', note: '3 h fast with the front.' }],
};

http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end('not found'); }
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    let payload = {}; try { payload = JSON.parse(body); } catch {}
    const msgs = payload.messages || [];
    const last = msgs[msgs.length - 1];
    const lastBlocks = Array.isArray(last?.content) ? last.content : [{ type: 'text', text: String(last?.content || '') }];
    const toolResult = lastBlocks.find((b) => b.type === 'tool_result');
    const hasForecast = msgs.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use' && b.name === 'emit_forecast'));
    const id = `msg_${Date.now()}`;
    console.log(`[mock] turn: ${msgs.length} messages, tool_result=${Boolean(toolResult)}, hasForecast=${hasForecast}, images=${lastBlocks.filter((b) => b.type === 'image').length}`);
    if (!payload.stream) { res.writeHead(400); return res.end('mock expects stream=true'); }
    const toolNames = (payload.tools || []).map((t) => t.name);
    if (toolNames.includes('extract_chart')) return sse(res, extractTurn(id, payload));
    if (toolNames.includes('emit_blend_plan')) return sse(res, toolTurn(id, 'emit_blend_plan', planInput, 'Reviewing the suite.'));
    if (toolResult && hasForecast) return sse(res, textTurn(id, 'Package delivered: a 988 hPa Tasman low drives 12–18 h of heavy northwest rain into Westland (ranges 150–200 mm) before the front crosses late Thursday; a cold southerly follows with snow to 500 m in Otago. Main uncertainty: GFS is 3 h faster. Outlier: GFS track.'));
    if (toolResult) return sse(res, toolTurn(id, 'emit_forecast', demo, 'Thanks – drawing the package now.'));
    return sse(res, toolTurn(id, 'ask_user', askInput, 'Analysing your inputs and imagery…'));
  });
}).listen(PORT, () => console.log(`mock Anthropic API on http://localhost:${PORT}`));
