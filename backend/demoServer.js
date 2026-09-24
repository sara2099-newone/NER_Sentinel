// ============================================================
// NER Sentinel — DEMO SERVER (for the SIH prototype video)
// ============================================================
// Why this file exists: the full server.js needs MongoDB, a running
// AI microservice, and `npm install` (express/mongoose/etc). That's
// the right architecture for the real product, but it's friction for
// "just show me it working" on demo day. This file needs NONE of
// that — it's plain Node (http + url, both built in) plus the
// service modules that already have zero external dependencies
// (thresholdService, populationService, prioritizationService,
// i18nService, cacheService, geoService, and the fetch-based
// weatherService/rainfallService/satelliteRainfallService/slopeService/
// aiService — all use Node's native `fetch`, no axios).
//
// RUN IT:
//   cd backend
//   node demoServer.js
//   -> listening on http://localhost:5050
// No npm install. No .env required (though it'll use one if present).
//
// WHAT'S ACTUALLY LIVE vs IN-MEMORY:
//   - /api/dashboard/summary makes REAL live calls to Open-Meteo,
//     NASA POWER, and OpenTopoData (needs internet on the machine you
//     run this on). If your AI microservice is running at
//     AI_SERVICE_URL it's used too; if not, risk score gracefully
//     degrades to "Unavailable" and everything else (thresholds,
//     population, priority) still computes.
//   - /api/history/landslides serves the real seeded dataset
//     (data/historicalLandslides.js) directly — no DB needed.
//   - /api/safety/*, /api/incidents/* use a plain in-memory store
//     (a JS array/object) instead of MongoDB — real logic, resets
//     when you restart the process. Good enough to demo the flow on
//     camera; not persistent storage.
//   - /api/alerts/trigger sends a REAL Twilio SMS if TWILIO_* env
//     vars are set, otherwise logs a clearly-marked simulated send —
//     same behavior as the real scheduler.
//   - Auth is intentionally NOT enforced here (no jsonwebtoken dep
//     loaded) — this is a demo server, not something to expose
//     publicly. The real server.js has real auth; this doesn't need
//     it to show the features working.

try {
    require("dotenv").config();
} catch {
    // dotenv isn't installed in zero-install mode — fine, just means
    // env vars come from your shell instead of a .env file.
}

const http = require("http");
const { URL } = require("url");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Real evidence files (photos/videos citizens attach to a report) get
// written here — same idea as the full backend's uploads/ dir
// (middleware/uploadMiddleware.js), just via plain fs instead of
// multer, matching this file's zero-dependency design. Kept separate
// from the full backend's uploads/ dir since the two backends don't
// share storage.
const UPLOAD_DIR = path.join(__dirname, "uploads-demo");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const { getZones, getZoneById } = require("./config/zones");
const { withCache } = require("./services/cacheService");
const getWeatherData = require("./services/weatherService");
const getRainfallData = require("./services/rainfallService");
const { computeCumulativeWindows, computeForecastWindow } = require("./services/rainfallService");
const { getSatelliteRainfall } = require("./services/satelliteRainfallService");
const getSlopeData = require("./services/slopeService");
const aiService = require("./services/aiService");
const { evaluateThresholds } = require("./services/thresholdService");
const { estimateAffectedPopulation } = require("./services/populationService");
const { computePriority, rankByPriority } = require("./services/prioritizationService");
const {
    buildSoilMoisture,
    buildEarlyWarning,
    buildContributingFactors,
    buildDataStatuses
} = require("./services/riskIntelligenceService");
const {
    translateRiskLevel,
    translatePriorityLevel,
    translateSafetyStatus,
    renderMultilingualAlert,
    renderAgencyDispatch,
    SUPPORTED_LOCALES
} = require("./services/i18nService");
const { sendAlertSms } = require("./services/alertService");
const { RECORDS: HISTORICAL_RECORDS } = require("./data/historicalLandslides");
const { countByRadius, findPossiblyAffected } = require("./services/presenceService");
const { getRoute } = require("./services/routingService");
const { getCategories, numbersFor } = require("./config/agencies");
const { record: recordAlertLog, getRecent: getRecentAlerts } = require("./services/alertLogService");
const { calculateDistance } = require("./services/geoService");
const { detectCandidate } = require("./services/candidateIncidentService");
const { generateDemoCitizens } = require("./services/demoCitizenService");
const responseService = require("./services/responseService");

const PORT = process.env.DEMO_PORT || 5050;

// ---- in-memory stores (reset on restart) ----
const incidents = [];
let incidentAutoId = 1;

const safetyStatuses = new Map(); // identity key (userId or "phone:<num>") -> { status, note, lastKnownLocation, updatedAt, source }

// ---- zero-dependency auth (demo only — real server.js uses bcrypt + JWT) ----
const users = []; // { id, name, email, role, passwordHash }
const sessions = new Map(); // token -> user (without passwordHash)

const hashPassword = (password) => crypto.createHash("sha256").update(String(password)).digest("hex");
const makeToken = () => crypto.randomBytes(24).toString("hex");

const userFromRequest = (req) => {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    return token ? sessions.get(token) || null : null;
};

// ---- helpers ----
const sendJson = (res, statusCode, payload) => {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(body);
};

const readRequestBody = (req) =>
    new Promise((resolve, reject) => {
        // BUGFIX: this used to do `raw += chunk`, which implicitly
        // decodes each TCP chunk to a UTF-8 string independently. If a
        // multi-byte character (any of the Bengali/Assamese/Manipuri/
        // Khasi/Mizo script text this app's i18n explicitly supports —
        // see services/i18nService.js — or just an emoji in a citizen
        // note) happened to land across a chunk boundary, each half
        // decoded on its own turns into a mangled replacement character,
        // even though the full byte stream was valid UTF-8. Buffering
        // the raw bytes and decoding once at the end avoids that, and
        // is also what makes real (binary, non-UTF-8) file uploads
        // possible below instead of corrupting them the same way.
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            const buffer = Buffer.concat(chunks);
            if (!buffer.length) return resolve({});
            const contentType = req.headers["content-type"] || "";
            try {
                if (contentType.includes("multipart/form-data")) {
                    // File uploads (POST /api/upload/evidence) need the
                    // raw bytes, not a JSON-parsed object — see
                    // parseMultipart() below, called directly by that
                    // route with this same buffer/contentType.
                    return resolve({ __multipart: true, buffer, contentType });
                }
                const raw = buffer.toString("utf8");
                if (contentType.includes("application/x-www-form-urlencoded")) {
                    // Twilio's webhook posts this format, not JSON.
                    resolve(Object.fromEntries(new URLSearchParams(raw)));
                } else {
                    resolve(JSON.parse(raw));
                }
            } catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });

