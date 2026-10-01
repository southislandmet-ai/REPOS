import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, formatInputs } from './prompt.js';
import { TOOLS, validateForecast, validateAsk } from './tools.js';
import { createSession, getSession, save, deleteSession, listSessions } from './sessions.js';
import { LAYERS, MODELS, LATTICE, extractTool, checkExtract, toCanonical, catalogue, getSet, addSet, updateSet, deleteSet, deleteChart, clearSuite, EXTRACT_SYSTEM, selfSort, planTool, checkPlan, PLAN_SYSTEM, getSuite, setPlan } from './suite.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.FORECASTER_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.FORECASTER_EFFORT || 'high';
const MAX_TOKENS = Number(process.env.FORECASTER_MAX_TOKENS || 100000);
const MAX_ITERATIONS = 4; // emit → validate-error → emit → closing text

const app = express();
app.use(express.json({ limit: '80mb' }));
app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'] }));

const clients = new Map();
/** Per-request client: the browser may supply its own key (saved in its localStorage) via x-anthropic-key; else env credentials. */
function getClient(req) {
  const key = (req?.get?.('x-anthropic-key') || '').trim();
  const k = key || '__env__';
  if (!clients.has(k)) clients.set(k, key ? new Anthropic({ apiKey: key }) : new Anthropic());
  return clients.get(k);
}
function hasCredentials(req) { return Boolean((req?.get?.('x-anthropic-key') || '').trim() || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN); }

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL, effort: EFFORT, has_credentials: hasCredentials(req), env_credentials: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

// ───────────────────────── SIMODEL suite ─────────────────────────
app.get('/api/suite/meta', (_req, res) => res.json({ layers: LAYERS, models: MODELS, lattice: LATTICE }));
app.get('/api/suite', (_req, res) => res.json(catalogue()));
app.get('/api/suite/set/:id', (req, res) => { const s = getSet(req.params.id); if (!s) return res.status(404).json({ error: 'not found' }); res.json(s); });
app.put('/api/suite/set/:id', (req, res) => { const s = updateSet(req.params.id, req.body || {}); if (!s) return res.status(404).json({ error: 'not found' }); res.json(s); });
app.delete('/api/suite/set/:id', (req, res) => res.json({ ok: deleteSet(req.params.id) }));
app.delete('/api/suite/set/:id/chart/:cid', (req, res) => res.json({ ok: deleteChart(req.params.id, req.params.cid) }));
app.delete('/api/suite', (_req, res) => { clearSuite(); res.json({ ok: true }); });
app.get('/api/suite/fields', (req, res) => {
  // Full numeric payload for the viewer (all sets with values).
  const ids = (req.query.sets || '').split(',').filter(Boolean);
  const all = catalogue().sets.map((s) => getSet(s.id)).filter((s) => !ids.length || ids.includes(s.id));
  res.json({ layers: LAYERS, models: MODELS, lattice: LATTICE, sets: all, plan: getSuite().plan || null });
});

