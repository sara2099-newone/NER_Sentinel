# What changed in this pass

## Eighth pass — final gap-fix pass (backend clarity, real evidence upload on the demo backend, honest villages/infrastructure, straight-line-route visual honesty), verified live

Ten specific gaps were named for this pass; each is addressed below,
with what was actually verified vs. already correct.

**1. Active backend architecture clarity.** Both backends already
existed by design (demoServer.js: zero-setup/in-memory;
server.js: MongoDB-backed) and could be switched at login or in
Settings, but nothing in the app itself ever showed which one a
session was actually using. Added a small persistent "DEMO"/"LIVE"
badge to the topbar (reusing the existing `.badge`/`statusBadge()`
styling — no new visual language), so it's never ambiguous.

**2. Citizen evidence/photo/video upload — real gap, fixed.**
`POST /api/upload/evidence` only ever worked against the full
Mongo backend; on the demo backend (the one `npm start`/
`start-demo.js` actually runs) it failed outright and told the
citizen to switch backends. Implemented a real, zero-dependency
multipart/form-data parser in `demoServer.js` (no multer/busboy —
consistent with that file's "no npm install" design), plus static
file serving for the returned URLs. While doing this, also fixed a
related bug in `readRequestBody`: it decoded incoming bytes to a
UTF-8 string one TCP chunk at a time (`raw += chunk`), which
corrupts both binary uploads and any multi-byte text (Bengali/
Assamese/Manipuri script, emoji) that happens to straddle a chunk
boundary — now buffers raw bytes and decodes once. **Verified live**
in this sandbox: registered a citizen, uploaded a real PNG, downloaded
it back and confirmed the bytes were byte-for-byte identical, confirmed
non-image files and unauthenticated requests are rejected, confirmed
multi-file upload, and confirmed the returned URL attaches successfully
to a real incident report end-to-end. Updated the stale frontend error
message and `frontend/README.md` line that used to say upload only
works on the full backend.

**3. 5km affected-area labeling.** Already well-implemented
(`demo:true`, `DEMO-` prefixed ids, explicit "not a real headcount"
copy at every render site) — verified, not changed.

**4. Villages/infrastructure — added a real, sourced feature.**
There was no live asset-inventory data source, so that specific claim
correctly stays UNAVAILABLE (untouched). But the project already has
real, sourced named-place data doing double duty here:
`data/historicalLandslides.js` names real locations and
infrastructure (e.g. "Tupul railway yard, Noney district", "National
Highway 6 at Hunthar"), compiled from cited public reporting. Added
"Historically-affected places nearby" to the Official control room,
filtering that existing dataset to the selected zone with the same
150km "nearby" threshold and `haversineKm()` helper the History page
already uses — real, cited data, explicitly labeled as historical
record (not a live exposure prediction), sitting alongside (not
replacing) the honest UNAVAILABLE note.

**5. Road status HEURISTIC labeling.** Already correct on both
backends (`isHeuristic: true`, `dataSources.roadStatus: "HEURISTIC"`)
— verified, not changed.

**6. OSRM vs. straight-line fallback — real visual gap, fixed.** The
backend already labeled a simulated fallback route correctly in its
JSON (`simulated: true`) and the UI showed adjacent text saying so, but
the drawn line on the Leaflet map used the *exact same* styling logic as
a real route — a simulated route at index 0 (the only index a
single-route fallback has) drew as a solid green "recommended" line,
visually indistinguishable at a glance from genuine OSRM routing. Added
a `routeLineStyle()` helper that forces any `simulated` route into a
distinct red/dashed style regardless of its index, applied at all three
places a route gets drawn (responder dispatch, citizen safe-route panel,
response-team routing panel).

**7. AI status LIVE/UNAVAILABLE.** Traced end to end
(`aiAvailable: riskLevel !== "Unavailable" && !summary.aiError` in both
backends) and confirmed live in this sandbox: with no AI microservice
reachable here, `aiRisk` correctly reads `UNAVAILABLE`. Already
correct — verified, not changed.

**8 & 9. Full Citizen and Official flow — verified live end-to-end**
against the demo backend in this sandbox: Citizen
register→login→dashboard(location+environment+risk+earlyWarning)→
safety-status→demo-citizens(GIS)→history(GIS), and Official
register→login→dashboard→safety/count+possibly-affected(affected
area)→needs-help(safe/help monitoring)→incidents→
response/departments→response/teams→response/route(routing, correctly
falls back to the now-clearly-labeled simulated straight line since
OSRM isn't reachable here)→history. Every step returned the expected
HTTP status and every data-source badge matched ground truth for this
sandbox (no internet).

**10. Final tests.** Every `.js` file in `backend/` and `frontend/`
passes `node --check`. Every `$("id")` reference in `app.js` resolves
to a real element in `index.html` (0 missing, checked programmatically).
Re-ran the full backend vs. demo-server route-parity diff from the
previous pass: the only remaining differences are diagnostic-only
routes never called by the frontend (raw weather/rainfall/slope/
terrain/geo endpoints; `GET /api/auth/me`, also unused) — no more
broken connections.

**This sandbox has no outbound internet** (confirmed again this pass:
Open-Meteo/OSRM/NASA POWER calls return connection errors here), so
weather/rainfall/slope/OSRM/the AI microservice were exercised through
their honest fallback paths, not live — that's expected and correctly
labeled, not a defect. Verify those against a machine with real
internet + a running MongoDB + the AI microservice before relying on
LIVE data end-to-end.

## Seventh pass — targeted bug hunt (route/backend parity, a real data-corruption risk, a silent risk-scoring bug), verified live

Per the brief: audited before touching anything (syntax-checked every
`.js` file in `backend/` and `frontend/`, diffed every route the full
backend exposes against every route `demoServer.js` exposes, diffed
every DOM element id `app.js` references against what `index.html`
actually defines). Found and fixed four real, verified issues — no
redesign, nothing else touched.

**1. `POST /api/safety/location` missing from `demoServer.js`.** The
real backend (`routes/safetyRoutes.js`) has always had this endpoint
for the "keep sharing live location" toggle (`initSafetyPage` in
`app.js`); the demo server never did, so that toggle 404'd for any
citizen demoing against the default (zero-setup) backend. Added the
matching in-memory-store route.

**2. `POST /api/demo/help-requests` missing from the full backend.**
The reverse of #1 — this existed in `demoServer.js` for the Official's
"Generate Help Requests" simulation control, but not in
`routes/demoCitizenRoutes.js`, so an Official running the real
Mongo-backed server got a 404 clicking the same button. Added it,
writing into the same `SafetyStatus` collection the real
needs-help/count/possibly-affected features already read from, tagged
`source:"demo"`/`demo:true` (added to the schema) so simulated load is
never confused with a real citizen report — matches the demo server's
existing contract exactly.

**3. Real data-corruption risk in `models/SafetyStatus.js`.** `user`
and `phone` both had `default: null` *and* a `unique: true, sparse:
true` index. A Mongo sparse index still indexes an explicit `null` —
only a genuinely missing field is skipped — so the *second* app user
who never set a phone number, or the second SMS-only reporter, would
fail to upsert with an `E11000 duplicate key` error on that shared
explicit null. That's the "I'm Safe / I Need Help" core citizen flow
breaking for the second person to use it. Removed the defaults so the
fields are actually absent when not supplied, which is what the
schema's own pre-existing comments always said they should be.

**4. Silent risk-scoring bug in `services/prioritizationService.js`.**
`computePriority` assumed `riskScore` always arrives pre-normalized to
0-1 and clamped anything above 1 straight to 1 — i.e. silently treated
as *maximum* risk. The external AI microservice's exact contract lives
outside this backend-only zip and can't be verified here; if it ever
returns a 0-100 percentage instead of a 0-1 probability (a very easy
mismatch to introduce), every zone would silently read "Critical"
priority with no signal anything was wrong. Confirmed with a unit test
(`riskScore: 5` produced `priorityScore: 55 / "High"` — the same band
as a genuinely critical `riskScore: 90` case) before fixing. Now
rescales any value >1 as a 0-100 percentage instead of maxing it out.

**Also verified, not changed:** `authRoutes.js`'s wrong-role-login
403 (claimed fixed in an earlier pass) does work correctly against the
real backend, but `demoServer.js`'s login handler never checked `role`
against the stored account at all — a mismatched role selection was
silently accepted and logged the user in under their real role instead
of the 403 `loginOrRegister()` in `app.js` explicitly depends on. Fixed
to match the real backend's check.

**How this was tested:** every backend `.js` file passes `node
--check`; every pure-logic module (`thresholdService`,
`populationService`, `prioritizationService`, `presenceService`,
`i18nService`) was exercised directly with `node -e` before/after; the
route-parity and DOM-id diffs above were done programmatically, not by
memory; `demoServer.js` was actually booted in this environment and
hit with real `curl` requests for register → login (right role) →
login (wrong role, confirms the new 403) → safety/status →
safety/location (confirms the previously-404'ing route now works) →
register-Official → demo/help-requests → needs-help, with the JSON
responses inspected end to end. This sandbox has no outbound internet
(confirmed: Open-Meteo/NASA POWER/OpenTopoData calls return connection
errors here), so nothing that depends on those, on a live MongoDB, or
on the external AI microservice was run end-to-end in this pass —
verify those against your own machine before recording. Everything
else in the project (GIS heatmap rendering, offline service worker,
i18n, OSRM routing, multi-agency dispatch, etc.) was inspected and
found already substantively implemented from prior passes; this pass
did not re-verify their live behavior, only the four issues above.

## Sixth pass — Risk Map root-cause fixes (rainfall/soil-moisture timezone bug, early warning, data-source status)

Traced the full data flow (map → frontend fetch → `/api/dashboard/summary`
→ `buildZoneSummary` → weather/rainfall/satellite/slope services → AI
service → priority calc) end-to-end before changing anything, per the
brief. Two real bugs found, plus new features layered on top without
touching the map, auth, MongoDB, AI contract, or any existing route.

**Bug #1 — rainfall showing 0mm across every window (1h/3h/6h/24h)
while satellite rainfall had a value:**
`rainfallService.js`'s `computeCumulativeWindows()` needed to find
"now" inside Open-Meteo's hourly series. Open-Meteo's `timezone=auto`
labels those timestamps in the *zone's* local time with no UTC
suffix (e.g. `"2026-09-22T10:00"` = 10am in Shillong, not 10am UTC).
The old code compared that against the *server's* UTC clock for an
exact match, and its fallback parsed the timezone-less string with
`new Date(t)` — which JS resolves using the *server process's own*
timezone, not the zone's. On a UTC-hosted server watching NER India
zones (UTC+5:30), both paths silently pick an hour ~5.5 hours off from
the real "now", and depending on time of day that wrong hour often
lands on a dry overnight reading — producing exactly the "every window
shows 0mm" symptom, while `satelliteRainfallService.js` (NASA POWER,
which only works with whole UTC calendar days and never touches hourly
local-time strings) kept returning a real number. Reproduced with a
synthetic test before and after the fix; confirmed the old logic
resolved to a different, wrong index than the corrected one.
**Fix:** `getRainfallData` now also returns Open-Meteo's own
`utc_offset_seconds` for the zone; a new `resolveHourIndex()` shifts
the true current instant by that offset and compares local-label
strings to local-label strings the whole way through — `new Date()` is
never used to parse a timezone-less timestamp again. Same fix applied
everywhere this pattern was duplicated: `dashboardRoutes.js`,
`weatherScheduler.js` (this one matters most — it decides whether
auto-threshold SMS alerts fire), and `candidateIncidentService.js`.

**Bug #2 — soil moisture reads were frozen/stale:** all four call
sites read `soil_moisture_0_to_7cm[0]` — literally the value at local
midnight of the forecast's start day — regardless of what time it
actually was. Fixed to use the same `resolveHourIndex` as rainfall.

**Why AI risk was "Unavailable":** not a code bug — there is no AI
microservice anywhere in this zip (no `/ai` folder, no Python/FastAPI
files, nothing on port 8002). `aiService.js` is a correct working HTTP
client; there's just nothing running for it to reach. Everything
degrades gracefully (rule-based thresholds + population still compute),
by design, rather than faking a score.

**New, real (not cosmetic) additions**, all in
`services/riskIntelligenceService.js`, wired into every
`buildZoneSummary`/`monitorZone`/`detectCandidate` call site:
- **Soil moisture, honestly labelled**: `LIVE` (Open-Meteo modeled
  estimate) when available at that point; otherwise a `DEMO SENSOR
  DATA`-labelled value deterministically derived from real 24h
  rainfall (never random), so a future real sensor/API is a drop-in
  replacement for just that one branch.
- **Landslide early warning** (`NONE`/`WATCH`/`WARNING`/`CRITICAL`) —
  distinct from the hard CRITICAL rule: flags conditions
  *approaching* (≥75% of) a threshold, with reasons generated only
  from factors that are actually true.
- **Contributing-factors breakdown** (Rainfall/Soil Moisture/Slope/
  Population/Road Access, each bucketed HIGH/MODERATE/LOW/UNKNOWN
  from the same thresholds) plus a one-sentence explanation built
  from templates referencing only the factors that are actually
  elevated — never invented.
- **Per-field data-source status** (`LIVE`/`CACHED`/`DEMO`/
  `ESTIMATED`/`HEURISTIC`/`AI MODEL`/`UNAVAILABLE`) surfaced for
  rainfall, satellite rainfall, soil moisture, slope, weather, AI risk,
  population, and road status — `withCache`'s existing `cached` flag
  (previously computed but discarded) now actually reaches the UI.
- Zone summaries now also expose `slopeDegrees`, `elevation`,
  `lastUpdated`, and a `perimeter` object (radius + estimated
  population) that were computed internally but never returned before.

**Frontend** (`app.js`/`index.html`/`styles.css`): `renderRiskPanel`
rewritten into the requested section layout (Selected Zone / Landslide
Early Warning / Rainfall Monitoring / Environment / Exposure /
Infrastructure / Risk Explanation / rule-based thresholds), each value
next to its data-status badge; an explicit "OFFLINE / LIMITED DATA
MODE" banner when every live source has failed at once (still shows
whatever's cached instead of blanking to 0); a "Show 5km perimeter"
toggle draws the actual radius circle used by the population estimate
on the Leaflet map. Existing map markers, popups, other pages,
auth, and all other routes are untouched.



This zip only ever contained the **backend**. The frontend (`citizen.js`,
`official.js`, login pages, debug buttons, service worker, `API_BASE`
config, `getRiskColor` bug) is a separate codebase not included here —
none of the frontend-only items from the 40-point list could be touched
in this pass. Everything below is backend-only.

## Fixed / built this pass, mapped to your numbered list

| # | Item | What was actually done |
|---|------|--------------------------|
| 3 | Login-specific rate limiting | Added `loginLimiter` (10 attempts / 15 min per IP) on `POST /api/auth/login`, on top of the existing global limiter. |
| 4 | CORS wide open | `ALLOWED_ORIGINS` env var now drives an allowlist. Unset = falls back to open, with a loud console warning on boot so it's not silently insecure. |
| 6 | NASA GPM/IMERG not integrated | Real GPM/IMERG needs an Earthdata login token — out of scope. Wired **NASA POWER** instead (`services/satelliteRainfallService.js`) — genuinely public, no-key, NASA-run, satellite/reanalysis-blended precipitation. Labeled honestly in the code/response, not claimed as raw IMERG. |
| 7 | Cumulative rainfall windows | `rainfallService.computeCumulativeWindows()` — sums the hourly series already returned by Open-Meteo into 1h/3h/6h/24h totals. No new API calls. |
| 8 | Scheduler = one hardcoded location | `config/zones.js` lists 5 NER zones; `weatherScheduler.js` loops all of them every 10 min. |
| 9 | Critical-threshold rules, independent of ML | `services/thresholdService.js` — plain rainfall/slope/soil-moisture thresholds, runs regardless of whether the AI service is up. |
| 10 | Dashboard data hardcoded | `GET /api/dashboard/summary` computes weather, rainfall, satellite rainfall, threshold flags, population, and priority per zone, live, on request (cached — see #32). This is the endpoint the official dashboard should call instead of hand-typed numbers, once the frontend is wired to it. |
| 12 | Prioritisation formula | `services/prioritizationService.js` — documented weighted formula combining AI risk score, rule-based critical flag, and estimated population. |
| 13 | 5km population calc | `services/populationService.js`, using the existing haversine helper plus a per-zone density lookup (approximate — see note in the file). |
| 19 | `.env.example` missing | Added, documents every env var the backend actually reads. |
| 27 | I'M SAFE / NEED HELP | `models/SafetyStatus.js` + `routes/safetyRoutes.js`: citizens POST their status; officials GET `/api/safety/needs-help` for a live list. |
| 28 | Last-known-location | Same `SafetyStatus` model (`lastKnownLocation`), `POST /api/safety/location` for a standalone ping. |
| 30 | No real SMS dispatch | `services/alertService.js` — real Twilio send when `TWILIO_*` env vars are set; logs a clearly-marked simulated result otherwise. Scheduler calls it automatically when a zone goes critical. |
| 31 | Evidence not actually stored | `middleware/uploadMiddleware.js` + `routes/uploadRoutes.js` (`multer`) — files are now written to `backend/uploads/` and served at `/uploads/<file>`; `Incident.evidence` stores the real URLs. |
| 32 | No caching on AI pipeline | `services/cacheService.js` — TTL memory cache, applied to weather/rainfall/satellite/slope lookups in the dashboard endpoint. |
| 2 | Officials can't view/verify reports | This already existed in the backend (`GET /api/incidents`, `PUT /api/incidents/:id/status` restricted to `Official` role) — the gap was that `official.js` never called it. Backend side needs nothing further; this is a frontend wiring task. |
| — | Scheduler never actually ran | Found and fixed as a side effect of #8: `weatherScheduler.js` existed but was never `require`d anywhere, so its cron job never started. Now required from `server.js`. |

## Still not done (backend-side)

- **#23 automatic incident detection/confirmation** (AI + satellite + citizen reports combined) — the dashboard endpoint surfaces AI risk, rule thresholds, and citizen reports side by side, but nothing auto-promotes a citizen report to "confirmed" based on the other two. Would need a defined confidence-combination rule.
- **#24 field-official upload path** — `routes/uploadRoutes.js` isn't role-restricted, so any authenticated user (citizen or official) can already use it; there's no separate official-only upload flow.
- **#26 live help-request monitoring** — the data now exists (`GET /api/safety/needs-help`), but nothing pushes it (no websocket/poll trigger) — the official frontend would need to poll it.
- Everything explicitly marked "Impossible / out of hackathon scope" in your list (#35–39) is still out of scope on the backend. #30 (SMS) is the one exception that's genuinely real now, not simulated, once Twilio env vars are set.

## Second pass — multilingual, historical data, field-official upload

You asked for "100%." Being straight with you: a few items on your
original list are structurally impossible to make 100% real in a
hackathon timeframe no matter how much code gets written — true
cell-broadcast SMS, a production GSI-grade historical landslide
inventory, live traffic-aware routing, and a full native mobile app all
need infrastructure/data access outside what's reachable here. Those
stay honestly labeled as heuristic/simulated/partial rather than
pretend-finished. Everything below IS newly real, not simulated:

| # | Item | What was done |
|---|------|----------------|
| Multilingual notifications | Zero → real, scoped | `services/i18nService.js` — real translations for the fixed set of system messages (risk levels, priority levels, safety status, the critical-alert SMS template) in English, Hindi, Bengali, Assamese, Manipuri, Khasi, Mizo. **Read the confidence note at the top of that file** — en/hi/bn are solid, as/mni/kha/lus are best-effort and flagged `NEEDS_REVIEW_LOCALES`; get a native speaker to check those before a real deployment, especially for anything actually sent to a phone during an emergency. Wired into: the scheduler's SMS alerts (`ALERT_SMS_LOCALES` env var, one combined multi-language SMS per alert), and `GET /api/dashboard/summary?locale=hi` / `POST /api/safety/status?locale=hi` for translated labels. |
| #22 Historical dataset fully synthetic | Partial, but now real | `scripts/seedHistoricalLandslides.js` — 11 real, publicly-reported NER landslide events (dates, states, approximate coordinates, casualty figures, sourced via news reporting — not a comprehensive GSI-grade inventory, and most coordinates are town-level approximations, flagged per-record via `coordinatePrecision`). `GET /api/history/landslides` serves them. Run the seed script once (`node scripts/seedHistoricalLandslides.js`) against your Mongo instance. |
| #24 No field-official upload path | Fixed | `PUT /api/incidents/:id/evidence` (Official-only) attaches evidence URLs (from `POST /api/upload/evidence`, which already works for any authenticated role) to an existing incident — this is the missing "official verifies on-site and attaches their own evidence" flow. |
| IMD API vs Open-Meteo | Investigated, documented | Checked: IMD does not currently offer a public no-key REST API — their AWS/ARG data portal was actually locked down to the public in May 2025 (see citation below). Open-Meteo + NASA POWER remains the honest, correct substitution to state in your report; don't claim direct IMD integration. |

## Fourth pass — real response-coordination features (multi-agency dispatch, two-way SMS, real routing, honest presence tracking)

You asked for a researched feature list first, then implementation. Here's what's real vs. honestly substituted:

| Feature | Status |
|---|---|
| Multi-agency SMS dispatch (Police/Fire/Medical/Disaster Mgmt) | Real. `config/agencies.js` + `POST /api/alerts/dispatch-agencies`. **Numbers are never pre-filled with a real public emergency line** — point `.env`'s `POLICE_SMS_NUMBERS` etc. at your own team's phones for a demo. |
| Automatic threshold-triggered alerts | Already existed (the scheduler) — now visibly connects to the same agency categories. Worth stating explicitly: SMS is inherently "offline" for the recipient — it needs cell signal, not internet, so this already satisfies "works offline" for the person receiving it. |
| Real headcount near a zone | New — `GET /api/safety/count`. This is a genuine count of people who used the app/SMS, deliberately distinct from the dashboard's density-based population *estimate*. |
| "Trapped citizen" count via location tracking | True cell-tower triangulation needs telecom-carrier access — not achievable here. Honest substitute: `GET /api/safety/possibly-affected` — real citizens who are NeedHelp or have gone quiet since a cutoff time, built only from real app/SMS reports. Labeled as such everywhere it appears. |
| Reply SAFE/HELP by plain SMS, no app | Real — `POST /api/sms/incoming`, a genuine Twilio webhook with keyword detection in English/Hindi/Bengali. **Needs a public URL** (ngrok for local dev) for Twilio to actually reach it — the code is correct and tested with form-encoded requests exactly like Twilio sends, but nothing calls it until that one setup step is done. |
| Real responder routing | Real — `GET /api/route` proxies OSRM's public routing API (actual OpenStreetMap roads, actual distance/duration, real alternative routes). "Low-risk" is a heuristic: prefers the alternative that stays furthest from other monitored hazard zones — not live traffic/road-closure data, which has no free source for this region. Labeled as an advisory. |

### Bugs found and fixed while building this
- demoServer.js's body parser assumed every POST body was JSON — Twilio sends form-encoded data, which crashed it. Fixed with content-type-aware parsing, verified with a raw form-encoded curl request matching Twilio's actual format.
- The AI-model status row (added in the previous pass) could show "Live" even when the AI check never ran — already fixed, still holds.

### Frontend additions
- Real Web Audio API siren (not a generic beep) for newly-critical zones, and a distinct chime for new help requests — both mutable, both only fire on a genuinely NEW event, not every refresh.
- GPS improvements: accuracy display, a "keep sharing live location" toggle (`watchPosition`), and a manual pin-drop map fallback when GPS is denied or unavailable.
- Official Command Center: real headcount panel, possibly-affected panel, multi-agency dispatch UI, and a responder routing panel that draws the actual OSRM route (with alternatives) on a live Leaflet map.
- A live, auto-refreshing (20s poll) map of everyone flagged Need Help.
- About page expanded to explain every one of the above in plain language.

State plainly: "IMD does not currently expose a public API; we use
Open-Meteo (weather/rainfall forecast) and NASA POWER (satellite-
derived precipitation) as documented, publicly-accessible
substitutes." That's a stronger, more credible line to a judge than
an unverifiable claim of IMD integration.

## Third pass — a live-running demo, and a bigger/more recent historical dataset

You asked for something actually **live**, even where the real stack
(Mongo + AI service + npm install) isn't practical to demo with. Here's
what that means concretely:

- **`demoServer.js`** — a second, zero-dependency entry point. `node demoServer.js` and it's running, no `npm install`, no MongoDB. It reuses the exact same real service modules as the main server (thresholds, population, priority, i18n, satellite rainfall, etc.), backed by an in-memory store instead of Mongo. **This was actually booted and hit with `curl` for every route before being handed to you** — see `DEMO.md` for the full command log and what came back. The dashboard endpoint makes genuinely live calls to Open-Meteo/NASA POWER/OpenTopoData (it only showed connection errors in the sandbox this was built in, which has no internet — your machine will get real data).
- **Historical dataset grew from 11 to 17 records** (`data/historicalLandslides.js`), now including the two largest NER landslide-related disasters for scale — the 2022 Manipur/Tupul landslide (58 dead, Territorial Army camp) and the 2023 Sikkim GLOF (South Lhonak lake outburst, 90+ dead, destroyed the Teesta III dam) — plus several 2025 "Northeast Deluge" monsoon events and the most recent 2026 Sikkim bridge washout. Still not a comprehensive GSI-grade inventory, but a much stronger spread from routine local incidents to major disasters to very recent events.



```bash
cd backend
npm install        # installs multer + twilio, newly added to package.json
cp .env.example .env
# fill in MONGODB_URI, JWT_SECRET at minimum
node scripts/seedHistoricalLandslides.js   # one-time: loads real historical records
npm start           # or: node server.js
```

Nothing above was run end-to-end against a live MongoDB or the AI
microservice in this environment (no network/DB access here) — every
new pure-logic module (`thresholdService`, `populationService`,
`prioritizationService`, `cacheService`, `rainfallService`'s window
calc, `alertService`'s no-Twilio-configured path) was unit-tested
directly with `node -e` and confirmed correct. Every file passes
`node --check`. Routes that need Mongo or the AI service running are
untested beyond that — test them against your real DB/AI service
before recording the demo.

## Fifth pass — closing the last flagged gap, visual role separation, VS Code ease

You sent a much more complete reference build of your own project
(separate citizen/official portals, a real trained model, Docker,
tests). Comparing against it directly:

- **Candidate incident detection** — `services/candidateIncidentService.js`
  + `POST /api/intelligence/candidate`. This was explicitly flagged as
  unresolved (`#23` in the original list): combines the AI risk model,
  rule-based thresholds, and nearby pending citizen reports into one
  "does this look like it might be happening" signal. It never
  auto-confirms an incident — the disclaimer travels with every
  response, matching the honesty pattern used everywhere else in this
  project.
- **Real risk-trend history** — `WeatherData` now stores a real
  `riskScore`/`riskLevel` on every scheduler snapshot (previously it
  only stored raw weather fields); `GET /api/risk-history` serves it.
  This replaces what would otherwise be a fake hardcoded trend line
  with the system's own actually-observed history.
- **Both mirrored into `demoServer.js`** with zero new dependencies —
  candidate detection reuses the same `candidateIncidentService.js`
  with an in-memory nearby-report counter injected instead of a
  Mongoose query (the Mongoose `Incident` model is now lazy-required
  inside that service specifically so requiring the file never forces
  `mongoose` to load — demoServer.js's "no npm install" guarantee
  depended on catching this).
- **Visual separation, Citizen vs Official** — the whole app shell
  (not just the two official-only pages) switches to a dark "command
  console" theme the instant an Official logs in — different
  background, accent color, card treatment — not a recolor of
  identical cards. Shared pages (map/history/about/etc.) inherit
  whichever theme is active, which is the one place the two roles
  necessarily look the same, by design.
- **VS Code / terminal ease** — added a root `package.json` (`npm
  start` works from the top level, no `cd` needed) and
  `.vscode/launch.json` (F5 starts everything with zero typing).