// Zero-dependency multipart/form-data parser (no multer/busboy) — kept
// consistent with this file's "no npm install" design goal. Operates
// on Buffers throughout (never converts the whole body to a string)
// so binary file content (images/video) isn't corrupted. Mirrors the
// real backend's contract (middleware/uploadMiddleware.js): only the
// "evidence" field, only image/* or video/* mimetypes, max 25MB/file,
// max 5 files.
const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_FILE_BYTES = 25 * 1024 * 1024;

const parseMultipart = (buffer, contentType) => {
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
    const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim() : null;
    if (!boundary) throw new Error("Malformed multipart request: no boundary");

    const boundaryBuf = Buffer.from(`--${boundary}`);
    const fields = {};
    const files = [];

    let start = buffer.indexOf(boundaryBuf);
    if (start === -1) throw new Error("Malformed multipart request: boundary not found");
    start += boundaryBuf.length;

    while (true) {
        // Skip the trailing CRLF after the boundary line, or stop at "--" (final boundary).
        if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break; // "--" = end
        start += 2; // CRLF

        const nextBoundary = buffer.indexOf(boundaryBuf, start);
        if (nextBoundary === -1) break;
        // Each part ends 2 bytes before the next boundary (its own trailing CRLF).
        const part = buffer.slice(start, nextBoundary - 2);

        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
            const headerText = part.slice(0, headerEnd).toString("utf8");
            const body = part.slice(headerEnd + 4);

            const nameMatch = /name="([^"]+)"/i.exec(headerText);
            const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
            const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
            const fieldName = nameMatch ? nameMatch[1] : null;

            if (fieldName && filenameMatch) {
                if (filenameMatch[1]) {
                    files.push({
                        fieldName,
                        originalName: filenameMatch[1],
                        mimetype: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
                        buffer: body
                    });
                }
                // filenameMatch[1] === "" means the field was present but
                // no file chosen — nothing to add, and not a form field either.
            } else if (fieldName) {
                fields[fieldName] = body.toString("utf8");
            }
        }

        start = nextBoundary + boundaryBuf.length;
    }

    return { fields, files };
};

const heuristicRoadStatus = (priorityLevel) => {
    if (priorityLevel === "Critical") return "Caution advised — high-risk zone";
    if (priorityLevel === "High") return "Monitor — elevated risk";
    return "No known issues reported";
};

const WEATHER_TTL_MS = 5 * 60 * 1000;
const RAINFALL_TTL_MS = 5 * 60 * 1000;
const SATELLITE_TTL_MS = 30 * 60 * 1000;
const SLOPE_TTL_MS = 24 * 60 * 60 * 1000;

const buildZoneSummary = async (zone, locale = "en") => {
    const summary = { zoneId: zone.id, zoneName: zone.name, district: zone.district || null, lat: zone.lat, lng: zone.lng };

    let weather = null;
    let rainfall = null;
    let satelliteRainfall = null;
    let slope = null;
    let weatherFresh = true;
    let rainfallFresh = true;
    let satelliteFresh = true;
    let slopeFresh = true;

    try {
        const cached = await withCache("weather", zone.lat, zone.lng, WEATHER_TTL_MS, () =>
            getWeatherData(zone.lat, zone.lng)
        );
        weather = cached.data;
        weatherFresh = !cached.cached;
    } catch (error) {
        summary.weatherError = error.message;
    }

    try {
        const cached = await withCache("rainfall", zone.lat, zone.lng, RAINFALL_TTL_MS, () =>
            getRainfallData(zone.lat, zone.lng)
        );
        rainfall = cached.data;
        rainfallFresh = !cached.cached;
    } catch (error) {
        summary.rainfallError = error.message;
    }

    try {
        const cached = await withCache("satellite", zone.lat, zone.lng, SATELLITE_TTL_MS, () =>
            getSatelliteRainfall(zone.lat, zone.lng)
        );
        satelliteRainfall = cached.data;
        satelliteFresh = !cached.cached;
    } catch (error) {
        summary.satelliteRainfallError = error.message;
    }

    try {
        const cached = await withCache("slope", zone.lat, zone.lng, SLOPE_TTL_MS, () =>
            getSlopeData(zone.lat, zone.lng)
        );
        slope = cached.data;
        slopeFresh = !cached.cached;
    } catch (error) {
        summary.slopeError = error.message;
    }

    // rainfall.utcOffsetSeconds is the LOCATION's own UTC offset (from
    // Open-Meteo) — required to correctly find "now" inside the hourly
    // series. See services/rainfallService.js for why this matters.
    const cumulativeRainfall = rainfall ? computeCumulativeWindows(rainfall.hourly, rainfall.utcOffsetSeconds) : null;
    const forecastRainfallNext24hMm = rainfall ? computeForecastWindow(rainfall.hourly, rainfall.utcOffsetSeconds, 24) : null;

    const soilMoisture = buildSoilMoisture({ weather, cumulativeRainfall });
    const soilMoisturePercent = soilMoisture.value;

    const thresholdResult = evaluateThresholds({
        cumulativeRainfall: cumulativeRainfall || {},
        slopeDegrees: slope?.slopeDegrees ?? null,
        soilMoisturePercent
    });

    let riskScore = 0;
    let riskLevel = "Unavailable";
    let aiExplainability = null;

    if (slope && weather) {
        try {
            const { status, data } = await aiService.getPrediction({
                latitude: zone.lat,
                longitude: zone.lng,
                elevation_m: slope.elevation,
                slope_degrees: slope.slopeDegrees,
                temperature_c: weather.current?.temperature_2m,
                humidity_percent: weather.current?.relative_humidity_2m,
                rainfall_24h_mm: cumulativeRainfall?.["24h"],
                soil_moisture_percent: soilMoisturePercent
            });

            if (status === 200 && data) {
                riskScore = typeof data.risk_score === "number" ? data.risk_score : 0;
                riskLevel = data.risk_level || "Unknown";
                aiExplainability = {
                    confidence: data.confidence ?? null,
                    contributingFactors: data.contributing_factors ?? null
                };
            } else {
                summary.aiError = data?.message || `AI service returned ${status}`;
            }
        } catch (error) {
            summary.aiError = `AI service unreachable (${error.message}) — is it running at AI_SERVICE_URL?`;
        }
    }

    const population = estimateAffectedPopulation(zone.lat, zone.lng, 5);
    const priority = computePriority({
        riskScore,
        isCritical: thresholdResult.isCritical,
        estimatedPopulation: population.estimatedPopulation
    });

    const roadStatus = {
        value: heuristicRoadStatus(priority.priorityLevel),
        isHeuristic: true,
        note: "Derived from priority level, not live traffic data."
    };

    const contributingFactors = buildContributingFactors({
        cumulativeRainfall,
        soilMoisture,
        slopeDegrees: slope?.slopeDegrees ?? null,
        population,
        roadStatus
    });

    const earlyWarning = buildEarlyWarning({
        cumulativeRainfall: cumulativeRainfall || {},
        slopeDegrees: slope?.slopeDegrees ?? null,
        soilMoisture,
        thresholds: thresholdResult,
        riskLevel
    });

    const dataStatus = buildDataStatuses({
        weatherFresh, weatherError: summary.weatherError,
        rainfallFresh, rainfallError: summary.rainfallError,
        satelliteRainfall, satelliteRainfallError: summary.satelliteRainfallError, satelliteFresh,
        soilMoistureStatus: soilMoisture.status,
        slopeError: summary.slopeError, slopeFresh,
        aiAvailable: riskLevel !== "Unavailable" && !summary.aiError,
        aiError: summary.aiError
    });
    dataStatus.forecast = rainfallFresh && !summary.rainfallError ? "LIVE" : "UNAVAILABLE";

    return {
        ...summary,
        riskScore,
        riskLevel,
        riskLevelLocalized: translateRiskLevel(riskLevel, locale),
        aiExplainability,
        thresholds: thresholdResult,
        cumulativeRainfallMm: cumulativeRainfall,
        forecast: {
            rainfallNext24hMm: forecastRainfallNext24hMm,
            windowHours: 24,
            source: "Open-Meteo forecast (same call as current rainfall/weather)",
            status: dataStatus.forecast
        },
        weather: weather
            ? {
                  temperatureC: weather.current?.temperature_2m ?? null,
                  humidityPercent: weather.current?.relative_humidity_2m ?? null,
                  precipitationMm: weather.current?.precipitation ?? null
              }
            : null,
        satelliteRainfall,
        soilMoisture,
        slopeDegrees: slope?.slopeDegrees ?? null,
        elevation: slope?.elevation ?? null,
        population,
        priorityScore: priority.priorityScore,
        priorityLevel: priority.priorityLevel,
        priorityLevelLocalized: translatePriorityLevel(priority.priorityLevel, locale),
        roadStatus,
        contributingFactors: contributingFactors.factors,
        riskExplanation: contributingFactors.explanation,
        earlyWarning,
        dataStatus,
        lastUpdated: new Date().toISOString(),
        perimeter: { radiusKm: 5, estimatedPopulation: population.estimatedPopulation }
    };
};

