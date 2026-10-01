# New Zealand Operational Meteorology Knowledge Base

This document is the forecaster's reference. It is written for a model that must turn multi-model
precipitation accumulations (24 h / 48 h / 5 day) and snow guidance into a physically coherent,
6-hourly sequence of synoptic charts for Aotearoa New Zealand. Treat it as expert guidance, not law:
every event is different, and the user's uploaded model imagery and typed context always take
precedence over generic climatology when they conflict.

---

## 1. Geography that controls the weather

### 1.1 The Southern Alps / Kā Tiritiri o te Moana
* A continuous barrier ~500 km long, crest 2000–3000 m (Aoraki/Mt Cook 3724 m), lying SW–NE across
  the prevailing westerlies. This is the single most important control on NZ precipitation.
* **Windward (West Coast / Fiordland):** extreme orographic enhancement. Annual totals: Hokitika ~2.9 m,
  Milford Sound ~6.7 m, Cropp River (Hokitika catchment) ~11 m. Record falls: Cropp River 1086 mm / 48 h
  (Dec 1995), 758 mm / 24 h. In a strong moist NW flow, 24 h totals of 200–400 mm in the ranges are
  routine; 400–600 mm occurs several times a decade; 150–250 mm at the coast (Hokitika, Franz Josef, Haast).
* **Spillover:** precipitation carried across the Main Divide into the headwaters of the big eastern
  lakes/rivers (Waitaki, Rakaia, Rangitata, Waimakariri, Clutha headwaters, Lakes Wānaka/Hāwea/Tekapo/Pūkaki).
  Spillover typically reaches 20–40 km east of the Divide; totals drop by roughly a factor of 10 within
  50 km. Spillover is what floods the Rangitata/Rakaia/Waitaki while Christchurch stays dry under the arch.
* **Lee (Canterbury, Otago, Marlborough, Hawke's Bay):** föhn ("nor'wester") drying and warming. Canterbury
  Plains can see 30+ °C and RH < 20 % while Hokitika has 150 mm. The "nor'west arch" is the lenticular
  cloud band marking the subsidence zone.
* Global models (9–13 km) represent the Alps as ~1200–1500 m high and far too wide. Consequence:
  **they under-forecast West Coast peak totals and over-spread rain eastward**. Convection-permitting
  NZ models (1.5–4 km) resolve the barrier and are much better for West Coast totals and the spillover edge.

### 1.2 North Island terrain
* **Tararua, Ruahine, Kaweka, Kaimanawa, Raukūmara ranges**: a NE–SW axial spine. Tararua Range gives
  big westerly-flow totals (>200 mm/24 h in the ranges) with spillover into Wairarapa headwaters; in
  southerly/easterly flows they enhance rain on the Wairarapa/Hawke's Bay side instead.
* **Mt Taranaki (2518 m)**: isolated volcano; produces its own orographic rain ring in any flow, strongest
  on the side facing the wind. Lee-side wave clouds and gusts.
* **Central Plateau (Ruapehu 2797 m, Tongariro, Ngāuruhoe)**: snow on the Desert Road (SH1) and
  Whakapapa/Tūroa in southerly outbreaks; summit winds extreme.
* **Coromandel / Kaimai / Bay of Plenty ranges / Raukūmara (East Cape)**: face NE–E. These produce
  the big subtropical-low and ex-tropical-cyclone totals (Coromandel 300–500 mm, Gisborne ranges 400+ mm).
* **Northland / Auckland**: low relief; rainfall from convergence lines, slow-moving lows, and
  atmospheric rivers rather than orography. Auckland's 27 Jan 2023 event (~250 mm in <24 h, 211 mm at
  Auckland Airport, >280 mm in Albert Park) came from a stationary convergence zone fed by a subtropical
  atmospheric river under a blocking high to the east.

### 1.3 Key straits, gaps and funnels (wind)
* **Cook Strait**: funnels and accelerates both NW and S flows. Wellington: gusts 110–140 km/h in a
  northerly gale, 120–160 km/h in a strong southerly. Wind speeds in the strait are commonly 1.5–2× the
  surrounding open-sea speed.
* **Foveaux Strait / Southland / Clutha**: SW–W gales; Stewart Island/Rakiura exposed.
* **Canterbury nor'wester**: downslope gusts 100–150 km/h on the plains (Christchurch Airport ~120 km/h in
  severe events); Rangitata/Rakaia gorges and Ashburton inland worst; hot and dry; fire danger.
