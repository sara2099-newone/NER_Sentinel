# Official dashboard update

The Official dashboard now includes a GIS control-room panel that reuses the
existing dashboard API response and contains no synthetic operational data.

## Control-room layers and source states

- Monitored risk zones are coloured Low, Moderate, High, or Critical and show
  their existing 5 km affected-zone perimeter.
- The selected-zone panel shows AI risk, early-warning status, rainfall,
  weather, soil moisture, and terrain/slope with the API's `LIVE`, `CACHED`,
  `DEMO`, or `UNAVAILABLE` state.
- Historical landslide points use the existing curated historical dataset.
- Citizen-help points use existing official-side `I Need Help` records and are
  explicitly described as last-known locations.
- Affected population is shown as `ESTIMATED`; vulnerable-road status is
  `HEURISTIC`, because neither is a live operational feed.
- Villages and infrastructure at risk are `UNAVAILABLE` until an authoritative
  asset inventory/geocoded exposure layer is connected.

## Existing Official tools retained

The command center remains available unchanged for incident management,
emergency prioritisation, citizen Safe/Need Help monitoring, alert history,
multilingual alerts, headcount/possibly-affected checks, and routing. Its
response workflow already covers Police, Disaster Management, Medical /
Ambulance, Fire & Rescue, Search & Rescue, NGOs, Local Administration, and
Roads / PWD. Its team roster and departmental dispatch simulator remain marked
`DEMO`; OSRM route results identify a live route versus its unavailable/fallback
state.

The full Express backend now registers the same protected `/api/response/*`
workflow API as the demo backend, so the Official response-team controls do not
disappear when the project is run with MongoDB.

## Verification performed

1. JavaScript syntax checks: `frontend/public/app.js`, `backend/demoServer.js`,
   and `backend/services/responseService.js`.
2. API smoke check against the local demo backend.
3. Browser test: sign in as an Official, load the dashboard, verify source
   state labels and layers, then change the GIS focus zone and verify its
   details update.