// ---- routes ----
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route("GET", /^\/$/, async (req, res) => {
    sendJson(res, 200, {
        message: "NER Sentinel DEMO server — no DB, no npm install, real live data where possible.",
        endpoints: [
            "POST /api/auth/register  { name, email, password, role: 'Citizen'|'Official' }",
            "POST /api/auth/login     { email, password }",
            "GET  /api/auth/me        (Authorization: Bearer <token>)",
            "GET  /api/dashboard/summary?locale=hi",
            "GET  /api/history/landslides?state=Mizoram",
            "POST /api/safety/status   { status: 'Safe'|'NeedHelp', note, lat, lng } (auth optional, or pass userId)",
            "POST /api/safety/location   { lat, lng } (auth optional, or pass userId) — location-only ping, doesn't change status",
            "GET  /api/safety/needs-help   (Official)",
            "GET  /api/demo/citizens?zoneId=shillong   5km Citizen Zone — DEMO/SIMULATED roster, weighted by real priority level",
            "POST /api/incidents       { reportedBy, description, lat, lng, evidence }",
            "POST /api/upload/evidence  multipart/form-data, field 'evidence' (up to 5 images/videos, 25MB each) -> { urls }",
            "GET  /api/incidents",
            "PUT  /api/incidents/:id/status    { status: 'Verified'|'Rejected' }  (Official)",
            "PUT  /api/incidents/:id/evidence  { urls: [...] }  (Official)",
            "POST /api/alerts/trigger  { zoneId, locales: ['en','hi'], recipients: ['+91...'] }  (Official)",
            "--- RESPONSE workflow (Official, DEMO DISPATCH — no real SMS/WhatsApp/email) ---",
            "GET  /api/response/departments",
            "GET  /api/response/teams?zoneId=shillong",
            "GET  /api/response/incidents",
            "POST /api/response/trigger-critical-risk  { zoneId }",
            "POST /api/response/trigger-landslide      { zoneId }  -> creates incident + DEMO DISPATCH alerts to 8 departments",
            "PUT  /api/response/incidents/:id/alerts/:alertId  { status: 'ACKNOWLEDGED'|'RESPONDING'|'RESOLVED' }",
            "POST /api/response/teams/:teamId/dispatch  { incidentId }  -> real OSRM route, shortest vs low-risk",
            "PUT  /api/response/teams/:teamId/status    { status: 'DISPATCHED'|'EN_ROUTE'|'ARRIVED'|'RESOLVED' }",
            "POST /api/response/incidents/:id/complete",
            "POST /api/demo/help-requests  { zoneId, count }"
        ]
    });
});

route("POST", /^\/api\/auth\/register$/, async (req, res, query, params, body) => {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = body.role === "Official" ? "Official" : "Citizen";

    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
        return sendJson(res, 400, { message: "name, a valid email, and a password of at least 6 characters are required" });
    }
    if (users.some((u) => u.email === email)) {
        return sendJson(res, 409, { message: "An account with this email already exists" });
    }

    const user = { id: crypto.randomUUID(), name, email, role, passwordHash: hashPassword(password) };
    users.push(user);

    const token = makeToken();
    const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    sessions.set(token, publicUser);

    sendJson(res, 201, { token, user: publicUser });
});