* **Kaikōura coast / Marlborough**: NE funnelling along the coast; southerly busters arrive very
  sharply here.
* **Wairarapa / Castlepoint / Cape Palliser, Cape Turnagain, East Cape, Cape Reinga, Puysegur Point**:
  exposed capes with highest gusts in the respective flow direction.
* **Lee troughs**: east of the Alps in a NW flow a trough deepens over Canterbury; wind is light and
  variable or NE on the coast while the plains inland roar with nor'wester. The coastal NE ("sea breeze
  trough" convergence) is a frequent Christchurch feature.

---

## 2. Synoptic climatology – the recurring patterns

NZ sits at 34–47 °S in the westerlies, between the subtropical ridge (~30 °S, migrating 25–38 °S with
season) and the circumpolar trough. Weather systems move west to east; a typical cycle (Kidson regime
cycle) is 5–7 days: trough / front, ridge / high, then the next front. Climatologically the dominant
pattern types (Kidson 2000) are:

* **Trough regimes** (~38 %): fronts crossing from the Tasman Sea; T, SW, TNW, TSW types. Most rain
  on the west and south; SW flows deliver showers and snow to the south and east.
* **Zonal regimes** (~25 %): strong westerlies south of a ridge over the North Island; H, HNW, W types.
  Wet in the west/south of the South Island, fine and warm in the east and north.
* **Blocking regimes** (~37 %): a high slow-moving east/southeast of NZ; HSE, HE, NE, HW, R types.
  Easterly / northeasterly flows onto the North Island east coast and Canterbury; subtropical lows
  can be steered onto northern NZ; these produce the big east-coast rain events.

### 2.1 Pattern catalogue with model-blend implications

**A. Classic cold front in a NW flow (most common rain-maker)**
* Pre-frontal NW flow strengthens for 12–36 h; West Coast rain begins well ahead of the front (warm
  conveyor belt onto the Alps), often 24 h of rain before the front itself. Peak West Coast rates
  10–25 mm/h in the ranges in the 6–12 h before frontal passage.
* Front crosses the South Island west→east in 3–6 h (Alps slow it), the North Island in 6–12 h.
  Typical movement 40–70 km/h. Fronts often weaken/fragment crossing the Alps and re-form on the east
  coast as a southerly change.
* Post-frontal: SW flow with showers in the west and south, clearing the east. Snow to 800–1200 m
  on the ranges in winter/spring; lower in strong outbreaks.
* **6-hourly shaping:** West Coast totals ramp up over 12–24 h, peak in the 6 h before the front,
  then drop abruptly (the "shut-off" when the flow turns SW is remarkably sharp). Canterbury: 0–2 mm
  pre-frontal, 2–10 mm with the southerly change, spillover headwaters 20–60 mm per 6 h at peak.
  Wellington: rain arrives with the front, 10–30 mm over 6–12 h, then clears from the south.
* **Models:** all globals handle the timing to within ±3–6 h at day 2–3; ECMWF usually best on timing,
  GFS tends to run slightly fast and too progressive, breaking down highs too quickly; ACCESS-G good
  in the Tasman but can be too wet in the lee. Peak West Coast totals from globals should be scaled
  UP by ~1.3–1.8× in the ranges and by ~1.1–1.3× at the coast; conversely, global spillover should be
  trimmed back by ~30–50 % more than ~30 km east of the Divide unless convection-permitting guidance
  disagrees.

**B. Tasman Sea low (deepening wave on the front)**
* A wave forms on a trailing front in the Tasman and deepens as it approaches; central pressures
  980–1000 hPa. Track decides everything:
  * Track across the central/northern South Island → heavy rain Nelson/Tasman/Marlborough/Buller and
    the Kaikōura coast; strong easterlies ahead of the low on the North Island east coast.
  * Track across Cook Strait → Wellington region severe; Wairarapa heavy rain in the easterly.
  * Track to the south of the South Island → prolonged NW rain West Coast + spillover, then violent
    southerly change up the east coast (the "southerly buster").
* Models disagree most on track at day 3–5 (±150–300 km). The ensemble spread is the honest answer.
  Prefer the model(s) whose track matches the user's uploaded imagery.
* Nelson/Tasman August 2022 (a slow Tasman low with a NE flow pinned against the ranges, 750 mm over
  4 days in the Richmond Range) and the Buller floods July 2021 (Westport >300 mm) are archetypes.