/** Analyse a batch of same-type chart images from one model with Claude vision; streams progress; stores a set. */
app.post('/api/suite/analyze', async (req, res) => {
  const { model_id = 'other', declared_layer = '', notes = '', images = [], set_id = null } = req.body || {};
  if (!images.length) return res.status(400).json({ error: 'No images.' });
  if (!hasCredentials(req)) return res.status(401).json({ error: 'No API key. Open Settings and paste your Anthropic API key.' });
  const send = sse(res);
  let aborted = false; res.on('close', () => { if (!res.writableFinished) aborted = true; });
  const anthropic = getClient(req);
  const model = MODELS.find((m) => m.id === model_id) || MODELS[MODELS.length - 1];
  const nowIso = new Date().toISOString();
  const results = new Array(images.length).fill(null);
  let done = 0;

  async function analyzeOne(i) {
    const img = images[i];
    const userText = `Model (as selected by the forecaster): ${model.name}. ${declared_layer ? `The forecaster says this set of ${images.length} charts is "${LAYERS.find((l) => l.id === declared_layer)?.label || declared_layer}" (layer_id ${declared_layer}); confirm or correct.` : `This is one of ${images.length} charts of the same type.`} File name: "${img.name}" (file names often contain the forecast hour, e.g. _036 or f36). Today's date (UTC): ${nowIso}. ${notes ? `Forecaster notes: ${notes}` : ''}
Other files in this batch: ${images.map((x) => x.name).join(', ')}.`;
    const messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } }, { type: 'text', text: userText }] }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const stream = anthropic.beta.messages.stream({
        model: MODEL, max_tokens: 24000,
        system: [{ type: 'text', text: EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [extractTool], thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, messages,
      });
      let chars = 0;
      for await (const ev of stream) {
        if (aborted) { stream.controller.abort(); return; }
        if (ev.type === 'content_block_delta' && ev.delta.type === 'input_json_delta') { chars += ev.delta.partial_json.length; if (chars % 2000 < 40) send('progress', { index: i, name: img.name, chars }); }
      }
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') { results[i] = { error: 'declined by the model' }; return; }
      const tu = msg.content.find((b) => b.type === 'tool_use' && b.name === 'extract_chart');
      if (!tu) { results[i] = { error: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 300) || 'no extraction returned' }; return; }
      const problems = checkExtract(tu.input);
      if (problems.length && attempt === 0) {
        messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Fix and call extract_chart again: ${problems.join('; ')}` }] });
        continue;
      }
      const x = tu.input;
      results[i] = {
        id: `${Date.now().toString(36)}${i}`,
        name: img.name, thumb: img.thumb || null,
        layer_id: x.chart.layer_id, layer_label: x.chart.layer_label, units_original: x.chart.units,
        model_detected: x.chart.model_detected, source_detected: x.chart.source_detected,
        run_time_utc: x.chart.run_time_utc, valid_time_utc: x.chart.valid_time_utc, valid_time_text: x.chart.valid_time_text,
        lead_hours: x.chart.lead_hours, accumulation_hours: x.chart.accumulation_hours, time_confidence: x.chart.time_confidence,
        domain_covers_nz: x.chart.domain_covers_nz, legend_summary: x.chart.legend_summary,
        values: toCanonical(x.chart.layer_id, x.chart.units, x.values),
        secondary_kind: x.secondary_kind, secondary_values: x.secondary_kind === 'none' ? [] : x.secondary_values,
        features: x.features, extremes: x.extremes, quality: x.quality, problems,
      };
      return;
    }
  }

  try {
    const queue = images.map((_, i) => i); const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length && !aborted) { const i = queue.shift(); try { await analyzeOne(i); } catch (e) { results[i] = { error: e?.message || String(e) }; } done++; send('chart', { index: i, done, total: images.length, result: results[i] && !results[i].error ? { ...results[i], values: undefined, secondary_values: undefined } : results[i] }); }
    });
    await Promise.all(workers);
    if (aborted) return;
    const good = results.filter((r) => r && !r.error);
    if (!good.length) { send('error', { text: 'No chart could be read.' }); return; }
    // Order: by valid time (unknown times last, keeping upload order), then infer missing times from neighbours at 6-h spacing when possible.
    good.forEach((c, i) => (c.upload_index = results.indexOf(c)));
    const sorted = selfSort(good);
    const t = (c) => (c.valid_time_utc ? Date.parse(c.valid_time_utc) : NaN);
    good.sort((a, b) => { const ta = t(a), tb = t(b); if (Number.isNaN(ta) && Number.isNaN(tb)) return a.upload_index - b.upload_index; if (Number.isNaN(ta)) return 1; if (Number.isNaN(tb)) return -1; return ta - tb; });
    good.forEach((c, i) => (c.order = i));
    const layerCounts = {}; for (const c of good) layerCounts[c.layer_id] = (layerCounts[c.layer_id] || 0) + 1;
    const layer_id = declared_layer && LAYERS.some((l) => l.id === declared_layer) ? declared_layer : Object.entries(layerCounts).sort((a, b) => b[1] - a[1])[0][0];
    const mixed = Object.keys(layerCounts).length > 1;
    const runs = [...new Set(good.map((c) => c.run_time_utc).filter(Boolean))];
    const set = {
      model_id: model.id, model_name: model.name, layer_id, layer_label: LAYERS.find((l) => l.id === layer_id)?.label || layer_id,
      run_time_utc: runs[0] || '', runs_detected: runs, notes, mixed_layers: mixed, layer_counts: layerCounts,
      charts: good, failures: results.filter((r) => r && r.error).map((r) => r.error), sort_warnings: sorted.warnings, time_step_h: sorted.step,
    };
    if (!set.run_time_utc && sorted.run) set.run_time_utc = sorted.run;
    const saved = set_id ? updateSet(set_id, set) || addSet(set) : addSet(set);
    const { charts, ...meta } = saved;
    send('set', { set: { ...meta, charts: charts.map(({ values, secondary_values, ...c }) => c) } });
    send('done', {});
  } catch (err) {
    console.error(err);
    let msg = err?.message || String(err);
    if (err instanceof Anthropic.AuthenticationError) msg = 'Authentication failed: check the API key in Settings.';
    send('error', { text: msg });
  } finally { res.end(); }
});

app.get('/api/sessions', (_req, res) => res.json(listSessions()));
app.post('/api/session', (_req, res) => res.json({ id: createSession().id }));
app.get('/api/session/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json({ id: s.id, created_at: s.created_at, transcript: s.transcript, forecast: s.forecast, pending_tool_use_id: s.pending_tool_use_id, usage: s.usage });
});
app.delete('/api/session/:id', (req, res) => { deleteSession(req.params.id); res.json({ ok: true }); });

/** SSE helper. */
function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

function buildUserContent({ text, inputs, inputsChanged, images }) {
  const content = [];
  if (inputsChanged && inputs) content.push({ type: 'text', text: formatInputs(inputs) });
  for (const img of images || []) {
    const n = img.frames?.length || 0;
    content.push({
      type: 'text',
      text: `Uploaded imagery "${img.name}" — forecaster's description: ${img.description || '(none given)'}` +
        (n > 1 ? ` (animated: ${n} frames sampled in time order, oldest first${img.total_frames ? ` from ${img.total_frames}` : ''})` : ''),
    });
    for (const f of img.frames || []) {
      content.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
    }
  }
  content.push({ type: 'text', text: text && text.trim() ? text.trim() : '(no message — please proceed with the data above)' });
  return content;
}