route("POST", /^\/api\/auth\/login$/, async (req, res, query, params, body) => {
    const email = String(body.email || "").trim().toLowerCase();
    const role = body.role;
    const user = users.find((u) => u.email === email && u.passwordHash === hashPassword(body.password || ""));
    if (!user) return sendJson(res, 401, { message: "Incorrect email or password" });

    // Mirror the real backend's authRoutes.js: a selected role that
    // doesn't match the stored account role is a real, actionable error
    // (wrong workspace chosen) — not silently logging them in under
    // their actual role. The frontend's loginOrRegister() explicitly
    // relies on this 403 to surface that message; without it (as here,
    // previously) this endpoint just ignored `role` entirely, so
    // choosing the wrong workspace on the demo backend silently logged
    // the user in under whatever role they actually registered as
    // instead of erroring like the full backend does.
    if (role && ["Citizen", "Official"].includes(role) && user.role !== role) {
        return sendJson(res, 403, { message: "Selected role does not match your account" });
    }

    const token = makeToken();
    const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    sessions.set(token, publicUser);

    sendJson(res, 200, { token, user: publicUser });
});

route("GET", /^\/api\/auth\/me$/, async (req, res) => {
    const user = userFromRequest(req);
    if (!user) return sendJson(res, 401, { message: "Not authenticated" });
    sendJson(res, 200, { user });
});

route("GET", /^\/api\/dashboard\/summary$/, async (req, res, query) => {
    const locale = SUPPORTED_LOCALES.includes(query.get("locale")) ? query.get("locale") : "en";
    const zones = getZones();
    const summaries = await Promise.all(zones.map((z) => buildZoneSummary(z, locale)));
    sendJson(res, 200, {
        message: "Live-computed dashboard summary",
        locale,
        generatedAt: new Date().toISOString(),
        count: summaries.length,
        data: rankByPriority(summaries)
    });
});

route("GET", /^\/api\/history\/landslides$/, async (req, res, query) => {
    const state = query.get("state");
    const records = HISTORICAL_RECORDS.filter((r) => !state || r.state === state).sort(
        (a, b) => b.date - a.date
    );
    sendJson(res, 200, { count: records.length, data: records });
});

route("POST", /^\/api\/safety\/status$/, async (req, res, query, params, body) => {
    const authedUser = userFromRequest(req);
    const userId = authedUser?.id || body.userId;
    const { status, note, lat, lng, phone } = body;

    if (!userId || !["Safe", "NeedHelp"].includes(status)) {
        return sendJson(res, 400, { message: "an authenticated user (or a userId in the body) and status ('Safe'|'NeedHelp') are required" });
    }
    const record = {
        userId,
        name: authedUser?.name,
        phone: phone || null,
        source: "app",
        status,
        note: note || "",
        lastKnownLocation: lat !== undefined && lng !== undefined ? { lat, lng, capturedAt: new Date() } : null,
        updatedAt: new Date()
    };
    safetyStatuses.set(userId, record);
    sendJson(res, 200, {
        message: "Safety status updated",
        data: record,
        statusLabelLocalized: translateSafetyStatus(status, SUPPORTED_LOCALES.includes(query.get("locale")) ? query.get("locale") : "en")
    });
});

// Location-only ping, without changing status (e.g. a periodic
// background update while status stays "Safe"). Mirrors the real
// backend's POST /api/safety/location (routes/safetyRoutes.js) — this
// was missing from the demo server, so the frontend's "keep sharing
// live location" toggle (initSafetyPage in app.js) 404'd whenever a
// citizen was demoing against the zero-setup backend.
route("POST", /^\/api\/safety\/location$/, async (req, res, query, params, body) => {
    const authedUser = userFromRequest(req);
    const userId = authedUser?.id || body.userId;
    const { lat, lng } = body;

    if (!userId) {
        return sendJson(res, 400, { message: "an authenticated user (or a userId in the body) is required" });
    }
    if (lat === undefined || lng === undefined) {
        return sendJson(res, 400, { message: "lat and lng are required" });
    }

    const existing = safetyStatuses.get(userId) || {
        userId,
        name: authedUser?.name,
        phone: null,
        source: "app",
        status: "Safe",
        note: ""
    };
    const record = {
        ...existing,
        lastKnownLocation: { lat: Number(lat), lng: Number(lng), capturedAt: new Date() },
        updatedAt: new Date()
    };
    safetyStatuses.set(userId, record);
    sendJson(res, 200, { message: "Location updated", data: record });
});

route("GET", /^\/api\/safety\/needs-help$/, async (req, res) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });
    const needHelp = [...safetyStatuses.values()].filter((s) => s.status === "NeedHelp");
    sendJson(res, 200, { count: needHelp.length, data: needHelp });
});

// Real (not estimated) headcount of citizens who've reported a status
// within radiusKm of a point — see presenceService.js.
route("GET", /^\/api\/safety\/count$/, async (req, res, query) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });

    const lat = Number(query.get("lat"));
    const lng = Number(query.get("lng"));
    const radiusKm = Number(query.get("radiusKm")) || 5;
    if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJson(res, 400, { message: "lat and lng query params are required" });

    const records = [...safetyStatuses.values()]
        .filter((s) => s.lastKnownLocation)
        .map((s) => ({ lat: s.lastKnownLocation.lat, lng: s.lastKnownLocation.lng, status: s.status, updatedAt: s.updatedAt }));

    sendJson(res, 200, countByRadius(records, lat, lng, radiusKm));
});

// Citizens possibly affected — inside the radius, NeedHelp or silent
// since sinceCutoff. Honest proxy built from real app/SMS reports only.
route("GET", /^\/api\/safety\/possibly-affected$/, async (req, res, query) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });

    const lat = Number(query.get("lat"));
    const lng = Number(query.get("lng"));
    const radiusKm = Number(query.get("radiusKm")) || 5;
    const sinceCutoff = query.get("sinceCutoff");
    if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJson(res, 400, { message: "lat and lng query params are required" });

    const records = [...safetyStatuses.values()]
        .filter((s) => s.lastKnownLocation)
        .map((s) => ({
            lat: s.lastKnownLocation.lat,
            lng: s.lastKnownLocation.lng,
            status: s.status,
            updatedAt: s.updatedAt,
            name: s.name || s.phone || "Unknown",
            source: s.source
        }));

    const affected = findPossiblyAffected(records, lat, lng, radiusKm, sinceCutoff);
    sendJson(res, 200, {
        count: affected.length,
        data: affected,
        method: "Real app/SMS reports only — not telecom-level tracking."
    });
});

