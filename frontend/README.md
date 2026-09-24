# NER Sentinel — Frontend

A new frontend built from `NER_Sentinel_FINAL_LOGIN_NAV_FIXED` as a
style/structure reference (login screen, role-based nav, Leaflet maps,
GPS handling) — but every data-driven page now talks to the real
NER Sentinel backend instead of a fake in-page dataset. Nothing in the
old reference's `server.js` (its own hardcoded locations/alerts/route
logic) is reused; this frontend has no business logic of its own — it
is a thin client over the real API.

## Run it

```bash
cd frontend
node server.js
```

Open http://localhost:3000. No `npm install` needed (zero
dependencies, same philosophy as `backend/demoServer.js`).

You also need a backend running. Pick one:

```bash
# Zero setup — no MongoDB, no npm install (default the frontend expects)
cd backend && node demoServer.js

# OR the full backend — persistent MongoDB, real JWT auth, real file upload
cd backend && npm install && cp .env.example .env   # fill in MONGODB_URI, JWT_SECRET
cd backend && node server.js
```

Switch between them from the login screen's "Backend" dropdown, or
later from Settings — it's stored in `localStorage`, so it persists
across reloads.

## What each page actually shows

| Page | Backend endpoint(s) | What's real |
|---|---|---|
| Dashboard | `GET /api/dashboard/summary` | Live-computed priority ranking across all 5 monitored zones — nothing hardcoded. Includes a capability strip, a live "data source health" panel (shows which of weather/rainfall/satellite/slope/AI are live vs degraded right now), and an explanation of the priority formula, so it's readable without a verbal walkthrough |
| About | — | A self-guided explainer for examiners: exactly what a Citizen vs an Official can do, and where every number on the dashboard actually comes from (with the two documented approximations — population estimate and road status — called out explicitly) |
| Risk map | same, click a marker | Full breakdown per zone: AI risk, cumulative rainfall windows, NASA POWER satellite rainfall, rule-based threshold triggers, 5km population estimate, heuristic road status |
| Alerts | same, re-sorted | Zones ranked by the real priority formula, with the specific rule(s) that triggered shown per zone |
| Field report | `POST /api/incidents`, `POST /api/upload/evidence` | Citizen files a report with GPS + real file upload (works against either backend — the demo server writes to `backend/uploads-demo/` via a small built-in multipart parser, no npm dependency added) |
| Safety status | `POST /api/safety/status`, `GET /api/safety/needs-help` | I'm Safe / I Need Help, with a live official-side list |
| History | `GET /api/history/landslides` | The real 17-record dataset — 2022 Manipur/Tupul, 2023 Sikkim GLOF, down to 2026 |
| Command center | incidents + `PUT .../status` + `PUT .../evidence` + `POST /api/alerts/trigger` | Official verifies/rejects reports, attaches field evidence, sends multilingual SMS alerts, dispatches to Police/Fire/Medical/Disaster Management separately, sees a real headcount and a possibly-affected list near any zone, and gets a real OSRM-routed path to respond by |
| Settings | — | Language (7 locales, with a ⚠ flag on the ones that need native-speaker review — matches `backend/services/i18nService.js` exactly) and backend switch |

## What's intentionally NOT here

- The reference build's OSRM-based safe-route planner was dropped —
  the backend doesn't compute real routing, and faking it would mean
  a client-side feature backed by nothing. Better to leave it out than
  ship a page that looks live but isn't.
- File upload only works against the full backend (`server.js`), not
  the demo server (`demoServer.js`), because the demo server has no
  disk/multer setup by design (it's meant to run with zero
  dependencies). The UI tells you this rather than silently failing.
- No offline/service-worker support yet.

## Known rough edges

- "My reports" matches incidents to the logged-in user by name, not a
  real user ID (the backend's `Incident` model stores `reportedBy` as
  a plain string) — good enough for a demo, not for two citizens who
  share a name.
- This was tested by actually running `node server.js` here and
  `node demoServer.js` in `../backend` together, then driving the full
  register → dashboard → report → verify → safety status → alert flow
  with real HTTP calls (see `../backend/DEMO.md`) — not just written
  and assumed to work. It was never opened in an actual browser,
  though, since this environment can't run one — open it yourself and
  watch the console for anything the HTTP-level test wouldn't catch
  (a typo in an event handler, a CSS layout issue, etc.) before your
  recording.