**C. Southerly outbreak / cold southerly with snow**
* A deep low SE of NZ (Chatham Rise) or a low tracking up the east coast, with a strong ridge over or
  west of the Tasman, pushes polar maritime air up both islands. 850 hPa temps < −2 °C over the South
  Island, 1000–500 hPa thickness < 528 dam (sea-level snow possible), < 534 dam (snow to ~300–500 m).
* Snow in Canterbury/Otago/Southland falls hardest where moist S–SE flow is forced up the foothills
  and the east-facing slopes of the inland basins. Dunedin, Christchurch (Port Hills), Timaru, Oamaru
  can get sea-level snow 1–3 times per decade (e.g. June 2006 Canterbury, Aug 2011 nationwide, July 2015
  Rangitata/Mt Hutt, Sept 2017 Dunedin, June 2015 Mackenzie Basin).
* **Snow level rule of thumb:** snow level ≈ freezing level − 300 m in light/moderate precip; in heavy
  precipitation with a deep moist layer, evaporative/melting cooling drags the snow level down a further
  200–400 m ("snow level drag"); in dry cold air it can also fall far below the freezing level (isothermal
  layer). Wet-bulb 0 °C height is the better predictor than the dry freezing level — use it when models
  supply it.
* **Snow accumulation:** 1 mm liquid ≈ 1 cm fresh snow at −1 to −3 °C (ratio ~10:1), 7–8:1 near 0 °C
  (wet snow), 12–15:1 in cold dry air. On NZ alpine passes most heavy falls are near 0 °C, so use
  8–10:1 unless the airmass is very cold.
* **Key road snow locations and typical thresholds:** Desert Road (SH1, 1074 m), Napier–Taupō (SH5),
  Remutaka Hill (SH2, 555 m), Lewis Pass (SH7, 907 m), Arthur's Pass (SH73, 920 m) and Porters Pass
  (SH73, 939 m), Burkes Pass / Mackenzie (SH8, 709 m), Lindis Pass (SH8, 971 m), Crown Range (1076 m,
  highest sealed), Milford Road (SH94, Homer Tunnel 945 m; avalanche closures), Dunedin northern
  motorway / Kilmog, Danseys Pass, Haast Pass (562 m).
* Southerlies arrive sharply: temperature drops 8–14 °C in an hour; Christchurch 24 °C → 11 °C.
  Timing of the change on the east coast progresses north at 50–80 km/h: Dunedin → Christchurch ~4–5 h,
  Christchurch → Kaikōura ~2–3 h, Wellington ~2 h later, then up the Wairarapa/Hawke's Bay coast.
* **Models:** globals routinely place the snow level too high over the east coast (coarse terrain,
  warm bias in cold-pool situations); shave 200–300 m off global snow levels in a deep cold easterly
  onto Canterbury/Otago. GFS is often colder than ECMWF at 850 hPa in these outbreaks (and sometimes right).
  NZ 1.5–4 km models capture the inland basin cold pools (Mackenzie, Central Otago) that globals miss.

**D. Easterly / northeasterly rain onto the eastern North Island (blocking)**
* A high east or southeast of NZ with a low or trough to the north / northwest gives a moist NE–E
  flow onto Gisborne, Hawke's Bay, Wairarapa, Bay of Plenty and Coromandel. Slow-moving (block) → long
  duration. Totals 100–300 mm are common; >400 mm in the Raukūmara/Gisborne ranges and Coromandel.
* Hawke's Bay: rain focuses on the Kaweka/Ruahine foothills and Esk valley; the coastal plain gets less
  until the flow backs to the S/SE. Cyclone Bola (Mar 1988) ~900 mm in 72 h near Tolaga Bay; Cyclone
  Gabrielle (Feb 2023) 400–550 mm in the Hawke's Bay ranges with catastrophic river flooding
  (Esk, Tūtaekurī, Ngaruroro), severe for Gisborne/Tairāwhiti, Coromandel, Northland.
* Canterbury can also flood in an easterly: a low to the north with a cold SE flow (May 2021 Canterbury
  floods: 400–550 mm in the foothills, Ashburton; Rangitata/Ashburton rivers record flows). Here the
  rain is on the plains and foothills, NOT the West Coast, and the Alps' lee becomes the windward side.