// 5km Citizen Zone — DEMO/SIMULATED roster for a zone, used when a
// critical incident is selected on the Risk Map. Clearly labeled demo
// data (see services/demoCitizenService.js for why: no real telecom
// tracking exists here). Public — citizens viewing the map need this
// too, not just Officials.
route("GET", /^\/api\/demo\/citizens$/, async (req, res, query) => {
    const zoneId = query.get("zoneId");
    const zone = getZoneById(zoneId);
    if (!zone) return sendJson(res, 400, { message: "zoneId not recognised" });

    let priorityLevel = "Low";
    try {
        const summary = await buildZoneSummary(zone, "en");
        priorityLevel = summary.priorityLevel || "Low";
    } catch {
        // fall back to Low weighting if the live pipeline is unreachable — still clearly labeled demo either way
    }

    const result = generateDemoCitizens({
        zoneId: zone.id,
        zoneName: zone.name,
        lat: zone.lat,
        lng: zone.lng,
        priorityLevel,
        radiusKm: 5
    });
    sendJson(res, 200, result);
});

// Twilio incoming-SMS webhook — reply SAFE or HELP by plain text, no
// app needed. Same setup requirement as the real backend: Twilio needs
// a public URL (ngrok) to reach this locally. /simulate below runs the
// identical processing function from an authenticated UI button, so
// this is demoable today without ngrok+Twilio configured first.
const HELP_KEYWORDS = ["help", "मदद", "সাহায্য", "সহায়"];
const SAFE_KEYWORDS = ["safe", "सुरक्षित", "সুরক্ষিত"];

const processIncomingSms = (from, bodyText) => {
    const lower = (bodyText || "").toLowerCase().trim();
    const status = HELP_KEYWORDS.some((k) => lower.includes(k)) ? "NeedHelp" : SAFE_KEYWORDS.some((k) => lower.includes(k)) ? "Safe" : null;

    if (!from) return { ok: false, reply: "Could not identify sender." };
    if (!status) return { ok: false, reply: "NER Sentinel: reply SAFE if you're okay, or HELP if you need assistance." };

    const record = {
        phone: from,
        source: "sms",
        status,
        note: `Via SMS: "${bodyText}"`,
        lastKnownLocation: null,
        updatedAt: new Date()
    };
    safetyStatuses.set(`phone:${from}`, record);

    const reply =
        status === "NeedHelp"
            ? "NER Sentinel: Received — you've been marked as needing help. Responders have been notified."
            : "NER Sentinel: Received — you've been marked as safe. Thank you.";
    return { ok: true, status, reply, record };
};

