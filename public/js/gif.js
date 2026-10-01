/* Upload handling: sample frames from an animated GIF/WebP (WebCodecs ImageDecoder where available),
   downscale, and encode as PNG/JPEG base64 for the API (which otherwise only reads a GIF's first frame). */

const MAX_FRAMES = 6;
const MAX_EDGE = 1400;      // px, keeps each frame well under the API's image limits
const MAX_BYTES = 3.5e6;    // per frame, base64-decoded

function pickIndices(count, n) {
  if (count <= n) return [...Array(count).keys()];
  const out = new Set();
  for (let i = 0; i < n; i++) out.add(Math.round((i * (count - 1)) / (n - 1)));
  return [...out];
}

function drawScaled(source, w, h) {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(source, 0, 0, cw, ch);
  return c;
}

function encode(canvas) {
  // PNG keeps thin isobars crisp; fall back to JPEG if the PNG is too big.
  let dataUrl = canvas.toDataURL('image/png');
  let media = 'image/png';
  if (dataUrl.length * 0.75 > MAX_BYTES) { dataUrl = canvas.toDataURL('image/jpeg', 0.86); media = 'image/jpeg'; }
  return { media_type: media, data: dataUrl.split(',')[1], preview: dataUrl, width: canvas.width, height: canvas.height };
}

async function decodeWithImageDecoder(file) {
  const buf = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data: buf, type: file.type });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  await decoder.completed.catch(() => {});
  const count = track.frameCount || 1;
  const idx = pickIndices(count, MAX_FRAMES);
  const frames = [];
  for (const i of idx) {
    const { image } = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
    const c = drawScaled(image, image.displayWidth, image.displayHeight);
    image.close();
    frames.push({ ...encode(c), index: i, timestamp_ms: null });
  }
  decoder.close();
  return { frames, total_frames: count };
}

async function decodeStatic(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const c = drawScaled(img, img.naturalWidth, img.naturalHeight);
    return { frames: [{ ...encode(c), index: 0 }], total_frames: 1 };
  } finally { URL.revokeObjectURL(url); }
}

/** Returns { frames: [{media_type, data, preview, width, height}], total_frames, animated } */
export async function sampleImageFile(file) {
  const animated = file.type === 'image/gif' || file.type === 'image/webp' || file.type === 'image/apng';
  if (animated && 'ImageDecoder' in window) {
    try {
      const r = await decodeWithImageDecoder(file);
      return { ...r, animated: r.total_frames > 1 };
    } catch (e) {
      console.warn('ImageDecoder failed, using first frame only', e);
    }
  }
  const r = await decodeStatic(file);
  return { ...r, animated: false, note: animated ? 'Browser could not decode animation frames – first frame only. Use Chrome/Edge for multi-frame sampling.' : undefined };
}
