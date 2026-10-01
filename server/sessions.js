// Minimal durable session store: in-memory map, JSON file per session so a server restart keeps work.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, '..', 'data', 'sessions');
fs.mkdirSync(DIR, { recursive: true });

const sessions = new Map();

function file(id) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('bad session id');
  return path.join(DIR, `${id}.json`);
}

export function createSession() {
  const id = crypto.randomBytes(12).toString('hex');
  const s = {
    id,
    created_at: new Date().toISOString(),
    messages: [],          // Anthropic message params (full fidelity, including thinking blocks)
    transcript: [],        // What the UI shows: {role, kind, text|question|forecast, ts}
    last_inputs_hash: null,
    forecast: null,        // Last valid forecast package
    pending_tool_use_id: null, // ask_user awaiting an answer
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  sessions.set(id, s);
  save(s);
  return s;
}

export function getSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  try {
    const s = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    sessions.set(id, s);
    return s;
  } catch {
    return null;
  }
}

export function save(s) {
  fs.writeFileSync(file(s.id), JSON.stringify(s));
}

export function deleteSession(id) {
  sessions.delete(id);
  try { fs.unlinkSync(file(id)); } catch { /* already gone */ }
}

export function listSessions() {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
        return { id: s.id, created_at: s.created_at, turns: s.transcript.length, title: s.forecast?.meta?.title || null };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
