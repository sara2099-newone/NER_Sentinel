# NER Sentinel — Getting Started

**Everything — backend and frontend — is in this one folder.** Open
this whole folder in VS Code (`File → Open Folder`), then either:

- Press **F5** (or Run → Start Debugging) — a `.vscode/launch.json`
  is already set up, so this just works with zero typing, or
- Open a terminal in VS Code (`` Ctrl+` ``) and run:
  ```bash
  npm start
  ```
  (a root `package.json` is included specifically so `npm start`
  works from this top-level folder — you don't need to `cd` into
  `backend/` or `frontend/` first).

Either way, this starts the backend (port 5050) and frontend (port
3000) together, labels each line of output `[backend]` / `[frontend]`
so you can tell them apart, and stops both cleanly on Ctrl+C. **No
`npm install`, no MongoDB, no `.env` needed.** Open
http://localhost:3000.

Two folders inside, for reference:
- `backend/` — the real API (`server.js`, needs MongoDB + `npm install`)
  plus the zero-setup demo server (`demoServer.js`, no DB, no install)
  that `npm start` actually runs.
- `frontend/` — the web app, rewired so every page reflects what the
  backend actually computes. Officials and citizens now get visibly
  different themes (dark "command console" vs light) the moment you
  log in, not just different buttons on the same look.

## Fastest path to a running demo (recommended for the video)

Same as above — `npm start` or F5. If you'd rather run backend and
frontend in two separate terminals (e.g. to watch backend logs on
their own):

```bash
# terminal 1
cd backend
node demoServer.js

# terminal 2
cd frontend
node server.js
```

Either way, on the login screen leave "Backend" set to the demo
option, and log in as either a Citizen or an Official (register once,
then the same email/password logs back in — tested both ways, see
below).

## Full path (persistent data, real file upload, real JWT auth)

```bash
cd backend
npm install
cp .env.example .env     # fill in MONGODB_URI, JWT_SECRET at minimum
node scripts/seedHistoricalLandslides.js
node server.js
```

Then run the frontend the same way, and switch "Backend" to the full
option (port 5000) on the login screen or in Settings.

## Multi-agency SMS, two-way SMS, and real routing — one-time setup

These features are code-complete and tested, but two of them need a
step beyond `node start-demo.js` to fully light up:

- **Agency dispatch / auto-alerts**: set `POLICE_SMS_NUMBERS`,
  `FIRE_SMS_NUMBERS`, `MEDICAL_SMS_NUMBERS`, `DISASTER_MGMT_SMS_NUMBERS`,
  and `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`
  in `backend/.env`. **Use your own team's phones — never a real public
  emergency number.** Without Twilio configured, every send still shows
  you the exact message that would go out.
- **Reply SAFE/HELP by SMS, no app**: needs a public URL pointed at
  `POST /api/sms/incoming` as your Twilio number's webhook. Locally,
  run `ngrok http 5000` (against the full backend) and paste the
  forwarded URL into Twilio's console.
- **Responder routing**: works out of the box on any machine with
  internet access (it calls OSRM's free public routing API) — no
  setup needed, just real internet.

## Where to look next

- `backend/CHANGES.md` — everything added to the backend across this
  whole project, mapped back to the original 40-point list, with what's
  real vs. simulated/approximate stated plainly.
- `backend/DEMO.md` — a ready-to-run curl script exercising the demo
  backend end to end (this exact script was run before handoff).
- `frontend/README.md` — what each page shows and which backend
  endpoint powers it, plus the known rough edges.

## Honest status

Every backend endpoint used here was hit with real HTTP requests
(`curl` and Node's `fetch`) and confirmed working, including the full
register → dashboard → report → verify → safety-status → alert flow
through both servers running together. Login was specifically
retested end to end for both roles: first-time registration, a
*returning* user logging in (not registering again) for both Citizen
and Official, a wrong password being rejected, and a wrong-role login
attempt — which surfaced a real bug (a confusing "already registered"
message instead of the actual "wrong role" reason), now fixed and
reverified against both backends' exact contracts.

The frontend was never opened in an actual browser in this
environment (no browser available here) — open it yourself first and
watch the console before recording, in case something an HTTP-level
test wouldn't catch (a CSS layout issue, a stray typo in a click
handler) is sitting there.