/** AI review of the whole suite → blend plan stored in the suite. */
app.post('/api/suite/plan', async (req, res) => {
  if (!hasCredentials(req)) return res.status(401).json({ error: 'No API key. Open Settings and paste your Anthropic API key.' });
  const { notes = '' } = req.body || {};
  const suite = getSuite();
  if (!suite.sets.length) return res.status(400).json({ error: 'Upload some charts first.' });
  const skill = JSON.parse(fs.readFileSync(path.join(here, '..', 'public', 'data', 'simodel_skill.json'), 'utf8'));
  const summary = suite.sets.map((s) => ({ set_id: s.id, model_id: s.model_id, model: s.model_name, layer: s.layer_label, layer_id: s.layer_id, run: s.run_time_utc, step_h: s.time_step_h, charts: s.charts.map((c) => ({ name: c.name, valid: c.valid_time_utc, lead_h: c.lead_hours, accum_h: c.accumulation_hours, readability: c.quality?.readability, time_conf: c.time_confidence, systems: c.features?.systems?.slice(0, 4), fronts: c.features?.fronts?.map((f) => f.kind), extremes: c.extremes?.slice(0, 4), notes: c.quality?.notes })) }));
  const user = `Current time (UTC): ${new Date().toISOString()}\nForecaster notes: ${notes || '(none)'}\n\n<suite>\n${JSON.stringify(summary)}\n</suite>\n\n<static_skill_matrix>\n${JSON.stringify({ subregions: skill.subregions.map((r) => ({ id: r.id, name: r.name })), models: skill.models })}\n</static_skill_matrix>`;
  try {
    const anthropic = getClient(req);
    const messages = [{ role: 'user', content: user }];
    let plan = null, text = '';
    for (let attempt = 0; attempt < 2 && !plan; attempt++) {
      const msg = await anthropic.beta.messages.stream({ model: MODEL, max_tokens: 16000, system: [{ type: 'text', text: PLAN_SYSTEM, cache_control: { type: 'ephemeral' } }], tools: [planTool], thinking: { type: 'adaptive' }, output_config: { effort: EFFORT }, messages }).finalMessage();
      if (msg.stop_reason === 'refusal') return res.status(400).json({ error: 'The model declined this request.' });
      text += msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const tu = msg.content.find((b) => b.type === 'tool_use' && b.name === 'emit_blend_plan');
      if (!tu) break;
      const problems = checkPlan(tu.input);
      if (problems.length && attempt === 0) { messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Fix: ${problems.join('; ')}` }] }); continue; }
      plan = tu.input;
    }
    if (!plan) return res.status(500).json({ error: text || 'No plan produced.' });
    plan.created_at = new Date().toISOString(); plan.notes = notes;
    setPlan(plan);
    res.json({ plan, text });
  } catch (err) {
    console.error(err); res.status(500).json({ error: err instanceof Anthropic.AuthenticationError ? 'Authentication failed: check the API key in Settings.' : (err?.message || String(err)) });
  }
});

app.post('/api/chat', async (req, res) => {
  const { session_id, text = '', inputs = null, inputs_hash = null, images = [], tool_result = null } = req.body || {};
  const session = getSession(session_id || '');
  if (!session) return res.status(404).json({ error: 'Unknown session. Reload the page.' });
  if (!hasCredentials(req)) return res.status(401).json({ error: 'No API key. Open Settings and paste your Anthropic API key.' });
  const send = sse(res);
  let aborted = false;
  // Note: req 'close' fires once the body is consumed in modern Node; use the response to detect a dropped client.
  res.on('close', () => { if (!res.writableFinished) aborted = true; });

  try {
    const inputsChanged = Boolean(inputs) && inputs_hash !== session.last_inputs_hash;

    // ---- Append the user's turn ----
    if (session.pending_tool_use_id) {
      // Answering an ask_user question (or free text while a question is pending → treat as the answer).
      const answer = tool_result?.content ?? text;
      const blocks = [{ type: 'tool_result', tool_use_id: session.pending_tool_use_id, content: typeof answer === 'string' ? answer : JSON.stringify(answer) }];
      const extra = buildUserContent({ text: tool_result ? text : '', inputs, inputsChanged, images }).filter((b) => b.type !== 'text' || b.text !== '(no message — please proceed with the data above)');
      session.messages.push({ role: 'user', content: [...blocks, ...extra] });
      session.transcript.push({ role: 'user', kind: 'answer', text: typeof answer === 'string' ? answer : JSON.stringify(answer, null, 1), extra_text: text || '', ts: Date.now() });
      session.pending_tool_use_id = null;
    } else {
      session.messages.push({ role: 'user', content: buildUserContent({ text, inputs, inputsChanged, images }) });
      session.transcript.push({ role: 'user', kind: 'text', text, images: (images || []).map((i) => ({ name: i.name, description: i.description, thumb: i.frames?.[0] ? `data:${i.frames[0].media_type};base64,${i.frames[0].data}` : null })), inputs_changed: inputsChanged, ts: Date.now() });
    }
    if (inputsChanged) session.last_inputs_hash = inputs_hash;
    save(session);

    const anthropic = getClient(req);
    let useFallbacks = true;
    let forecastRetries = 0;

    for (let iteration = 0; iteration < MAX_ITERATIONS && !aborted; iteration++) {
      const params = {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: EFFORT },
        messages: session.messages,
      };
      if (useFallbacks) {
        params.betas = ['server-side-fallback-2026-07-01'];
        params.fallbacks = 'default';
      }

      let stream;
      try {
        stream = anthropic.beta.messages.stream(params);
      } catch (e) { throw e; }

      let currentTool = null; // {id, name, json}
      let textBuf = '';
      let finalMessage;
      try {
        for await (const event of stream) {
          if (aborted) { stream.controller.abort(); break; }
          switch (event.type) {
            case 'content_block_start':
              if (event.content_block.type === 'tool_use') {
                currentTool = { id: event.content_block.id, name: event.content_block.name, json: '' };
                send('tool_start', { name: currentTool.name });
              } else if (event.content_block.type === 'thinking') {
                send('thinking_start', {});
              }
              break;
            case 'content_block_delta':
              if (event.delta.type === 'text_delta') { textBuf += event.delta.text; send('text', { text: event.delta.text }); }
              else if (event.delta.type === 'thinking_delta') send('thinking', { text: event.delta.thinking });
              else if (event.delta.type === 'input_json_delta' && currentTool) {
                currentTool.json += event.delta.partial_json;
                // Lightweight progress: count completed steps so the UI can show "drawing step 5 of 8".
                if (currentTool.name === 'emit_forecast') {
                  const m = currentTool.json.match(/"t_offset_h"\s*:\s*\d+/g);
                  send('tool_progress', { name: currentTool.name, chars: currentTool.json.length, steps_seen: m ? m.length : 0 });
                }
              }
              break;
            case 'content_block_stop':
              if (currentTool) currentTool = null;
              break;
            default:
              break;
          }
        }
        if (aborted) break;
        finalMessage = await stream.finalMessage();
      } catch (err) {
        if (useFallbacks && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
          // Org/platform doesn't accept server-side fallbacks: retry the same turn without them.
          useFallbacks = false;
          iteration--;
          send('notice', { text: 'Server-side fallback not available for this account; continuing without it.' });
          continue;
        }
        throw err;
      }

      // Track usage.
      const u = finalMessage.usage || {};
      for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
        session.usage[k] = (session.usage[k] || 0) + (u[k] || 0);
      }
      const fallbackRan = (u.iterations || []).some((it) => it.type === 'fallback_message');
      if (fallbackRan) send('notice', { text: `Served by ${finalMessage.model} after a fallback.` });

      // Preserve the full assistant content (thinking blocks included) for the next turn.
      session.messages.push({ role: 'assistant', content: finalMessage.content });
      if (textBuf.trim()) session.transcript.push({ role: 'assistant', kind: 'text', text: textBuf, ts: Date.now() });

      if (finalMessage.stop_reason === 'refusal') {
        const d = finalMessage.stop_details;
        send('error', { text: `The model declined this request${d?.category ? ` (${d.category})` : ''}. ${d?.explanation || ''}`.trim() });
        break;
      }
      if (finalMessage.stop_reason === 'max_tokens') {
        session.transcript.push({ role: 'system', kind: 'notice', text: 'Output limit reached before the package was complete. Try a shorter period or fewer map types.', ts: Date.now() });
        send('error', { text: 'The response hit the output limit before the forecast package was complete. Ask again with a shorter period (24 h / 48 h) or fewer map types per step.' });
        break;
      }
      if (finalMessage.stop_reason !== 'tool_use') { send('done', { stop_reason: finalMessage.stop_reason, usage: session.usage }); break; }

      const toolUses = finalMessage.content.filter((b) => b.type === 'tool_use');
      const results = [];
      let stopForUser = false;
      for (const tu of toolUses) {
        if (tu.name === 'ask_user') {
          const problems = validateAsk(tu.input);
          if (problems.length) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `ask_user input invalid: ${problems.join('; ')}` });
            continue;
          }
          session.pending_tool_use_id = tu.id;
          session.transcript.push({ role: 'assistant', kind: 'question', question: tu.input, ts: Date.now() });
          send('question', { tool_use_id: tu.id, question: tu.input });
          stopForUser = true;
        } else if (tu.name === 'emit_forecast') {
          const problems = validateForecast(tu.input);
          if (problems.length && forecastRetries < 2) {
            forecastRetries++;
            send('notice', { text: `Package failed ${problems.length} consistency check(s); asking the model to fix them…`, problems });
            results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `The forecast package failed validation. Fix ALL of the following and re-emit the complete package:\n- ${problems.join('\n- ')}` });
          } else {
            session.forecast = tu.input;
            session.transcript.push({ role: 'assistant', kind: 'forecast', title: tu.input.meta.title, steps: tu.input.steps.length, ts: Date.now(), warnings: problems });
            send('forecast', { forecast: tu.input, warnings: problems });
            const n = tu.input.steps.reduce((a, s) => a + s.maps.length, 0);
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Rendered ${n} charts across ${tu.input.steps.length} steps.${problems.length ? ` Accepted with warnings: ${problems.join('; ')}` : ''} Now give the closing summary.` });
          }
        } else {
          results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` });
        }
      }
      save(session);
      if (stopForUser) { send('done', { stop_reason: 'awaiting_user', usage: session.usage }); break; }
      session.messages.push({ role: 'user', content: results });
      save(session);
    }
  } catch (err) {
    console.error(err);
    let msg = err?.message || String(err);
    if (err instanceof Anthropic.AuthenticationError) msg = 'Authentication failed: set ANTHROPIC_API_KEY (see .env.example) and restart the server.';
    else if (err instanceof Anthropic.RateLimitError) msg = 'Rate limited by the API. Wait a moment and try again.';
    else if (err instanceof Anthropic.APIConnectionError) msg = 'Could not reach the Anthropic API (network).';
    send('error', { text: msg });
    // Keep the transcript consistent: drop a dangling user turn so the next request is valid.
    const last = session.messages[session.messages.length - 1];
    if (last && last.role === 'user' && !session.pending_tool_use_id) {
      // If the user message answered a tool, we must keep it; otherwise it's safe to remove.
      const answered = Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result');
      if (!answered) session.messages.pop();
    }
  } finally {
    save(session);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`NZ Model Forecaster → http://localhost:${PORT}  (model ${MODEL}, effort ${EFFORT})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log('Note: ANTHROPIC_API_KEY is not set. The UI and demo renderer work, but chat needs credentials (see .env.example).');
  }
});