* **Models:** this is where globals do worst with totals — they underestimate orographic enhancement in
  moist easterlies by 30–50 % in the ranges and are frequently too fast to clear the block. If one
  global holds the block longer, weight it. ECMWF and UKMO tend to handle blocking better than GFS.

**E. Subtropical low / ex-tropical cyclone**
* Nov–April (peak Jan–Mar). A tropical cyclone recurves SE from the Coral Sea / Vanuatu / Fiji region,
  transitions, and approaches Northland/Auckland/Coromandel/Bay of Plenty/Gisborne as a deep
  sub-tropical low (970–990 hPa). Warm, very moist air (PW > 50 mm) → extreme rain rates (30–60 mm/h),
  severe E–SE gales on the eastern side, storm surge.
* Track east of NZ: heavy rain and gales on the east coast of the North Island (Gabrielle, Bola, Giselle
  1968/Wahine). Track over the North Island: Northland/Auckland worst, then Bay of Plenty. Track down
  the west (rare): Taranaki/Waikato.
* **Models:** track spread is large until ~48 h; intensity after extratropical transition is often
  under-forecast by globals; ECMWF generally best, GFS prone to a track bias (often too far west early,
  too fast). Treat the ensemble envelope as the forecast and say so. Totals in the ranges should be
  scaled up ×1.3–1.6 from global guidance.

**F. Atmospheric river (AR) events**
* A long plume of moisture from the subtropics (NW of NZ, IVT > 500 kg m⁻¹ s⁻¹) ahead of a slow front.
  West Coast ARs: Westland/Fiordland 300–700 mm in 48 h (e.g. March 2019 Westland 1086 mm/48 h at Cropp,
  Waiho Bridge washed out; Feb 2020 Fiordland/Milford 1000+ mm). Northern ARs: Auckland Jan 2023,
  Northland/Coromandel repeatedly in summer 2023.
* The AR's persistence (a quasi-stationary front) is what generates the totals; 6-hourly rates are
  steady (15–40 mm/6 h coast, 50–120 mm/6 h ranges) for 24–48 h rather than a sharp peak.
* **Models:** AR moisture flux is handled well by globals, but the placement of the stalled front is
  often off by 50–100 km, which moves the max from Westland to Fiordland or vice-versa. Use the
  ensemble and the uploaded imagery.

**G. Anticyclone / blocking high over NZ**
* Highs 1025–1040 hPa drift slowly east. Fine, light winds, frosts and fog inland in winter (Central
  Otago, Waikato, Canterbury inland), sea breezes in summer (Canterbury NE, Nelson "Nelson Bay breeze").
* Easterly quarter drizzle on the Canterbury coast under a high to the south ("Christchurch grey").
* Precipitation: 0–1 mm except coastal drizzle. Snow guidance: none. Don't invent rain.

**H. Westerly "zonal" regime (spring especially, SON)**
* Train of fronts, highs centred north of the North Island. West Coast wet every 1–2 days, the east
  warm, dry, windy; nor'west gales on the Canterbury Plains; snow on the Alps and passes with each
  front in SW flows; spring lambing storms (cold SW outbreaks after a front) in Southland/Otago.

**I. Convective / thunderstorm days**
* Summer afternoon storms over the central North Island (Waikato, King Country, Central Plateau,
  Bay of Plenty ranges), the Kaimanawa / Kaweka, and inland Canterbury / Otago in a NW flow with
  cold air aloft. Globals give large-scale 2–8 mm; reality is 0 or 30 mm in a 10 km cell. Say so.

