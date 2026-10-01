import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, formatInputs } from './prompt.js';
import { TOOLS, validateForecast, validateAsk } from './tools.js';
import { createSession, getSession, save, deleteSession, listSessions } from './sessions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.FORECASTER_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.FORECASTER_EFFORT || 'high';
const MAX_TOKENS = Number(process.env.FORECASTER_MAX_TOKENS || 100000);
const MAX_ITERATIONS = 4; // emit → validate-error → emit → closing text

const app = express();
app.use(express.json({ limit: '80mb' }));
app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'] }));

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    effort: EFFORT,
    has_credentials: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  });
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

app.post('/api/chat', async (req, res) => {
  const { session_id, text = '', inputs = null, inputs_hash = null, images = [], tool_result = null } = req.body || {};
  const session = getSession(session_id || '');
  if (!session) return res.status(404).json({ error: 'Unknown session. Reload the page.' });
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

    const anthropic = getClient();
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
