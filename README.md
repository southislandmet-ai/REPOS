# NZ Model Forecaster

An AI-assisted desk tool for New Zealand weather publishing. You feed it the raw ingredients a
forecaster works from – multi-model rainfall accumulations (24 h / 48 h / 5 day), a separate snow
table, and animated model imagery (GIFs) described in your own words – and chat with a Claude-powered
forecaster that applies a detailed NZ meteorology knowledge base (Southern Alps orography, Kidson
regimes, Tasman lows, southerly busters, east-coast blocking, ex-tropical cyclones, snow-level rules,
per-model NZ biases). It asks you which maps and extras you want, then delivers a complete 6-hourly
package rendered in the browser as publication-quality charts:

* **MSLP & fronts** – isobars every 4 hPa from a synthesised pressure field, H/L centres, frontal symbols, city weather
* **6-hour rainfall** – regional shading, lowland + ranges values, named hotspots (Cropp River, Milford …)
* **Wind & gusts** – barbs derived from the pressure gradient (Southern-Hemisphere geostrophy, surface backing) blended with the forecaster's regional winds
* **Snow & snow level** – fresh snow shading, snow level per region, passes as hotspots
* **Temperature** – city temperatures on an airmass wash
* **Running rainfall total** – accumulation from the start of the period
* **Overview** – pattern, confidence, model weights, model-mean → blended totals, snow summary, 6-hourly rain timeline

Every chart is 1600 × 900 (exports at 2× = 3200 × 1800), branded with your site name, time-stamped in
NZST/NZDT, and carries the "model guidance, not an official warning" line. Export single PNGs, all PNGs,
an animated GIF loop of any map type, copy-ready article text, or the raw JSON package.

## Quick start

```bash
npm install
cp .env.example .env            # add your ANTHROPIC_API_KEY
export $(grep -v '^#' .env | xargs)
npm start                       # → http://localhost:3000
```

No key yet? Press **Load demo package** in the header to preview the chart design and exports with the
bundled example (a Tasman low followed by a snowy southerly).

Requirements: Node 20+. Chrome/Edge is recommended in the browser because they expose `ImageDecoder`,
which lets the app sample up to six frames from an animated GIF (other browsers send the first frame).

## How a session runs

1. **Period & timing** – choose 24 h, 48 h or 5 days and the start time (NZ local). The 6-hour windows
   and their labels ("Thu 6 pm – midnight") are computed in the browser and handed to the AI verbatim.
2. **Rainfall accumulations** – one row per model run (ECMWF, GFS, UKMO, ACCESS-G, ICON, GEM, AIFS,
   MetService WRF, NZCSM, Windy variants, custom), one column per region or named spot. Paste a TSV
   from a spreadsheet if you prefer.
3. **Snow accumulations** – the same layout in cm, plus each model's snow level.
4. **Model imagery** – drop GIFs/PNGs and type what each one is ("ECMWF 00Z MSLP + 6 h precip loop
   T+0…T+48"). Animated GIFs are sampled in time order so the model sees the evolution.
5. **Chat** – press *Analyse & ask me what you need*. The forecaster studies the frames and tables,
   names the pattern, and asks one batched set of questions (which maps per step, extras such as
   particular passes or rivers, anything ambiguous). Answer with the checkboxes, and it emits the
   package. Ask for revisions in plain language ("make Westland wetter in step 3", "add temperature
   maps") and it re-emits the whole package.
6. **Output** – browse thumbnails, play the sequence, filter by map type, export.

The server validates every package before it reaches you (all 16 regions and 22 cities per step, the
right number of steps, per-region step rain summing to the blended total, systems inside the chart
domain, gusts ≥ means, model weights summing to 1…) and sends failures back to the model to fix.

## Architecture

```
server/
  index.js        Express 5 + SSE streaming; one Anthropic request per turn (manual tool loop)
  prompt.js       Stable, cacheable system prompt (persona + renderer facts + knowledge base)
  nz_knowledge.md The NZ meteorology & model-performance knowledge base (edit freely)
  tools.js        ask_user and emit_forecast tool schemas (strict) + semantic validator (Ajv)
  sessions.js     In-memory sessions persisted to data/sessions/*.json
public/
  index.html, css/app.css
  js/app.js       UI state, inputs, uploads, chat (SSE), question forms, output browser
  js/map.js       Canvas renderer: Mercator projection, pressure-field synthesis, marching-squares
                  isobars, fronts, wind barbs, shading, sidebars, overview
  js/gif.js       GIF frame sampling via WebCodecs ImageDecoder
  js/gifenc.js    Dependency-free animated GIF encoder for the loop export
  js/export.js    PNG / GIF / article text / JSON exports
  data/           nz_regions.json (Natural Earth 10 m, simplified), nz_places.json, demo_forecast.json
scripts/
  make_demo.mjs   Regenerates the demo package (validated against the schema)
  mock_anthropic.mjs + smoke.mjs   `npm run smoke` – full pipeline test without an API key
```

Model: `claude-opus-5-5` with adaptive thinking (`display: summarized`), `effort: high`, streaming,
strict tools with eager input streaming, and server-side refusal fallbacks (`fallbacks: "default"`).
Override with `FORECASTER_MODEL`, `FORECASTER_EFFORT`, `FORECASTER_MAX_TOKENS`.

### Prompt caching
The system prompt (≈8 k tokens of knowledge base) carries a cache breakpoint and contains nothing
volatile, so repeat turns in a session are served mostly from cache. Your inputs are sent in the user
turn only when they change (hash-checked), and images only once.

## Tests

```bash
npm run check     # syntax check of the server
npm run smoke     # mock-API end-to-end: question → answers → package → closing text
node scripts/make_demo.mjs   # regenerate + validate the demo package
```

`public/dev/render-test.html?kind=mslp&step=2` renders a single chart from the demo package for
visual checks (kinds: overview, mslp, rain6h, wind, snow, temp, accum).

## Notes and limits

* Charts are model-based guidance. MetService is New Zealand's official warning authority – the
  footer says so on every chart; keep it there.
* The AI never sees live model data: it reasons from what you type and upload. Garbage in, garbage out.
* 5-day packages are large (20 steps). If a response hits the output limit, use fewer map types per step.
* Uploaded frames live in the server session (data/sessions) – delete the session to remove them.