### 2.2 Seasonal and climate-driver modifiers
* **ENSO:** La Niña → more NE/E flows, warmer SST, subtropical lows, wet N and E of the North Island
  (Northland, Auckland, BoP, Gisborne), drier W and S of the South Island; El Niño → stronger W/SW,
  wet West Coast, dry east coasts (drought risk Hawke's Bay / Canterbury / Otago), cooler.
* **SAM positive** → highs over NZ, settled, lighter westerlies; negative → stormier westerlies, more
  southern fronts.
* **Season:** Winter (JJA): southerlies, snow, frosts, east-coast lows. Spring (SON): strongest westerlies,
  nor'westers, equinoctial gales, rapid changes. Summer (DJF): subtropical lows/ex-TCs, highs, sea
  breezes, convective storms; West Coast still wet. Autumn (MAM): often the most settled; big ex-TC
  events also occur (Bola Mar 1988, Gabrielle Feb 2023, Debbie Apr 2017, Cook Apr 2017).
* **Daylight-saving:** NZDT (UTC+13) from the last Sunday in September to the first Sunday in April;
  NZST (UTC+12) otherwise. Model runs are in UTC: 00Z = 12 pm NZST / 1 pm NZDT; 12Z = midnight NZST /
  1 am NZDT; 06Z = 6 pm NZST / 7 pm NZDT; 18Z = 6 am NZST / 7 am NZDT.

---

## 3. Model characteristics in the NZ domain

Weights below are a starting point for a blend; always adjust to the case, the model's lead time,
and what the user tells you about recent run-to-run consistency.

| Model | Resolution | Typical NZ strengths | Typical NZ weaknesses | Default blend weight |
|---|---|---|---|---|
| **ECMWF IFS (HRES / ENS)** | 9 km (ENS 9 km, 51 members) | Best synoptic timing & track skill days 2–7; good blocking; good AR moisture | Smooths Alps → under-does West Coast peaks, over-spreads spillover; snow levels a touch high in cold easterlies | 0.30–0.35 |
| **ECMWF AIFS (AI model)** | ~28 km effective, 0.25° | Excellent 500 hPa / MSLP pattern & track skill to day 7+; very consistent | Precipitation smooth and low-biased in extremes; no fine orography; don't trust its totals, trust its pattern | 0.05–0.10 (pattern only) |
| **GFS (NCEP)** | 13 km | Freely available, 4 runs/day; often colder (and sometimes right) in southerly outbreaks; useful trend indicator | Too progressive (fast fronts, breaks down blocks too early); overshoots convective rain in warm sectors; run-to-run flip-flops at day 4–7; track bias on ex-TCs | 0.15–0.20 |
| **UKMO (Unified Model global)** | 10 km | Strong on blocking and cut-off lows; good frontal structure; MetService heritage | Can be too dry in the West Coast ranges; fewer public products | 0.15–0.20 |
| **ACCESS-G (BoM)** | 12 km | Good Tasman Sea low development; good coverage of systems approaching from Australia | Wet bias in the lee; slightly slow with southerlies | 0.10–0.15 |
| **ICON (DWD)** | 13 km | Sharp fronts; decent precipitation structure | Over-deepens some lows; less verified in NZ | 0.05–0.10 |
| **GEM / GDPS (CMC)** | 15 km | Independent view; ok on synoptics | Noisy precipitation; often too wet in showery SW flows | 0.05–0.10 |
| **MetService NZ WRF / "NZ4" / NZLAM (4 km / 8 km)** | 4–8 km | Resolves Alps/ranges; far better West Coast peak totals and spillover edge; Cook Strait winds | Only to ~2–3 days; inherits boundary errors from its global driver | 0.25–0.35 within range |
| **NIWA NZCSM (1.5 km) / NZLAM (12 km) / NZENS** | 1.5 km | Best inland cold pools, convective detail, snow level drag, basin snow | 48 h range; convective noise; can over-amplify | 0.25–0.35 within range |
| **HRRR-style / WRF from windy.com, Weatherwatch, Meteologix, Pivotal** | 3–9 km | Visual, accessible | Often just downscaled GFS/ICON; inherits their timing errors | treat as the parent model |

General rules of thumb:
1. **At day 1–2, a well-initialised NZ convection-permitting model beats every global on totals.**
   At day 3–5, synoptic pattern skill (ECMWF > UKMO ≈ GFS ≈ ACCESS) matters more than resolution.
2. **Globals under-do orographic maxima** (West Coast, Tararua, Raukūmara, Coromandel ranges, Kaweka) by
   20–50 % and **over-do the lee** by 30–60 % beyond the spillover zone. Correct for it.
3. **Timing spread**: at 48 h, ±3 h between models is normal; at 96–120 h, ±6–12 h and the front may
   be a different front. Never present 5-day 6-hourly detail with false precision — widen the ranges
   and say "indicative timing".
4. **Precipitation type**: globals' snow fraction over the eastern South Island is unreliable — recompute
   from freezing level / wet-bulb height, elevation and rate, using the rules in §2.1C.
5. **Model agreement** is the best single confidence indicator. Two independent dynamical cores
   (e.g. ECMWF + UKMO) agreeing is worth more than GFS agreeing with three GFS-derived products.
6. **Run-to-run consistency**: if the user mentions a model has flipped between runs, down-weight it.

### 3.1 Turning period totals into 6-hourly increments
The user supplies 24 h / 48 h / 5-day totals. You must distribute them into 6-h bins that follow the
synoptic evolution — **never divide evenly**. Procedure:
1. Decide the pattern type (§2.1) and the timing of the key features (front arrival at Hokitika,
   Christchurch, Wellington, Auckland; low track; change to SW; block breakdown) from the uploaded
   imagery and the models' consensus timing.
2. For each region, sketch an intensity curve against time: pre-frontal ramp (West Coast), frontal
   peak, post-frontal shut-off, showery tail (W/S), southerly change (E coast), easterly persistence
   (N/E), etc. Typical shape fractions for a single NW front over 24 h on the West Coast:
   6 h bins ≈ 10 % / 25 % / 45 % / 20 %. For a slow easterly block over 48 h in Hawke's Bay: roughly
   flat 10–15 % per bin with a peak bin 20–25 % as the low's warm conveyor crosses.
3. Scale each region's curve so the sum equals your blended period total for that region (not the raw
   model mean — the orographically corrected blend). Keep the sum consistent to within 5 %.
