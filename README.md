# SIMODEL — South Island high-definition model blend

SIMODEL turns the model charts you already look at every day (windy, tropicaltidbits, pivotalweather,
weather.us, MetService, ECMWF charts…) into a **pan-and-zoom, 1.2 km South Island weather model** your site
can publish. Claude reads each uploaded chart (legend, units, model, run, valid time, the field itself),
SIMODEL blends the models with a South-Island-specific skill and bias matrix, then downscales the result
over a real 600 m terrain model with orographic physics — so when you zoom into Canterbury you see the
nor'west spillover, the Alps maximum, the lee shadow and the foothill gradients, not a blurry 13 km pixel.

Three pages (top navigation):

| Page | What it does |
|---|---|
| **Model Suite** (`suite.html`) | Pick the model (every global + NZ regional model listed), drop a set of same-type charts (6-h precip & ptype, 24-h precip, 925/850 hPa or 2 m temperature, MSLP, wind, snow…), and the AI reads, classifies, dates and **orders them oldest → newest** (filename hours, run + lead and printed valid times are cross-checked; local-time captions are caught). Drag frames to fix order, double-click to correct a time. The catalogue shows every product SIMODEL can now build and how far out from *now* each one runs. **Run blend review** asks Claude to weigh the models by region/field for *this* situation, set the flow and physics, and say honestly what the data supports. |
| **SIMODEL Viewer** (`viewer.html`) | Windy-style map limited to the South Island + 250 km of coast. Layers appear only when you have uploaded the data for them (native 6-h/12-h/24-h precipitation, 24-h totals built from 6-h windows, running accumulations, temperature, wind with particle animation, MSLP with isolines, snow, snow level…). Time slider in NZ time (uploads are UTC), model picker (SIMODEL blend or any single member), live value picker, relief shading, isolines, export PNG **with the colour key always included and no text on the overlay**. Confidence panel explains how many models, their agreement, lead time and readability, and SIMODEL smooths detail away when the data is thin. |
| **Publish charts** (`index.html`) | The forecaster chat: feed accumulation tables and model GIFs, answer its questions, and it emits a validated 6-hourly package rendered as publication charts (MSLP/fronts, rain, wind barbs, snow, temperature, overview). |

Settings (⚙, top right) stores your Anthropic API key **in your browser only**; the server forwards it per request. A server-side `ANTHROPIC_API_KEY` also works.

## Quick start

```bash
npm install
npm start            # http://localhost:3000  → open Settings, paste your API key
```

No key yet? `npm run smoke` runs the whole pipeline against a built-in mock; the Publish page's
**Load demo package** previews the chart design.

## How the science is built in

* **Terrain** – Mapzen/Terrarium DEM mosaic at zoom 8 (~450–600 m) for the whole South Island
  (`public/data/nz_dem_z8.png`, 2 MB). Used for hillshade, lapse-rate temperature, upslope precipitation,
  ridge/valley wind factors and snow masking.
* **Chart reading** (`server/suite.js`) – a strict tool schema makes Claude report layer type, original units
  (in, mm, °F, kt, m/s, km/h, hPa…), accumulation window (3/6/12/24 h or run-total), run & valid time (UTC)
  with confidence, a 0.5° lattice of values over NZ, wind direction or precipitation type as a secondary
  field, synoptic features and extremes. Units are converted to canonical mm/cm/°C/hPa/kt.
* **Self-sorting** (`selfSort`) – filename forecast hours (f036, +48h, 036), run + lead, printed valid time
  and 12/13-h local-time offsets are reconciled; undated charts are slotted into the sequence; duplicates
  and odd steps are flagged on the set.
* **Regional skill & bias matrix** (`public/data/simodel_skill.json`) – per model × South Island
  sub-region × field: trust weights and typical biases (e.g. globals 35–55 % low in the West Coast ranges and
  over-spilling into the lee; GFS fast/progressive and over-wet on the plains in NW flow; ACCESS wet in the
  lee; AIFS/GraphCast superb pattern but smooth precipitation; WRF/NZCSM best for the Alps, inland cold
  pools and Cook Strait/Kaikōura funnelling; snow levels a touch high in deep cold easterlies). Shown to the
  user as "bias notes" and overridable by the AI blend review.
* **Downscaling** (`public/js/simodel.js`) – bicubic interpolation of the blended 0.5° field, then
  * precipitation/snow: linear-theory style enhancement `exp(a·U·∇h)` evaluated a few km upwind (cloud
    water drifts downwind before falling out), an elevation term, lee drying, and **renormalisation so
    the blended 0.5° totals are conserved** — detail is redistributed, never invented at the coarse scale;
    the flow comes from an uploaded 10 m wind layer, else geostrophic flow from MSLP, else the blend plan;
  * temperature: lapse rate against model-scale terrain (5–8 °C/km, set by the review);
  * wind/gusts: ridge speed-up and valley sheltering by elevation anomaly;
  * snow: masked by snow level (uploaded, or inferred from temperature).
* **Confidence → detail** – model count, weighted agreement, lead time, readability, time confidence and
  field difficulty give a score; the output grid is always 0.015° but Gaussian smoothing widens from 0 km
  (high) to ~10 km (very low) so a single model is never shown as crisp 1 km truth. The viewer says so.

## Architecture

```
server/index.js      Express 5 · per-request Anthropic client (browser key or env) · SSE streaming
server/suite.js      layer/model catalogue · extract_chart + emit_blend_plan tools · self-sort · storage (data/suite.json)
server/prompt.js     forecaster system prompt (+ server/nz_knowledge.md knowledge base)
server/tools.js      ask_user / emit_forecast tools + validator for the publish package
public/js/simodel.js SIMODEL engine (DEM, lattice blend, downscaling, confidence, palettes)
public/js/viewer.js  Leaflet viewer: canvas field layer, hillshade base, particles, isolines, export
public/js/suite.js   Model Suite page · public/js/app.js publish page · public/js/common.js nav/settings
public/data/         DEM, regions, places, skill matrix, demo package
scripts/             mock_anthropic.mjs (offline API stand-in), smoke.mjs (end-to-end test), make_demo.mjs
```

Model: `claude-opus-5-5`, adaptive thinking, streaming, strict tools, server-side refusal fallback on the
chat route. Override with `FORECASTER_MODEL`, `FORECASTER_EFFORT`, `FORECASTER_MAX_TOKENS`.

## Tests

```bash
npm run check   # syntax
npm run smoke   # mock API: chat package, chart ingestion + self-sort, blend plan, engine products & field
```

## Honesty notes

SIMODEL is model-based guidance. It cannot know more than the charts you give it; with one model it shows
terrain-redistributed single-model guidance and says so. MetService is the official warning authority and
every export carries that line. Verify valid times on the Model Suite page before publishing.
