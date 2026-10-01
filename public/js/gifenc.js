/* Tiny dependency-free animated GIF encoder (LZW, global 256-colour palette built by frequency).
   Good for flat-colour chart graphics like ours. Usage: const g = new GifEncoder(w, h); g.addFrame(ctx, delayMs); g.finish() → Blob */

export class GifEncoder {
  constructor(width, height, { repeat = 0 } = {}) {
    this.w = width; this.h = height; this.repeat = repeat;
    this.frames = []; // {indexed: Uint8Array, delay}
    this.palette = null;
  }
  addFrame(canvasOrCtx, delayMs = 1000) {
    const ctx = canvasOrCtx.getContext ? canvasOrCtx.getContext('2d') : canvasOrCtx;
    const { data } = ctx.getImageData(0, 0, this.w, this.h);
    this.frames.push({ rgba: data, delay: Math.max(2, Math.round(delayMs / 10)) });
  }
  _buildPalette() {
    // Count colours at 5 bits/channel, keep the 255 most frequent (+ black), map the rest to nearest.
    const counts = new Map();
    for (const f of this.frames) {
      const d = f.rgba;
      for (let i = 0; i < d.length; i += 16) { // subsample for speed
        const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 255).map(([k]) => k);
    const pal = [[0, 0, 0]];
    for (const k of top) pal.push([((k >> 10) & 31) << 3 | 4, ((k >> 5) & 31) << 3 | 4, (k & 31) << 3 | 4]);
    while (pal.length < 256) pal.push([0, 0, 0]);
    this.palette = pal;
    this.lookup = new Map();
  }
  _nearest(r, g, b) {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let v = this.lookup.get(key);
    if (v !== undefined) return v;
    let best = 0, bd = 1e9;
    for (let i = 0; i < this.palette.length; i++) {
      const p = this.palette[i]; const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bd) { bd = d; best = i; if (d === 0) break; }
    }
    this.lookup.set(key, best);
    return best;
  }
  finish() {
    this._buildPalette();
    const out = [];
    const push = (...b) => out.push(...b);
    const u16 = (v) => push(v & 255, (v >> 8) & 255);
    push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
    u16(this.w); u16(this.h); push(0xF7, 0, 0);  // GCT 256 colours
    for (const [r, g, b] of this.palette) push(r, g, b);
    // Netscape loop extension
    push(0x21, 0xFF, 0x0B, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 0x03, 0x01); u16(this.repeat); push(0);
    for (const f of this.frames) {
      const idx = new Uint8Array(this.w * this.h);
      const d = f.rgba;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) idx[j] = this._nearest(d[i], d[i + 1], d[i + 2]);
      push(0x21, 0xF9, 0x04, 0x00); u16(f.delay); push(0x00, 0x00);
      push(0x2C); u16(0); u16(0); u16(this.w); u16(this.h); push(0x00);
      push(8); // LZW min code size
      const lzw = lzwEncode(idx, 8);
      for (let i = 0; i < lzw.length; i += 255) { const chunk = lzw.subarray(i, Math.min(i + 255, lzw.length)); push(chunk.length, ...chunk); }
      push(0x00);
    }
    push(0x3B);
    return new Blob([new Uint8Array(out)], { type: 'image/gif' });
  }
}

function lzwEncode(pixels, minCodeSize) {
  const clearCode = 1 << minCodeSize, eoi = clearCode + 1;
  let codeSize = minCodeSize + 1, nextCode = eoi + 1;
  let dict = new Map();
  const out = []; let cur = 0, curBits = 0;
  const emit = (code) => { cur |= code << curBits; curBits += codeSize; while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; } };
  emit(clearCode);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]; const key = (prefix << 8) | k;
    const code = dict.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (nextCode < 4096) { dict.set(key, nextCode++); if (nextCode - 1 === (1 << codeSize) && codeSize < 12) codeSize++; }
    else { emit(clearCode); dict = new Map(); nextCode = eoi + 1; codeSize = minCodeSize + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (curBits > 0) out.push(cur & 255);
  return new Uint8Array(out);
}
