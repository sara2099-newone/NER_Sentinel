# Live demo server (no DB, no npm install)

`demoServer.js` is a second entry point, separate from the real
`server.js`. Use it when you want something that just **runs**, right
now, on your laptop, for the presentation — no MongoDB, no AI
microservice, no `npm install` first.

## Run it

```bash
cd backend
node demoServer.js
```

That's it. You'll see:

```
NER Sentinel DEMO server listening on http://localhost:5050
```

It was tested exactly this way before being handed to you — booted
with plain `node demoServer.js` and hit with `curl` for every route.
The only thing that didn't return live data in that test was
`/api/dashboard/summary`, because the sandbox it was built in has no
internet access — on your machine it will actually reach Open-Meteo,
NASA POWER, and OpenTopoData.

## What's real, what's in-memory

| Endpoint | Live? |
|---|---|
| `GET /api/dashboard/summary?locale=hi` | **Real live calls** to Open-Meteo (weather/rainfall), NASA POWER (satellite rainfall), OpenTopoData (slope). If your AI microservice is running at `AI_SERVICE_URL`, its prediction is included too; if not, risk score degrades to "Unavailable" and everything else still computes. |
| `GET /api/history/landslides?state=Mizoram` | Real seeded dataset, served directly — no DB needed. |
| `POST /api/safety/status`, `GET /api/safety/needs-help` | Real logic, in-memory store (resets on restart). |
| `POST /api/incidents`, `GET /api/incidents`, `PUT /api/incidents/:id/status` | Real logic, in-memory store. |
| `POST /api/alerts/trigger` | Real Twilio SMS if `TWILIO_*` env vars are set; otherwise returns the exact message that would have been sent, in every language you ask for. |

No auth was originally enforced on this server; it now has real
(minimal) auth for the official-only routes — see below.

## Auth (added after this doc was first written)

The demo server now has real (if minimal) auth — register/login/me,
zero dependencies (plain `crypto`, no bcrypt/JWT). Official-only routes
(`needs-help`, incident status/evidence, alert trigger) now require a
Bearer token for an account with role `"Official"`.

```bash
# Register a citizen and an official
CITIZEN=$(curl -s -X POST http://localhost:5050/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ananya","email":"ananya@test.com","password":"test1234","role":"Citizen"}')
CITIZEN_TOKEN=$(echo "$CITIZEN" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

OFFICIAL=$(curl -s -X POST http://localhost:5050/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Officer K","email":"officerk@gov.in","password":"test1234","role":"Official"}')
OFFICIAL_TOKEN=$(echo "$OFFICIAL" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

# Use $CITIZEN_TOKEN / $OFFICIAL_TOKEN as: -H "Authorization: Bearer $CITIZEN_TOKEN"
```

## Frontend

`../frontend` is a matching static frontend (`node server.js`, port
3000, also zero npm install) that calls this demo server — or the
full backend — via fetch(). See `../frontend/README.md`.


```bash
# 1. Show the live dashboard (real weather/rainfall/slope/priority per zone)
curl -s "http://localhost:5050/api/dashboard/summary?locale=hi" | head -50

# 2. Show real historical incidents, including the two biggest NER disasters
curl -s "http://localhost:5050/api/history/landslides" | head -30

# 3. Citizen reports a hazard (as the citizen)
curl -s -X POST http://localhost:5050/api/incidents \
  -H "Content-Type: application/json" -H "Authorization: Bearer $CITIZEN_TOKEN" \
  -d '{"description":"crack in hillside near NH-6","location":{"lat":23.7,"lng":92.7}}'

# 4. Official verifies it (as the official)
curl -s -X PUT http://localhost:5050/api/incidents/1/status \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OFFICIAL_TOKEN" \
  -d '{"status":"Verified"}'

# 5. A citizen marks themselves as needing help
curl -s -X POST http://localhost:5050/api/safety/status \
  -H "Content-Type: application/json" -H "Authorization: Bearer $CITIZEN_TOKEN" \
  -d '{"status":"NeedHelp","note":"trapped near road","lat":25.58,"lng":91.89}'

# 6. Official view of everyone needing help, live
curl -s http://localhost:5050/api/safety/needs-help -H "Authorization: Bearer $OFFICIAL_TOKEN"

# 7. Trigger a multilingual critical alert (shows the message even with no Twilio configured)
curl -s -X POST http://localhost:5050/api/alerts/trigger \
  -H "Content-Type: application/json" -H "Authorization: Bearer $OFFICIAL_TOKEN" \
  -d '{"zoneId":"shillong","locales":["en","hi","bn"]}'
```

Every one of those is a real HTTP call to a real running process
doing real work — nothing in this script is a mock return value typed
into a script. This exact sequence (register both accounts, run all
seven calls) was run against a live `node demoServer.js` process
before this file was handed to you, alongside the frontend actually
serving pages — see `../frontend/DEMO.md` for that side.