4. Snow: assign snow only in bins where the snow level is below the terrain in question, using the
   liquid equivalent × ratio rule; give the snow level per bin — it usually falls through the event in
   a southerly and rises in a warm-advection NW event.
5. Winds: direction follows the isobars (Southern Hemisphere: **clockwise around lows, anticlockwise
   around highs**; surface wind backs ~15–30° toward low pressure over land, less over sea). Speed scales
   with the pressure gradient: roughly 4 hPa per 100 km ≈ 25–30 kt gradient wind at 40 °S; 8 hPa/100 km ≈
   45–55 kt (gale/storm). Apply funnel factors (§1.3): Cook Strait ×1.5–2, Canterbury nor'wester gusts
   ×1.6–1.8 of the gradient speed, exposed capes ×1.3.
6. Temperatures: pre-frontal NW on the east coast is warm (Christchurch 22–30 °C in summer, 15–20 °C in
   winter); the southerly change drops 8–14 °C; West Coast is mild and steady; inland basins have the
   extremes. Dew point tracks the airmass: subtropical > 18 °C, polar maritime < 5 °C.

### 3.2 Pressure-system construction guidance (for drawing MSLP)
* Give each centre a realistic central pressure and radius of influence:
  * Mobile Tasman high: 1020–1032 hPa, radius 900–1400 km. Blocking high east of NZ: 1028–1040 hPa,
    radius 1200–1800 km.
  * Frontal wave / Tasman low: 985–1005 hPa, radius 500–900 km. Deep Southern Ocean low south of NZ:
    955–985 hPa, radius 900–1500 km. Ex-TC / subtropical low: 965–995 hPa, radius 400–800 km (tight).
  * Lee trough east of the Alps: shallow, 2–4 hPa, elongated N–S along the Canterbury coast.
* Background pressure for the domain: 1010–1016 hPa typical; lower (1005) in stormy regimes, higher
  (1018–1022) in settled summer or winter ridging.
* Fronts: cold fronts trail SW→NE from the low to the SW; the warm front/ occlusion lies NE/E of the low.
  Over the South Island draw the front bending as it is delayed by the Alps. A southerly change on the
  east coast is a cold front or trough oriented E–W to NE–SW moving north.
* Keep systems moving coherently between 6-h steps: a typical mobile system moves 40–60 km/h
  (~250–350 km per 6 h, ~2.5–3.5° longitude). Blocks move < 15 km/h. Ex-TCs 25–45 km/h and accelerating
  after recurvature.
* The MSLP picture at each step must be consistent with the rain/wind you assign to each region in that
  same step — this is what makes the sequence credible to a trained eye.

---

## 4. Regional cheat-sheet (what a 6-h value "means" locally)

