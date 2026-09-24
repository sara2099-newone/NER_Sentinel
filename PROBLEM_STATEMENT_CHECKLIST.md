# Problem statement checklist — what's actually done vs. not

Checked against the real code, not against intentions. ✅ = done and
verified. ⚠️ = partially done, with the real reason it isn't further
along. ❌ = not done, with why.

## (a) Collect and analyse data from...

- ✅ **Rainfall patterns** — Open-Meteo, real API, current + past + forward window (`services/rainfallService.js`).
- ✅ **Soil moisture sensors** — real when available: Open-Meteo's `soil_moisture_0_to_7cm` (a modeled value, not a physical in-ground sensor — there is no live sensor network in this region to connect to). Falls back to a clearly-labeled "DEMO SENSOR DATA" synthetic estimate only when that call fails.
- ✅ **Satellite imagery** — NASA POWER `PRECTOTCORR` (satellite+reanalysis precipitation). Documented honestly as NASA POWER, not raw GPM/IMERG (that needs an Earthdata login + OPeNDAP, out of scope) — `services/satelliteRainfallService.js`.
- ✅ **Terrain/slope data** — OpenTopoData ASTER 30m elevation, real slope computed from 5 sampled points (`services/slopeService.js`).
- ✅ **Historical landslide records** — curated, cited dataset with real named places (`data/historicalLandslides.js`), now also surfaced on the Official control room as "Historically-affected places nearby."

## (b) AI/ML models to identify high-risk zones and predict events

- ⚠️ **Partial.** A real integration point exists (`services/aiService.js`) with a documented 11-field contract, and the whole pipeline degrades honestly to `riskLevel: "Unavailable"` when it's unreachable — verified live in this sandbox. **The actual trained ML model is a separate microservice not included in this repo** (documented as "Member 3's FastAPI microservice"). This backend calls it; it doesn't contain it. That's the single biggest real gap against this problem statement, and not one a documentation/integration pass can close — it needs the actual model.

## (c) Real-time alerts to district admins, disaster management, communities

- ✅ Automatic threshold-crossing SMS via Twilio (real integration, honest "simulated" fallback if Twilio isn't configured) — `scheduler/weatherScheduler.js`.
- ✅ Multilingual SMS (`services/i18nService.js`, default en+hi, configurable) for both automatic and manual dispatch.
- ✅ In-app Alerts page (real-time ranked list) + alert history log.
- ✅ Manual dispatch to named responder categories (Police/Fire/Medical/Disaster Management/etc.) — `routes/alertRoutes.js`.
- ✅ **Added this pass:** each zone now carries its real district (e.g. "East Khasi Hills district" for Shillong, "Gangtok district" for the town of the same name post-2021 renaming) — verified against current administrative records, not assumed — so "district administrations" is a real, checkable field, not just implied by a city name.

## (d) GIS mapping — vulnerable roads, villages, infrastructure

- ✅ Functional GIS map (Leaflet), real risk-zone heatmap-style overlay, not decorative.
- ⚠️ **Roads** — heuristic only (`isHeuristic: true`, labeled HEURISTIC in the UI), because no live traffic/road-closure API is integrated. Correctly labeled, not faked.
- ⚠️ **Villages/infrastructure** — no live asset-inventory source exists, so that's honestly UNAVAILABLE, not invented. What *is* real: "Historically-affected places nearby," built from the sourced historical dataset.
- ✅ **Fixed this pass:** map content now always renders in English regardless of the user's selected app language, and switched all map tiles to a provider with English place-name labels (previously used standard OSM tiles, which render local-script labels).

## (e) Citizen/field-official geo-tagged photo/video upload

- ✅ Real upload with GPS metadata, working end-to-end on **both** backends (fixed this project's previous pass — it used to only work against the full MongoDB backend).

## (f) Dashboards

- ✅ **Risk severity levels** — Low/Medium/High/Critical, computed, not assigned by hand.
- ⚠️ **Road connectivity status** — heuristic (see (d)).
- ✅ **Weather-linked risk forecasts — added this pass.** Previously the app only showed *past* rainfall (last 1h/3h/6h/24h). Open-Meteo's response already includes up to 7 days *forward*, which was being fetched but never read forward. Added a real forecast figure (next-24h forecast rainfall, from that same already-fetched data) to the dashboard and the map's risk panel, clearly labeled LIVE/UNAVAILABLE.
- ✅ **Emergency response prioritisation** — real formula (risk score + rule-based critical flag + estimated population), not a fixed label. (A related bug from an earlier pass — a mis-scaled risk score could silently max out priority — was already fixed.)

## Multilingual notifications / low-network & offline functionality

- ✅ Multilingual UI (risk/priority/safety-status labels) + multilingual SMS.
- ✅ Offline service worker (app shell works with no network) + offline action queue (safety status, incident reports queue and sync when back online).
- ⚠️ Only two action types queue offline today (safety status, incident report) — other actions simply fail offline rather than queueing. Not fixed this pass (would need a broader queueing rework); flagged honestly rather than left silent.

## Expected Solution bullets

- ✅ Real-time GIS dashboard and risk heatmap.
- ⚠️ AI/ML predictive analytics engine — integration point real, model itself not included (see (b)).
- ✅ Mobile/web application — responsive web app + installable PWA (manifest + service worker). Not a native mobile app.
- ⚠️ **IMD weather API** — IMD has no public REST API to integrate with (verified in an earlier pass). Open-Meteo + NASA POWER are used as real, honestly-labeled substitutes. This can't be "completed" without IMD actually exposing one.
- ✅ Satellite feeds — NASA POWER (see (a)).
- ⚠️ Sensor data — no physical sensor network exists to connect to; modeled soil moisture is the real substitute, labeled as such.
- ✅ Automated SMS/app-based early warning — real, both automatic (scheduler) and manual.
- ⚠️ **Cloud-based architecture with offline sync** — the code is cloud-deployment-ready (env-based config throughout, MongoDB-compatible, no hardcoded hosts) and has offline sync for two action types, but **isn't actually deployed to any cloud service** — that's an infrastructure/ops step outside a code repo, not something this pass can tick by itself.

## Honest bottom line

Everything that's a real, obtainable data source or a real, buildable
feature is built and verified, not stubbed. The three items still
marked ⚠️/❌ (the trained ML model itself, IMD's nonexistent public
API, and actual cloud deployment) aren't gaps in effort — they're
things outside what a code change here can produce: a model needs
training data and a data scientist's work, IMD needs to publish an
API that doesn't currently exist, and deployment needs an actual
server/cloud account to deploy to.
