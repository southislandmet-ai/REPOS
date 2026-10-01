// End-to-end smoke test against the mock API: boots the mock + server, drives the chat API through
// question → answer → forecast → closing text, and checks the session state. No real API key needed.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const MOCK_PORT = 4010, PORT = 3999;
const procs = [];
function run(cmd, args, env) { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', (d) => process.stdout.write(`  ${d}`)); p.stderr.on('data', (d) => process.stderr.write(`  ${d}`)); procs.push(p); return p; }
async function waitFor(url) { for (let i = 0; i < 40; i++) { try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch {} await sleep(250); } throw new Error(`timeout waiting for ${url}`); }
async function chat(body) {
  const res = await fetch(`http://localhost:${PORT}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await res.text(); const events = [];
  for (const chunk of txt.split('\n\n')) { const ev = /^event: (.*)$/m.exec(chunk)?.[1]; const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join(''); if (ev) events.push([ev, data ? JSON.parse(data) : null]); }
  return events;
}
const assert = (c, m) => { if (!c) { console.error('✗', m); process.exitCode = 1; throw new Error(m); } console.log('✓', m); };

try {
  run('node', ['scripts/mock_anthropic.mjs'], { MOCK_PORT: String(MOCK_PORT) });
  run('node', ['server/index.js'], { PORT: String(PORT), ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}` });
  await waitFor(`http://localhost:${MOCK_PORT}/`); await waitFor(`http://localhost:${PORT}/api/health`);
  const { id } = await fetch(`http://localhost:${PORT}/api/session`, { method: 'POST' }).then((r) => r.json());
  const inputs = { period_hours: 24, start_local: 'Thu 2 Oct 2026 06:00 NZDT', step_windows: [], rain_accumulations: [{ model: 'ECMWF', run: '00Z', totals_mm: { 'West Coast': 95 } }], snow_accumulations: [], forecaster_notes: 'test', brand_name: 'Test' };
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  let ev = await chat({ session_id: id, text: 'Analyse and ask me what you need', inputs, inputs_hash: 'h1', images: [{ name: 'ecmwf.gif', description: 'ECMWF MSLP loop', total_frames: 12, frames: [{ media_type: 'image/png', data: png1x1 }, { media_type: 'image/png', data: png1x1 }] }] });
  const q = ev.find((e) => e[0] === 'question'); assert(q, 'turn 1 produced an ask_user question'); assert(q[1].question.questions.length === 2, 'question has 2 items');
  assert(ev.some((e) => e[0] === 'thinking'), 'thinking summary streamed');
  let s = await fetch(`http://localhost:${PORT}/api/session/${id}`).then((r) => r.json()); assert(s.pending_tool_use_id === q[1].tool_use_id, 'session is awaiting the answer');
  ev = await chat({ session_id: id, text: '', inputs, inputs_hash: 'h1', images: [], tool_result: { content: JSON.stringify({ maps: { selected: ['mslp', 'rain6h', 'wind', 'snow'] }, extras: { other: 'Arthur\'s Pass' } }) } });
  const f = ev.find((e) => e[0] === 'forecast'); assert(f, 'turn 2 produced a forecast package'); assert(f[1].forecast.steps.length === 4, 'package has 4 steps'); assert(f[1].warnings.length === 0, 'package passed validation');
  assert(ev.some((e) => e[0] === 'tool_progress'), 'tool progress events streamed');
  const closing = ev.filter((e) => e[0] === 'text').map((e) => e[1].text).join(''); assert(/Package delivered/.test(closing), 'closing summary streamed after the package');
  assert(ev.some((e) => e[0] === 'done' && e[1].stop_reason === 'end_turn'), 'turn ended cleanly');
  s = await fetch(`http://localhost:${PORT}/api/session/${id}`).then((r) => r.json()); assert(s.forecast?.meta?.title, 'forecast persisted in the session'); assert(s.pending_tool_use_id === null, 'no pending question'); assert(s.transcript.length >= 5, 'transcript recorded');
  console.log('\nSMOKE OK');
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { for (const p of procs) p.kill(); }