| Region | Wet flows | Dry/sheltered flows | 6 h heavy rain threshold (coast / ranges) | Local hazards |
|---|---|---|---|---|
| Northland | NE, E, N (subtropical lows), stationary fronts | SW, S | 25 / 40 mm | flash flooding, slips, Kaeo/Whangārei flooding, NE gales |
| Auckland | NE, N, convergence lines | SW, S, W | 25 / — | urban flash flooding (>25 mm/h), Harbour Bridge wind closures in SW/N gales |
| Waikato | N, NW, NE; convective | SW, S (fog in highs) | 20 / 30 mm | Waikato/Waipā river flooding, Coromandel SH25 slips |
| Bay of Plenty | NE, N, E; ex-TCs | SW, W | 30 / 50 mm | Rangitāiki/Whakatāne floods, Kaimai/Pāpāmoa slips |
| Gisborne / Tairāwhiti | E, NE, SE (blocks, ex-TCs) | W, NW, SW | 30 / 60 mm | extreme orographic totals, Waipaoa floods, forestry slash, isolation (SH2/SH35) |
| Hawke's Bay | E, SE, NE (lows to N/NE) | W, NW (very dry, föhn) | 25 / 50 mm | Esk/Tūtaekurī/Ngaruroro floods, Napier–Taupō Rd snow (S) |
| Taranaki | W, NW, SW (mountain enhancement) | E, SE | 25 / 50 mm | mountain rain, SW gales, Waitara floods |
| Manawatū-Whanganui | W, NW (Tararua/Ruahine), S | E | 20 / 50 mm | Whanganui/Manawatū floods (2004, 2015), Desert Rd snow, Saddle Rd wind |
| Wellington | N (rain with front), S (showers/rain), Tararua W | NE (sheltered) | 20 / 45 mm | severe gales (N & S), Remutaka Hill snow/wind, Hutt River, ferry cancellations |
| Nelson | N, NE, NW (ranges), slow Tasman lows | S, SW, SE (very sheltered) | 25 / 50 mm | Maitai/Waimea floods, Takaka Hill closures, Richmond Range slips |
| Tasman | NW, N, W (Kahurangi, Golden Bay) | S, SE | 25 / 60 mm | Motueka/Takaka floods, Kahurangi 300 mm+ |
| Marlborough | NE, E, SE (lows crossing Cook Strait) | NW, W (föhn, very dry) | 20 / 40 mm | Wairau/Awatere floods, Kaikōura coast slips, Kaikōura NE funnelling |
| West Coast | NW, W, N (everything from the Tasman) | S, SE, E (dry, föhn from the Alps) | 40 / 100 mm | Buller/Grey/Hokitika/Waiho/Haast floods, SH6 slips, Otira Gorge, Fox/Franz |
| Canterbury | S, SE, E (lows to N/NE), NW spillover headwaters | NW on the plains (hot, dry, gale) | 15 / 40 mm | Rangitata/Rakaia/Waimakariri/Ashburton floods, nor'west gales, Port Hills snow, Lewis/Arthur's/Porters Pass snow |
| Otago | S, SE, E (coastal), NW headwaters (Clutha lakes) | NW (Central Otago very dry) | 15 / 40 mm | Dunedin flash flooding (June 2015), Clutha/Taieri floods, snow Dunedin hills/Crown Range/Lindis, Central Otago frost |
| Southland | SW, W, S, NW (Fiordland extreme) | NE, E | 20 / 60 mm (Fiordland 150 mm) | Mataura/Ōreti floods (Feb 2020), Milford Rd avalanche, Foveaux gales, lambing storms |

---

## 5. Communication standards for a news-site weather graphic

* Lead with impact: where, when (local time, named day), how much, how confident.
* Use local-time labels (NZST/NZDT) and name the day ("Thursday 6 pm – midnight").
* Give ranges, not false precision: "80–120 mm" not "97 mm", except model-table values.
* Name the pattern in plain language ("a deep low in the Tasman Sea", "a slow-moving northeasterly
  flow"), then the mechanism ("rain pinned against the ranges").
* State the model consensus and the outlier explicitly ("ECMWF and UKMO agree on a Cook Strait track;
  GFS is 200 km further north — if GFS is right, Wellington's heaviest rain shifts to Hawke's Bay").
* Flag MetService as the official warning authority; your graphics are model-based guidance, not
  official warnings. Never fabricate observations or official warnings.
* Use macrons in Māori place names where they are standard: Whangārei, Tauranga, Whakatāne, Taupō,
  Whanganui, Manawatū, Kaikōura, Ōamaru, Tīmaru, Ōtautahi/Christchurch, Ōtepoti/Dunedin, Aoraki,
  Wānaka, Hāwea, Pūkaki, Rakiura. Keep the English-first exonym where that is the common usage.
