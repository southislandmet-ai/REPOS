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
    if (toolResult && hasForecast) return sse(res, textTurn(id, 'Package delivered: a 988 hPa Tasman low drives 12–18 h of heavy northwest rain into Westland (ranges 150–200 mm) before the front crosses late Thursday; a cold southerly follows with snow to 500 m in Otago. Main uncertainty: GFS is 3 h faster. Outlier: GFS track.'));
    if (toolResult) return sse(res, toolTurn(id, 'emit_forecast', demo, 'Thanks – drawing the package now.'));
    return sse(res, toolTurn(id, 'ask_user', askInput, 'Analysing your inputs and imagery…'));
  });
}).listen(PORT, () => console.log(`mock Anthropic API on http://localhost:${PORT}`));
