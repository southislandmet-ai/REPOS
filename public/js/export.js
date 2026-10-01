import { PANEL_W, PANEL_H } from './map.js';
import { GifEncoder } from './gifenc.js';

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60); }
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function toBlob(canvas, type = 'image/png', q) { return new Promise((res) => canvas.toBlob(res, type, q)); }

export async function exportPng(renderer, forecast, stepIndex, kind, scale = 2) {
  const cv = renderer.render({ forecast, stepIndex, kind, scale });
  const blob = await toBlob(cv);
  const step = forecast.steps[stepIndex];
  download(blob, `${slug(forecast.meta.title)}-${kind === 'overview' ? 'overview' : `step${String(step.index).padStart(2, '0')}-${kind}`}.png`);
}

export async function exportAllPng(renderer, forecast, panels, scale = 2, onProgress) {
  let i = 0;
  for (const p of panels) {
    await exportPng(renderer, forecast, p.stepIndex, p.kind, scale);
    onProgress?.(++i, panels.length);
    await new Promise((r) => setTimeout(r, 350)); // let the browser queue downloads
  }
}

/** Animated GIF of one map type across all steps (1200×675, ~1.4 s per frame, last frame held). */
export async function exportGif(renderer, forecast, kind, { width = 1200, frameMs = 1400, onProgress } = {}) {
  const height = Math.round(width * PANEL_H / PANEL_W);
  const enc = new GifEncoder(width, height);
  const off = document.createElement('canvas'); off.width = width; off.height = height;
  const octx = off.getContext('2d');
  const steps = forecast.steps.map((s, i) => i).filter((i) => forecast.steps[i].maps.includes(kind));
  for (let n = 0; n < steps.length; n++) {
    const cv = renderer.render({ forecast, stepIndex: steps[n], kind, scale: width / PANEL_W });
    octx.drawImage(cv, 0, 0, width, height);
    enc.addFrame(octx, n === steps.length - 1 ? frameMs * 2 : frameMs);
    onProgress?.(n + 1, steps.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  download(enc.finish(), `${slug(forecast.meta.title)}-${kind}-loop.gif`);
}

/** Copy-ready article text. */
export function articleText(forecast, brand) {
  const a = forecast.assessment;
  const lines = [
    `${forecast.meta.title}`,
    `${forecast.meta.subtitle}`,
    '',
    a.pattern_summary,
    '',
    'Key points:',
    ...a.key_messages.map((k) => `• ${k}`),
    '',
    'Six-hourly:',
    ...forecast.steps.map((s) => `• ${s.label}: ${s.headline}. ${s.narrative}`),
    '',
    `Confidence: ${a.confidence}. ${a.uncertainties.join(' ')}`,
    `Model blend: ${a.model_weights.map((m) => `${m.model} ${Math.round(m.weight * 100)}%`).join(', ')} (${forecast.meta.model_runs_used}).`,
    '',
    a.official_note,
    brand?.name ? `— ${brand.name}` : '',
  ];
  return lines.join('\n');
}

export function exportJson(forecast) {
  download(new Blob([JSON.stringify(forecast, null, 2)], { type: 'application/json' }), `${slug(forecast.meta.title)}-package.json`);
}