route("POST", /^\/api\/sms\/incoming$/, async (req, res, query, params, body) => {
    const result = processIncomingSms(body.From, body.Body);
    res.writeHead(200, { "Content-Type": "text/xml", "Access-Control-Allow-Origin": "*" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${result.reply.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message></Response>`);
});

// Authenticated UI trigger for the SAME processIncomingSms() function
// above — demos "reply SAFE/HELP by SMS" without needing a real
// Twilio webhook wired up first.
route("POST", /^\/api\/sms\/simulate$/, async (req, res, query, params, body) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });

    const result = processIncomingSms(body.from, body.body || "");
    sendJson(res, 200, { message: "Simulated SMS processed (same code path as a real Twilio webhook call)", ...result });
});

// Responder routing — real OSRM road routing (Official-only).
route("GET", /^\/api\/route$/, async (req, res, query) => {
    const user = userFromRequest(req);
    if (!user) return sendJson(res, 401, { message: "Authentication required" });

    const fromLat = Number(query.get("fromLat"));
    const fromLng = Number(query.get("fromLng"));
    const toZoneId = query.get("toZoneId");
    const destination = getZones().find((z) => z.id === toZoneId);
    if (!destination) return sendJson(res, 400, { message: "toZoneId not recognised" });
    if (Number.isNaN(fromLat) || Number.isNaN(fromLng)) return sendJson(res, 400, { message: "fromLat and fromLng query params are required" });

    try {
        const otherZones = getZones().filter((z) => z.id !== toZoneId).map((z) => ({ zoneName: z.name, lat: z.lat, lng: z.lng }));
        const result = await getRoute(fromLat, fromLng, destination.lat, destination.lng, otherZones);
        sendJson(res, 200, { destination: destination.name, ...result });
    } catch (error) {
        // Graceful straight-line fallback when OSRM is unreachable (no
        // internet, firewall, etc.) — never leave the panel with
        // nothing but an error. Clearly labeled as simulated.
        try {
            const straightKm = calculateDistance(fromLat, fromLng, destination.lat, destination.lng);
            sendJson(res, 200, {
                destination: destination.name,
                simulated: true,
                error: error.message,
                routes: [
                    {
                        index: 0,
                        distanceKm: straightKm,
                        durationMin: Math.round((straightKm / 40) * 60), // assumes ~40km/h average on hill roads
                        geometry: { type: "LineString", coordinates: [[fromLng, fromLat], [destination.lng, destination.lat]] },
                        riskAdvisory: "Simulated straight-line estimate — live road routing unavailable right now.",
                        hazardProximity: []
                    }
                ],
                recommendedIndex: 0,
                source: "Simulated (straight-line distance) — OSRM's public routing server could not be reached",
                note: "This is a fallback estimate, not a real route. It appears automatically whenever live routing is unreachable, so the panel never just shows an error."
            });
        } catch (fallbackError) {
            sendJson(res, 502, { message: "Routing failed", error: error.message });
        }
    }
});

// Agency categories + multi-agency dispatch (Official-only).
route("GET", /^\/api\/alerts\/agencies$/, async (req, res) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });
    sendJson(res, 200, { data: getCategories() });
});

route("GET", /^\/api\/alerts\/log$/, async (req, res, query) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });
    sendJson(res, 200, { data: getRecentAlerts(Number(query.get("limit")) || 30) });
});

route("POST", /^\/api\/alerts\/dispatch-agencies$/, async (req, res, query, params, body) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });

    const { zoneId, agencies = [], reason = "manually dispatched", population = "unknown", locale = "en" } = body;
    const zone = getZoneById(zoneId) || { name: zoneId || "Unnamed zone" };
    const useLocale = SUPPORTED_LOCALES.includes(locale) ? locale : "en";
    if (!agencies.length) return sendJson(res, 400, { message: "agencies must be a non-empty array" });

    const results = [];
    for (const agencyId of agencies) {
        const numbers = numbersFor(agencyId);
        const message = renderAgencyDispatch(useLocale, { agency: agencyId, zone: zone.name, reason, population });
        if (!numbers.length) {
            results.push({ agency: agencyId, sent: false, reason: `No numbers configured (${agencyId.toUpperCase()}_SMS_NUMBERS is empty)`, wouldSend: message });
            recordAlertLog({ type: "agency-dispatch", zoneName: zone.name, agency: agencyId, message, sent: false, recipients: 0, note: "not configured" });
            continue;
        }
        const smsResult = await sendAlertSms(numbers, message);
        results.push({ agency: agencyId, sent: !smsResult.simulated, message, smsResult });
        recordAlertLog({ type: "agency-dispatch", zoneName: zone.name, agency: agencyId, message, sent: !smsResult.simulated, recipients: numbers.length });
    }
    sendJson(res, 200, { message: "Agency dispatch attempted", results });
});

route("POST", /^\/api\/incidents$/, async (req, res, query, params, body) => {
    const authedUser = userFromRequest(req);
    const reportedBy = authedUser?.name || body.reportedBy || "Citizen";
    const { description, location, evidence = [] } = body;
    if (!description || !location || location.lat === undefined || location.lng === undefined) {
        return sendJson(res, 400, { message: "description and location {lat,lng} are required" });
    }
    const incident = {
        _id: String(incidentAutoId++),
        reportedBy,
        description,
        location,
        evidence,
        status: "Pending",
        createdAt: new Date()
    };
    incidents.push(incident);
    sendJson(res, 201, { message: "Incident reported", incident });
});

route("GET", /^\/api\/incidents$/, async (req, res) => {
    sendJson(res, 200, { count: incidents.length, data: incidents });
});

route("PUT", /^\/api\/incidents\/([^/]+)\/status$/, async (req, res, query, params, body) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });

    const incident = incidents.find((i) => i._id === params[0]);
    if (!incident) return sendJson(res, 404, { message: "Incident not found" });
    if (!["Verified", "Rejected"].includes(body.status)) {
        return sendJson(res, 400, { message: "status must be 'Verified' or 'Rejected'" });
    }
    incident.status = body.status;
    sendJson(res, 200, { message: "Incident status updated", incident });
});

route("PUT", /^\/api\/incidents\/([^/]+)\/evidence$/, async (req, res, query, params, body) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });

    const incident = incidents.find((i) => i._id === params[0]);
    if (!incident) return sendJson(res, 404, { message: "Incident not found" });
    if (!Array.isArray(body.urls) || !body.urls.length) {
        return sendJson(res, 400, { message: "urls must be a non-empty array" });
    }
    incident.evidence = [...(incident.evidence || []), ...body.urls];
    sendJson(res, 200, { message: "Field evidence attached", incident });
});

route("POST", /^\/api\/alerts\/trigger$/, async (req, res, query, params, body) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });

    const { zoneId, locales = ["en", "hi"], recipients = [] } = body;
    const zone = getZoneById(zoneId) || { name: zoneId || "Demo Zone" };

    const message = renderMultilingualAlert(
        locales.filter((l) => SUPPORTED_LOCALES.includes(l)),
        { zone: zone.name, rules: "manually_triggered_demo" }
    );

    const configuredRecipients =
        recipients.length ? recipients : (process.env.ALERT_SMS_RECIPIENTS || "").split(",").map((n) => n.trim()).filter(Boolean);

    if (!configuredRecipients.length) {
        recordAlertLog({ type: "manual-trigger", zoneName: zone.name, trigger: "manually_triggered_demo", message, sent: false, recipients: 0, note: "no recipients configured" });
        return sendJson(res, 200, {
            message: "No recipients given and no ALERT_SMS_RECIPIENTS set — showing the message that would be sent",
            wouldSend: message
        });
    }

    const result = await sendAlertSms(configuredRecipients, message);
    recordAlertLog({ type: "manual-trigger", zoneName: zone.name, trigger: "manually_triggered_demo", message, sent: !result.simulated, recipients: configuredRecipients.length });
    sendJson(res, 200, { message: "Alert dispatch attempted", result, alertText: message });
});

// Periodic auto-threshold check, mirroring the real backend's
// scheduler — every 5 minutes here (10 in the real one), using the
// same threshold logic and logging to the same alert log so an
// automatic dispatch is genuinely visible in the UI, not just a
// server-side console line.
const autoAlertRecipients = (process.env.ALERT_SMS_RECIPIENTS || "").split(",").map((n) => n.trim()).filter(Boolean);
const autoAlertLocales = (process.env.ALERT_SMS_LOCALES || "en,hi").split(",").map((l) => l.trim()).filter((l) => SUPPORTED_LOCALES.includes(l));

// In-memory risk-score history per zone — same purpose as the real
// backend's WeatherData snapshots, just kept in memory here since this
// server has no DB. Capped so it doesn't grow unbounded in a
// long-running demo session.
const riskHistory = new Map(); // zoneId -> [{ observedAt, riskScore, riskLevel }]
const MAX_HISTORY_POINTS = 500;

const runAutoThresholdCheck = async () => {
    for (const zone of getZones()) {
        try {
            const summary = await buildZoneSummary(zone, "en");

            // Record a history point every cycle, critical or not —
            // this is what backs the risk-trend chart.
            const points = riskHistory.get(zone.id) || [];
            points.push({ observedAt: new Date(), riskScore: summary.riskScore, riskLevel: summary.riskLevel });
            if (points.length > MAX_HISTORY_POINTS) points.shift();
            riskHistory.set(zone.id, points);

            if (!summary.thresholds?.isCritical) continue;

            const trigger = summary.thresholds.triggeredRules.map((r) => r.rule).join(", ");
            const message = renderMultilingualAlert(autoAlertLocales.length ? autoAlertLocales : ["en"], { zone: zone.name, rules: trigger });

            if (!autoAlertRecipients.length) {
                recordAlertLog({ type: "auto-threshold", zoneName: zone.name, trigger, message: null, sent: false, recipients: 0, note: "ALERT_SMS_RECIPIENTS not configured" });
                continue;
            }
            const result = await sendAlertSms(autoAlertRecipients, message);
            recordAlertLog({ type: "auto-threshold", zoneName: zone.name, trigger, message, sent: !result.simulated, recipients: autoAlertRecipients.length });
        } catch (error) {
            console.error(`Auto-threshold check failed for ${zone.name}:`, error.message);
        }
    }
};
setInterval(runAutoThresholdCheck, 5 * 60 * 1000);
runAutoThresholdCheck(); // also take one snapshot immediately on boot, don't make the demo wait 5 minutes for the first data point

route("GET", /^\/api\/risk-history$/, async (req, res, query) => {
    const zoneId = query.get("zoneId") || getZones()[0]?.id;
    const zone = getZones().find((z) => z.id === zoneId);
    if (!zone) return sendJson(res, 400, { message: "zoneId not recognised" });

    const hours = Math.min(Math.max(Number(query.get("hours")) || 24, 1), 72);
    const since = Date.now() - hours * 60 * 60 * 1000;
    const points = (riskHistory.get(zone.id) || []).filter((p) => p.observedAt.getTime() >= since);

    sendJson(res, 200, {
        zone: zone.name,
        hours,
        points,
        note: points.length ? undefined : "No snapshots yet — this demo server takes one every 5 minutes plus one on boot; give it a little time."
    });
});

route("POST", /^\/api\/intelligence\/candidate$/, async (req, res, query, params, body) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") return sendJson(res, 403, { message: "This action requires an authenticated Official account" });

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJson(res, 400, { message: "lat and lng are required" });

    try {
        const countNearbyPending = async (nlat, nlng) =>
            incidents.filter((i) => i.status === "Pending" && i.location && calculateDistance(i.location.lat, i.location.lng, nlat, nlng) <= 5).length;
        const result = await detectCandidate(lat, lng, countNearbyPending);
        sendJson(res, 200, result);
    } catch (error) {
        sendJson(res, 502, { message: "Candidate detection failed", error: error.message });
    }
});

// ============================================================
// RESPONSE workflow — department alerts, response teams, real OSRM
// routing (shortest vs. low-risk), and DISPATCHED -> EN ROUTE ->
// ARRIVED -> RESOLVED status. All logic lives in responseService.js;
// these routes are thin wrappers (Official-only, same pattern as the
// rest of this file). See responseService.js for the honesty notes on
// what's real (routing) vs. simulated (department "sends", team GPS).
// ============================================================
const requireOfficial = (req, res) => {
    const user = userFromRequest(req);
    if (!user || user.role !== "Official") {
        sendJson(res, 403, { message: "This action requires an authenticated Official account" });
        return null;
    }
    return user;
};

route("GET", /^\/api\/response\/departments$/, async (req, res) => {
    sendJson(res, 200, { data: require("./config/departments").DEPARTMENTS });
});

route("GET", /^\/api\/response\/teams$/, async (req, res, query) => {
    if (!requireOfficial(req, res)) return;
    sendJson(res, 200, { data: responseService.listTeams(query.get("zoneId") || undefined) });
});

route("GET", /^\/api\/response\/incidents$/, async (req, res) => {
    if (!requireOfficial(req, res)) return;
    sendJson(res, 200, { data: responseService.listIncidents() });
});

route("GET", /^\/api\/response\/incidents\/([^/]+)$/, async (req, res, query, params) => {
    if (!requireOfficial(req, res)) return;
    const incident = responseService.getIncident(params[0]);
    if (!incident) return sendJson(res, 404, { message: "incident not found" });
    sendJson(res, 200, { data: incident });
});

// DEMO SIMULATION control: "Trigger Critical Risk". Does not touch the
// real live Risk Map / dashboard data — it only marks a zone so the
// response-workflow demo controls have something to act on next.
route("POST", /^\/api\/response\/trigger-critical-risk$/, async (req, res, query, params, body) => {
    if (!requireOfficial(req, res)) return;
    try {
        const data = responseService.triggerCriticalRisk(body.zoneId);
        sendJson(res, 200, { message: `Critical risk simulated for ${data.zoneName} (DEMO/SIMULATED)`, data });
    } catch (error) {
        sendJson(res, 400, { message: error.message });
    }
});

// DEMO SIMULATION control: "Trigger Landslide". Creates the emergency
// incident and immediately fires DEMO DISPATCH department alerts
// (SENT) to all 8 departments — this is the "when a landslide becomes
// critical, create an emergency alert for..." step.
route("POST", /^\/api\/response\/trigger-landslide$/, async (req, res, query, params, body) => {
    if (!requireOfficial(req, res)) return;
    try {
        const incident = responseService.triggerLandslide(body.zoneId);
        sendJson(res, 201, { message: `Landslide incident created for ${incident.zoneName} — department alerts dispatched (DEMO DISPATCH)`, data: incident });
    } catch (error) {
        sendJson(res, 400, { message: error.message });
    }
});

// Advance a single department alert: ACKNOWLEDGED | RESPONDING | RESOLVED
route("PUT", /^\/api\/response\/incidents\/([^/]+)\/alerts\/([^/]+)$/, async (req, res, query, params, body) => {
    if (!requireOfficial(req, res)) return;
    try {
        const alert = responseService.updateAlertStatus(params[0], params[1], body.status);
        sendJson(res, 200, { message: "Department alert status updated", data: alert });
    } catch (error) {
        sendJson(res, 400, { message: error.message });
    }
});

// DEMO SIMULATION control: "Dispatch Team". Assigns the team to the
// incident and computes a REAL OSRM route (shortest vs. low-risk) —
// see responseService.buildRoutePlan().
route("POST", /^\/api\/response\/teams\/([^/]+)\/dispatch$/, async (req, res, query, params, body) => {
    if (!requireOfficial(req, res)) return;
    try {
        const team = await responseService.dispatchTeam(params[0], body.incidentId);
        sendJson(res, 200, { message: `${team.name} dispatched (DEMO)`, data: team });
    } catch (error) {
        sendJson(res, 400, { message: error.message });
    }
});

// Response status: DISPATCHED -> EN ROUTE -> ARRIVED -> RESOLVED
route("PUT", /^\/api\/response\/teams\/([^/]+)\/status$/, async (req, res, query, params, body) => {
    if (!requireOfficial(req, res)) return;
    try {
        const team = responseService.updateTeamStatus(params[0], body.status);
        sendJson(res, 200, { message: `Team status updated to ${team.statusLabel}`, data: team });
    } catch (error) {
        sendJson(res, 400, { message: error.message });
    }
});

// DEMO SIMULATION control: "Complete Incident" — force-resolves the
// incident, every department alert on it, and every assigned team.
route("POST", /^\/api\/response\/incidents\/([^/]+)\/complete$/, async (req, res, query, params) => {
    if (!requireOfficial(req, res)) return;
    try {
        const incident = responseService.completeIncident(params[0]);
        sendJson(res, 200, { message: "Incident marked resolved — all department alerts and teams closed out", data: incident });
    } catch (error) {
        sendJson(res, 400, { message: error.message });
    }
});

// DEMO SIMULATION control: "Generate Help Requests" — inserts N
// NeedHelp citizen-safety records around a zone into the SAME
// safetyStatuses store the real "people who need help" feature reads
// from (Do NOT rebuild Citizen Safety — this reuses it). Clearly
// tagged demo:true / source:"demo" so it's never confused with a real
// citizen report.
route("POST", /^\/api\/demo\/help-requests$/, async (req, res, query, params, body) => {
    if (!requireOfficial(req, res)) return;
    const zone = getZoneById(body.zoneId);
    if (!zone) return sendJson(res, 400, { message: "zoneId not recognised" });
    const count = Math.min(Math.max(Number(body.count) || 5, 1), 20);

    const created = [];
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * 2 * Math.PI;
        const distanceKm = 5 * Math.sqrt(Math.random());
        const dLat = (distanceKm / 111.32) * Math.cos(angle);
        const dLng = (distanceKm / (111.32 * Math.cos((zone.lat * Math.PI) / 180))) * Math.sin(angle);
        const id = `demo-help:${zone.id}:${Date.now()}:${i}`;
        const record = {
            userId: id,
            name: `Demo Citizen ${i + 1}`,
            phone: null,
            source: "demo",
            status: "NeedHelp",
            note: "Simulated help request (DEMO/SIMULATED) generated by an Official for workflow testing.",
            lastKnownLocation: { lat: Number((zone.lat + dLat).toFixed(5)), lng: Number((zone.lng + dLng).toFixed(5)), capturedAt: new Date() },
            updatedAt: new Date(),
            demo: true
        };
        safetyStatuses.set(id, record);
        created.push(record);
    }
    sendJson(res, 201, { message: `${count} simulated help requests generated (DEMO/SIMULATED) near ${zone.name}`, data: created });
});

// POST /api/upload/evidence — real file upload (not a placeholder
// filename string with nothing written to disk). Field name
// "evidence", up to 5 files, image/* or video/* only, 25MB/file —
// matches the full backend's contract in
// middleware/uploadMiddleware.js exactly, including the response
// shape ({ message, urls }) the frontend's uploadEvidenceFiles() in
// app.js expects, so evidence upload works end-to-end on whichever
// backend is active, not only the MongoDB one. Any authenticated user
// may upload (same as the real backend's `protect` middleware — no
// role restriction).
route("POST", /^\/api\/upload\/evidence$/, async (req, res, query, params, body) => {
    const user = userFromRequest(req);
    if (!user) return sendJson(res, 401, { message: "Not authorized, no token" });

    if (!body || !body.__multipart) {
        return sendJson(res, 400, { message: "Expected multipart/form-data with field 'evidence'" });
    }

    let parsed;
    try {
        parsed = parseMultipart(body.buffer, body.contentType);
    } catch (error) {
        return sendJson(res, 400, { message: "Upload rejected", error: error.message });
    }

    const evidenceFiles = parsed.files.filter((f) => f.fieldName === "evidence");
    if (!evidenceFiles.length) {
        return sendJson(res, 400, { message: "No files uploaded (expected field name 'evidence')" });
    }
    if (evidenceFiles.length > MAX_EVIDENCE_FILES) {
        return sendJson(res, 400, { message: `Upload rejected`, error: `Too many files (max ${MAX_EVIDENCE_FILES})` });
    }
    for (const f of evidenceFiles) {
        if (!/^(image|video)\//.test(f.mimetype)) {
            return sendJson(res, 400, { message: "Upload rejected", error: "Only image or video files are allowed" });
        }
        if (f.buffer.length > MAX_EVIDENCE_FILE_BYTES) {
            return sendJson(res, 400, { message: "Upload rejected", error: "File too large (max 25MB)" });
        }
    }

    const urls = [];
    for (const f of evidenceFiles) {
        const safeExt = path.extname(f.originalName).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, "");
        const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${safeExt}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, unique), f.buffer);
        urls.push(`/uploads/${unique}`);
    }

    sendJson(res, 201, { message: "Evidence uploaded successfully", urls });
});

// ---- server ----
const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Offline-Action-Id"
        });
        return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Serve uploaded evidence files back out — mirrors the full
    // backend's `app.use("/uploads", express.static(...))` in
    // server.js, so a URL returned by POST /api/upload/evidence above
    // is actually loadable, not just a string.
    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
        const requested = path.basename(url.pathname); // strips any ../ traversal
        const filePath = path.join(UPLOAD_DIR, requested);
        if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) {
            res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
            return res.end("Not found");
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".gif": "image/gif", ".webp": "image/webp",
            ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"
        }[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime, "Access-Control-Allow-Origin": "*" });
        return fs.createReadStream(filePath).pipe(res);
    }

    for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = url.pathname.match(r.pattern);
        if (!match) continue;

        try {
            const body = ["POST", "PUT"].includes(req.method) ? await readRequestBody(req) : undefined;
            return await r.handler(req, res, url.searchParams, match.slice(1), body);
        } catch (error) {
            return sendJson(res, 500, { message: "Demo server error", error: error.message });
        }
    }

    sendJson(res, 404, { message: `No demo route for ${req.method} ${url.pathname}` });
});

server.listen(PORT, () => {
    console.log(`\nNER Sentinel DEMO server listening on http://localhost:${PORT}`);
    console.log(`No DB, no npm install needed. GET / for the endpoint list.\n`);
});
