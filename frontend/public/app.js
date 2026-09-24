// ============================================================
// NER Sentinel — frontend application logic
// ============================================================
// Talks to whichever backend is selected (zero-setup demo server on
// :5050, or the full production backend on :5000) via a plain REST
// API — no framework, matching the zero-dependency spirit of the
// backend. Every page here maps to something the backend actually
// computes: nothing on screen is a hand-typed number.

const $ = (id) => document.getElementById(id);

// Offline action queue -------------------------------------------------------
// The app shell is cached by sw.js, but a safety update or a hazard report
// still needs the backend.  Keep only the two citizen actions that can be
// safely represented as JSON (never files, authentication, alert dispatch,
// or response-team commands) and retry them when the connection returns.
// This is deliberately local to this browser/device and is always labelled
// CACHED until the API confirms the action.
const OFFLINE_QUEUE_KEY = "nerOfflineActions";
const queueablePaths = new Set(["/api/safety/status", "/api/incidents"]);

function readOfflineQueue() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]"); }
    catch { return []; }
}

function writeOfflineQueue(items) {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

function queueOfflineAction(path, options) {
    const items = readOfflineQueue();
    items.push({
        id: crypto.randomUUID(), path, method: options.method || "POST",
        body: options.body || null, queuedAt: new Date().toISOString(),
        userId: S.user?.id || null
    });
    writeOfflineQueue(items);
    return items.length;
}

async function flushOfflineQueue() {
    if (!navigator.onLine || !S.token || !S.user) return;
    const pending = readOfflineQueue();
    if (!pending.length) return;
    const remaining = [];
    let delivered = 0;
    for (const item of pending) {
        // Never send a previous account's locally queued action as a newly
        // signed-in person.  It stays CACHED for that original account.
        if (item.userId && item.userId !== S.user.id) { remaining.push(item); continue; }
        try {
            await api(item.path, { method: item.method, body: item.body, headers: { "X-Offline-Action-Id": item.id }, skipOfflineQueue: true });
            delivered++;
        } catch {
            remaining.push(item);
        }
    }
    writeOfflineQueue(remaining);
    if (delivered) {
        toast(`${delivered} cached action${delivered === 1 ? "" : "s"} sent successfully.`);
        refreshIncidents();
        refreshNeedsHelp();
    }
}

// ---- config ----
const API_BASES = [
    { value: "http://localhost:5050", label: "Demo backend — zero setup (port 5050)" },
    { value: "http://localhost:5000", label: "Full backend — MongoDB + auth (port 5000)" }
];

// Mirrors backend/services/i18nService.js exactly — keep in sync if
// that file's SUPPORTED_LOCALES / NEEDS_REVIEW_LOCALES changes.
const LOCALES = [
    { code: "en", label: "English", review: false },
    { code: "hi", label: "हिंदी Hindi", review: false },
    { code: "bn", label: "বাংলা Bengali", review: false },
    { code: "as", label: "অসমীয়া Assamese", review: true },
    { code: "mni", label: "Manipuri", review: true },
    { code: "kha", label: "Khasi", review: true },
    { code: "lus", label: "Mizo", review: true }
];

// ---- state ----
const S = {
    apiBase: localStorage.getItem("nerApiBase") || API_BASES[0].value,
    locale: localStorage.getItem("nerLocale") || "en",
    token: localStorage.getItem("nerToken") || "",
    user: JSON.parse(localStorage.getItem("nerUser") || "null"),
    zones: [],
    generatedAt: null,
    history: [],
    incidents: [],
    selectedZoneId: null,
    gps: null,
    personalLocation: null,
    reportLocation: null,
    maps: {},
    responseIncidents: [],
    responseTeams: [],
    controlRoomZoneId: null
};

// ---- helpers ----
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(t) {
    const e = $("toast");
    e.textContent = t;
    e.classList.add("show");
    setTimeout(() => e.classList.remove("show"), 3200);
}

async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (S.token) headers.Authorization = `Bearer ${S.token}`;
    if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    let res;
    try {
        res = await fetch(S.apiBase + path, { ...options, headers });
    } catch (networkError) {
        const canQueue = !options.skipOfflineQueue && options.method === "POST" && queueablePaths.has(path) && S.user?.role === "Citizen" && typeof options.body === "string";
        if (canQueue) {
            const count = queueOfflineAction(path, options);
            const err = new Error(`Offline — action saved on this device and queued for retry. ${count} action${count === 1 ? "" : "s"} pending (CACHED).`);
            err.queued = true;
            throw err;
        }
        throw new Error(`Can't reach ${S.apiBase} — is that backend running? (${networkError.message})`);
    }
    let data = {};
    try {
        data = await res.json();
    } catch {
        // non-JSON response (e.g. a route that doesn't exist on this backend)
    }
    if (!res.ok) {
        const err = new Error(data.message || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return data;
}

const priorityColor = (level) => ({ Critical: "#ed4d54", High: "#ff982f", Moderate: "#e5b72b", Low: "#27b889" }[level] || "#27b889");

// ---- GPS (graceful fallback, mirrors the field-tested pattern from the reference build) ----
function getPosition(cb, onDenied) {
    let done = false;
    const fallback = (reason) => {
        if (done) return;
        done = true;
        if (onDenied) {
            onDenied(reason);
            return;
        }
        const z = S.zones[0];
        const p = { lat: z?.lat || 25.58, lng: z?.lng || 91.89, estimated: true };
        S.gps = p;
        cb(p);
        toast("Device GPS unavailable — using an estimated location.");
    };
    if (!navigator.geolocation) return fallback("unsupported");
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            if (done) return;
            done = true;
            const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, estimated: false, accuracy: pos.coords.accuracy };
            S.gps = p;
            cb(p);
        },
        (err) => fallback(err.code === 1 ? "denied" : "timeout"),
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
    );
    setTimeout(() => fallback("timeout"), 8000);
}

let watchId = null;
function startWatchingLocation(onUpdate) {
    if (!navigator.geolocation) return toast("This browser doesn't support GPS.");
    stopWatchingLocation();
    watchId = navigator.geolocation.watchPosition(
        (pos) => onUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => toast("Live location tracking stopped — permission lost."),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
}
function stopWatchingLocation() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
}

function nearestZone(lat, lng) {
    if (!S.zones.length) return null;
    return S.zones.reduce((best, z) => (Math.hypot(z.lat - lat, z.lng - lng) < Math.hypot(best.lat - lat, best.lng - lng) ? z : best), S.zones[0]);
}

// ---- Auto location on citizen login: get permitted browser location,
// match it to the nearest existing NER zone, and show the area name.
// Citizen-only; uses the same getPosition()/nearestZone() the rest of
// the app already relies on — no new location or matching logic.
function autoDetectCitizenLocation() {
    const el = $("citizenLocationLine");
    if (!el || S.user?.role !== "Citizen") return;
    el.textContent = "📍 Locating your area…";
    getPosition(
        (p) => {
            const zone = nearestZone(p.lat, p.lng);
            el.textContent = zone ? `📍 Your Location: ${zone.zoneName}` : "📍 Your Location: unable to match a zone yet";
            if (zone) renderCitizenRisk(zone, p, "automatic");
        },
        () => {
            el.textContent = "📍 Your Location: unavailable (location permission denied)";
        }
    );
}

// Real haversine distance in km — client-side equivalent of the
// backend's geoService.calculateDistance, used for "X km from you"
// labels without an extra API round-trip.
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Leaflet style for a drawn route line. A `simulated` route (the
// straight-line fallback routeRoutes.js/demoServer.js return when
// OSRM is unreachable) always gets this same red, clearly-dashed
// style regardless of whether it happens to be "recommended" — before
// this, a simulated route at index 0 drew identically to a real
// OSRM-computed recommended route (solid green), the exact "straight
// line presented as an actual route" this app's design notes say to
// avoid. A real route keeps the existing green(recommended)/grey
// (alternative) styling.
function routeLineStyle(isRecommended, simulated) {
    if (simulated) return { color: "#d73737", weight: 3, dashArray: "2 10" };
    return { color: isRecommended ? "#27b889" : "#94a3b8", weight: isRecommended ? 5 : 3, dashArray: isRecommended ? null : "6 6" };
}

// ---- nav ----
function go(page) {
    if ((page === "official" || page === "officialDashboard") && S.user?.role !== "Official") return toast("Sign in with an Official account to open that page.");
    if ((page === "report") && S.user?.role !== "Citizen") return toast("Sign in with a Citizen account to file a field report.");
    document.querySelectorAll(".page").forEach((e) => e.classList.toggle("active", e.id === page));
    document.querySelectorAll(".nav").forEach((e) => e.classList.toggle("active", e.dataset.page === page));
    if (page === "map") setTimeout(mapMain, 30);
    if (page === "official") setTimeout(() => { renderPriorityTable(); renderQueue(); }, 0);
    if (page === "officialDashboard") setTimeout(renderOfficialDashboard, 0);
    scrollTo({ top: 0, behavior: "smooth" });
}
window.go = go;

function goHome() {
    go(S.user?.role === "Official" ? "officialDashboard" : "home");
}
window.goHome = goHome;

// Jump to Command Center then smoothly scroll to a specific panel —
// used by the Official Dashboard's "Open the full tool →" links.
function scrollToPanel(panelId) {
    setTimeout(() => {
        const el = document.getElementById(panelId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
}
window.scrollToPanel = scrollToPanel;

// ---- maps ----
function marker(map, z) {
    const icon = L.divIcon({
        className: "risk-marker",
        html: `<span class="${z.priorityLevel === "Critical" ? "pulse-critical" : ""}" style="--c:${priorityColor(z.priorityLevel)}">${z.priorityScore}</span>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21]
    });
    L.marker([z.lat, z.lng], { icon })
        .addTo(map)
        // Map markers/popups always render in English, regardless of
        // the app's selected UI language (S.locale) — GIS content is
        // meant to be readable consistently by anyone looking at the
        // same shared map, not localized per viewer.
        .bindPopup(`<b>${esc(z.zoneName)}</b><br>Priority ${z.priorityScore}/100 · ${esc(z.priorityLevel)}<br>Risk: ${esc(z.riskLevel)}`)
        .on("click", () => select(z.zoneId));
}

function mapOverview() {
    if (S.maps.over || !S.zones.length) return;
    const m = (S.maps.over = L.map("overviewMap", { zoomControl: false, attributionControl: false }).setView([25.7, 92.5], 6));
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(m);
    S.zones.forEach((z) => marker(m, z));
}

function mapMain() {
    if (!S.zones.length) return;
    if (S.maps.main) {
        S.maps.main.invalidateSize();
        return;
    }
    const m = (S.maps.main = L.map("mainMap").setView([25.7, 92.5], 6));
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(m);
    S.zones.forEach((z) => marker(m, z));
    select(S.selectedZoneId || S.zones[0].zoneId);
    renderPersonalLocationOnMap();
}

let personalLocationMarker = null;
let personalRiskZoneLayer = null;
let historicalHazardLayer = null;
function renderPersonalLocationOnMap() {
    if (!S.maps.main || !S.personalLocation) return;
    if (personalLocationMarker) S.maps.main.removeLayer(personalLocationMarker);
    if (personalRiskZoneLayer) S.maps.main.removeLayer(personalRiskZoneLayer);
    const p = S.personalLocation;
    personalLocationMarker = L.marker([p.lat, p.lng], { zIndexOffset: 9999 }).addTo(S.maps.main)
        .bindPopup(`<b>Your location</b><br>${p.estimated ? "Estimated / manually selected" : "Browser-permitted GPS"}`);
    const zone = S.zones.find((z) => z.zoneId === S.selectedZoneId);
    if (zone) {
        personalRiskZoneLayer = L.circle([zone.lat, zone.lng], {
            radius: (zone.perimeter?.radiusKm || 5) * 1000,
            color: priorityColor(zone.priorityLevel), fillOpacity: 0.06, weight: 2
        }).addTo(S.maps.main).bindPopup(`<b>Your relevant risk zone</b><br>${esc(zone.zoneName)} · ${esc(citizenRiskLevel(zone))} risk`);
    }
}

function renderHistoricalHazards(z) {
    if (!S.maps.main || !z) return;
    if (historicalHazardLayer) S.maps.main.removeLayer(historicalHazardLayer);
    historicalHazardLayer = L.layerGroup().addTo(S.maps.main);
    (S.history || []).filter((h) => h.location && haversineKm(z.lat, z.lng, h.location.lat, h.location.lng) <= 150).forEach((h) => {
        L.circleMarker([h.location.lat, h.location.lng], { radius: 6, color: "#7c2d12", fillColor: "#f97316", fillOpacity: 0.85, weight: 2 }).addTo(historicalHazardLayer)
            .bindPopup(`<b>Historical landslide</b><br>${esc(h.locationName)}, ${esc(h.state)}<br><small>${esc(h.coordinatePrecision === "town_approximate" ? "Town-approximate location" : "Recorded location")} · ${esc(h.source || "source unavailable")}</small>`);
    });
}

function select(zoneId) {
    const z = S.zones.find((x) => x.zoneId === zoneId) || S.zones[0];
    if (!z) return;
    S.selectedZoneId = z.zoneId;
    if ($("locationSelect")) $("locationSelect").value = z.zoneId;
    if (S.maps.main) S.maps.main.setView([z.lat, z.lng], 8);
    renderRiskPanel(z);
    renderPerimeter(z);
    renderHistoricalHazards(z);
    maybeTriggerCriticalFlow(z);
}

// ---- data-status badge helper ----
// Renders one of the LIVE / CACHED / DEMO / ESTIMATED / HEURISTIC /
// AI MODEL / UNAVAILABLE tags next to a value, styled consistently.
function statusBadge(status) {
    if (!status) return "";
    const cls =
        status === "LIVE" ? "live" :
        status === "CACHED" ? "cached" :
        status === "DEMO" ? "demo" :
        status === "AI MODEL" ? "live" :
        status === "UNAVAILABLE" ? "unavailable" :
        "approx"; // ESTIMATED / HEURISTIC
    return `<span class="badge ${cls}">${esc(status)}</span>`;
}

function factorPill(level) {
    const cls = level === "HIGH" ? "Critical" : level === "MODERATE" ? "Moderate" : level === "LOW" ? "Low" : "";
    return `<span class="pill ${cls}">${esc(level)}</span>`;
}

// ---- 5km perimeter circle on the main map ----
let perimeterCircle = null;
let perimeterVisible = false;
function renderPerimeter(z) {
    if (!S.maps.main) return;
    if (perimeterCircle) {
        S.maps.main.removeLayer(perimeterCircle);
        perimeterCircle = null;
    }
    if (!perimeterVisible || !z) return;
    perimeterCircle = L.circle([z.lat, z.lng], {
        radius: (z.perimeter?.radiusKm || 5) * 1000,
        color: priorityColor(z.priorityLevel),
        fillOpacity: 0.08,
        weight: 1.5
    }).addTo(S.maps.main);
}

// ============================================================
// EARLY WARNING + CITIZEN SAFETY (NEW)
// ============================================================
// Everything below reads from the same z (zone summary) object the
// Risk Map already computes from real backend data — no new random
// values are introduced here. The only genuinely simulated data is
// the 5km Citizen Zone roster, which is fetched from
// /api/demo/citizens (clearly demo:true) and is used purely to test
// the Officials-side counting/marker flow.

function openModal(id) {
    $(id)?.classList.remove("hidden");
}
function closeModal(id) {
    $(id)?.classList.add("hidden");
}

// A zone counts as a "critical incident" using the same real signal
// the rest of the app already uses (thresholds.isCritical / the
// early-warning level / priority level) — nothing new is computed.
function zoneIsCritical(z) {
    if (!z) return false;
    return Boolean(z.thresholds?.isCritical) || z.earlyWarning?.level === "CRITICAL" || z.priorityLevel === "Critical";
}

// Anonymous per-browser demo citizen id, e.g. "DEMO-4821" — generated
// once and reused, so repeated safety reports from the same browser
// update the SAME official-side entry instead of creating a new one
// each time. Only used when nobody is signed in (a signed-in user's
// real account id is used instead, same as the existing Safety page).
function getDemoCitizenId() {
    let id = localStorage.getItem("nerDemoCitizenId");
    if (!id) {
        const n = 1000 + Math.floor(Math.random() * 9000);
        id = `DEMO-${n}`;
        localStorage.setItem("nerDemoCitizenId", id);
    }
    return id;
}

function fmtTime(d = new Date()) {
    return d.toLocaleString();
}

// ---- 1. EARLY WARNING modal ----
function renderEarlyWarningModal(z) {
    const cw = z.cumulativeRainfallMm || {};
    const reason =
        (z.thresholds?.triggeredRules || [])[0]?.detail ||
        (z.earlyWarning?.reasons || [])[0] ||
        "Computed risk score crossed the critical threshold.";

    $("ewTitle").textContent = z.zoneName;
    $("ewFacts").innerHTML = `
      <div><span>Location</span><b>${esc(z.zoneName)} (${z.lat.toFixed(3)}, ${z.lng.toFixed(3)})</b></div>
      <div><span>Risk level</span><b>${esc(z.riskLevel)}</b></div>
      <div><span>Rainfall (24h)</span><b>${cw["24h"] != null ? cw["24h"] + " mm" : "Unavailable"}</b></div>
      <div><span>Soil moisture</span><b>${z.soilMoisture?.value != null ? z.soilMoisture.value + "%" : "Unavailable"}</b></div>
      <div><span>Reason</span><b>${esc(reason)}</b></div>
      <div><span>Time</span><b>${fmtTime()}</b></div>
    `;
    openModal("earlyWarningModal");
}

// ---- 2. 5KM CITIZEN ZONE (DEMO/SIMULATED) ----
let demoCitizenLayer = null;
async function fetchAndRenderCitizenZone(z) {
    const card = $("citizenZoneCard");
    if (!card) return;
    card.classList.remove("hidden");
    card.innerHTML = `<p class="eyebrow">5 KM CITIZEN ZONE</p><p class="muted small">Loading simulated citizens…</p>`;

    let data;
    try {
        data = await api(`/api/demo/citizens?zoneId=${encodeURIComponent(z.zoneId)}`);
    } catch (e) {
        card.innerHTML = `<p class="eyebrow">5 KM CITIZEN ZONE</p><p class="muted small">Could not load demo citizen data (${esc(e.message)}).</p>`;
        return;
    }

    card.innerHTML = `
      <p class="eyebrow">5 KM CITIZEN ZONE <span class="badge demo">DEMO</span></p>
      <p class="muted small">Simulated citizens for testing — not a real headcount. ${esc(data.method || "")}</p>
      <div class="cz-total">${data.total}</div>
      <p class="muted small" style="margin-top:-8px">citizens in area (demo)</p>
      <div class="cz-breakdown">
        <div class="cz-stat safe"><b>${data.counts.safe}</b><span><span class="legend-dot safe"></span>Safe</span></div>
        <div class="cz-stat needhelp"><b>${data.counts.needHelp}</b><span><span class="legend-dot needhelp"></span>Need Help</span></div>
        <div class="cz-stat noresponse"><b>${data.counts.noResponse}</b><span><span class="legend-dot noresponse"></span>No Response</span></div>
      </div>
    `;

    if (S.maps.main) {
        if (demoCitizenLayer) S.maps.main.removeLayer(demoCitizenLayer);
        demoCitizenLayer = L.layerGroup().addTo(S.maps.main);
        const color = { Safe: "#16855f", NeedHelp: "#ed4d54", NoResponse: "#e5b72b" };
        data.citizens.forEach((c) => {
            L.circleMarker([c.lastKnownLocation.lat, c.lastKnownLocation.lng], {
                radius: 5,
                color: "#fff",
                weight: 1,
                fillColor: color[c.status] || "#888",
                fillOpacity: 0.9,
                className: "demo-citizen-marker"
            })
                .addTo(demoCitizenLayer)
                .bindPopup(`<b>${esc(c.id)}</b> · ${esc(c.status)} <br><small>DEMO — simulated, not a real report</small>`);
        });
    }
}

// ---- 3. CITIZEN SAFETY ALERT modal ----
function showCitizenSafetyModal(z) {
    $("csZoneName").textContent = `${z.zoneName} — are you safe?`;
    $("csSub").textContent = `Landslide risk near you is currently ${z.riskLevelLocalized || z.riskLevel}. Let officials know your status.`;
    $("csDemoId").textContent = S.user?.id ? "signed-in account" : getDemoCitizenId();
    $("csSafeBtn").onclick = () => submitCitizenSafety("Safe", z);
    $("csHelpBtn").onclick = () => submitCitizenSafety("NeedHelp", z);
    openModal("citizenSafetyModal");
}

// ---- 4. OFFICIAL UPDATE ----
// Posts to the SAME real /api/safety/status endpoint the existing
// Safety Status page uses, so this isn't a UI-only card: it goes
// through the real backend, and the Official Dashboard's existing
// live needs-help list/map/count picks it up automatically (it
// already polls every 20s, and we also force an immediate refresh
// below for instant feedback).
async function submitCitizenSafety(status, z) {
    const userId = S.user?.id || getDemoCitizenId();
    try {
        const data = await api(`/api/safety/status?locale=${S.locale}`, {
            method: "POST",
            body: JSON.stringify({
                userId,
                status,
                lat: z.lat,
                lng: z.lng,
                note: `Reported via Landslide Emergency alert for ${z.zoneName} (last known location, not live tracking).`
            })
        });
        closeModal("citizenSafetyModal");
        toast(status === "NeedHelp" ? "🆘 Sent — officials notified you need help." : "✅ Sent — marked as Safe.");
        await refreshNeedsHelp();
        if (document.getElementById("officialDashboard")?.classList.contains("active")) renderOfficialDashboard();
    } catch (e) {
        toast("Couldn't send your status: " + e.message);
    }
}

// ---- wiring it all together ----
const criticalHandledZones = new Set();
let pendingSafetyModalZone = null;

async function maybeTriggerCriticalFlow(z, { force = false } = {}) {
    if (!z) return;
    if (!force) {
        if (!zoneIsCritical(z)) {
            criticalHandledZones.delete(z.zoneId);
            return;
        }
        if (criticalHandledZones.has(z.zoneId)) return;
    }
    criticalHandledZones.add(z.zoneId);

    perimeterVisible = true;
    if ($("perimeterToggle")) $("perimeterToggle").textContent = "Hide 5km perimeter";
    renderPerimeter(z);
    renderEarlyWarningModal(z);
    fetchAndRenderCitizenZone(z);

    // Citizens (or guests) get the emergency prompt; Officials already
    // see the Early Warning + Citizen Zone data instead.
    pendingSafetyModalZone = S.user?.role !== "Official" ? z : null;
}

document.addEventListener("DOMContentLoaded", () => {
    $("earlyWarningClose")?.addEventListener("click", () => {
        closeModal("earlyWarningModal");
        if (pendingSafetyModalZone) {
            const z = pendingSafetyModalZone;
            pendingSafetyModalZone = null;
            showCitizenSafetyModal(z);
        }
    });
    $("earlyWarningModal")?.addEventListener("click", (e) => {
        if (e.target.id === "earlyWarningModal") $("earlyWarningClose").click();
    });
    $("simulateCriticalBtn")?.addEventListener("click", () => {
        const z = S.zones.find((x) => x.zoneId === S.selectedZoneId) || S.zones[0];
        if (!z) return toast("No zone loaded yet.");
        maybeTriggerCriticalFlow(z, { force: true });
    });
});

// ---- rendering ----
function renderRiskPanel(z) {
    const cw = z.cumulativeRainfallMm || {};
    const ds = z.dataStatus || {};
    const rainRows = [
        ["1h", cw["1h"]], ["3h", cw["3h"]], ["6h", cw["6h"]], ["24h", cw["24h"]]
    ].map(([label, val]) =>
        `<div><span>${label}<b>${val != null ? val + " mm" : "Live rainfall unavailable"}</b></span></div>`
    ).join("");

    const sat = z.satelliteRainfall
        ? `${z.satelliteRainfall.totalMmOverWindow} mm / ${z.satelliteRainfall.windowDays}d`
        : "Unavailable";

    const rules = (z.thresholds?.triggeredRules || []).map((r) => `<li>${esc(r.detail)}</li>`).join("")
        || "<li>No hard rule-based thresholds crossed.</li>";

    const ew = z.earlyWarning || { level: "NONE", statusLabel: "NO EARLY-WARNING SIGNAL", reasons: [] };
    const ewClass = ew.level === "CRITICAL" ? "critical" : ew.level === "WARNING" ? "high" : ew.level === "WATCH" ? "moderate" : "low";
    const ewReasons = ew.reasons.length
        ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:#586c87">${ew.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
        : `<p style="margin:8px 0 0;font-size:12px;color:#586c87">No factors are currently approaching a threshold.</p>`;

    const factors = (z.contributingFactors || []).map((f) =>
        `<div><span>${esc(f.factor)}<b>${factorPill(f.level)}</b></span><small style="display:block;margin-top:2px;color:#8393a9;font-size:11px">${esc(f.detail)}</small></div>`
    ).join("");

    const offline = z.weatherError && z.rainfallError && z.satelliteRainfallError;

    $("riskPanel").innerHTML = `
    <p class="eyebrow">SELECTED ZONE</p>
    <h2>${esc(z.zoneName)}</h2>
    <div class="risk-score">
      <div><small>PRIORITY SCORE</small><b>${z.priorityScore}<i>/100</i></b></div>
      <span class="risk-status ${(z.priorityLevel || "low").toLowerCase()}">${esc(z.priorityLevel)}</span>
    </div>
    <div style="font-size:11px;color:#8393a9;margin:-8px 0 14px">AI risk level: <b style="color:var(--ink)">${esc(z.riskLevel)}</b> ${statusBadge(ds.aiRisk)} · Last updated ${z.lastUpdated ? new Date(z.lastUpdated).toLocaleTimeString() : "—"}</div>

    <div class="guidance" style="background:${ew.level === "CRITICAL" ? "#fff0f0" : ew.level === "WARNING" ? "#fff4e8" : ew.level === "WATCH" ? "#fff9df" : "#f3f7fd"};margin-bottom:16px">
      <b>LANDSLIDE EARLY WARNING</b>
      <div style="margin-top:6px"><span class="risk-status ${ewClass}">${esc(ew.statusLabel)}</span></div>
      ${ewReasons}
    </div>

    <p class="eyebrow">RAINFALL MONITORING</p>
    <div class="factor-list">
      ${rainRows}
      <div><span>7-day / satellite<b>${sat} ${z.satelliteRainfall ? statusBadge(ds.satelliteRainfall) : statusBadge("UNAVAILABLE")}</b></span></div>
    </div>
    <div style="font-size:11px;color:#8393a9;margin:-6px 0 14px">Rainfall ${statusBadge(ds.rainfall)} · Source: Open-Meteo</div>

    <p class="eyebrow">WEATHER-LINKED FORECAST</p>
    <div class="factor-list">
      <div><span>Forecast rainfall (next 24h)<b>${z.forecast?.rainfallNext24hMm != null ? z.forecast.rainfallNext24hMm + " mm" : "Unavailable"} ${statusBadge(z.forecast?.status || "UNAVAILABLE")}</b></span></div>
    </div>
    <div style="font-size:11px;color:#8393a9;margin:-6px 0 14px">Forward-looking, from the same Open-Meteo forecast call as the rainfall above — not a projection from past data.</div>

    <p class="eyebrow">ENVIRONMENT</p>
    <div class="factor-list">
      <div><span>Soil moisture<b>${z.soilMoisture?.value != null ? z.soilMoisture.value + "%" : "—"} ${statusBadge(ds.soilMoisture)}</b></span></div>
      <div><span>Slope<b>${z.slopeDegrees != null ? z.slopeDegrees + "°" : (z.slopeError ? "Unavailable" : "—")} ${statusBadge(ds.slope)}</b></span></div>
    </div>

    <p class="eyebrow">EXPOSURE</p>
    <div class="factor-list">
      <div><span>Est. population (5km)<b>${z.population?.estimatedPopulation?.toLocaleString() ?? "—"} ${statusBadge(ds.population)}</b></span></div>
    </div>

    <p class="eyebrow">INFRASTRUCTURE</p>
    <div class="factor-list">
      <div><span>Road status<b>${esc(z.roadStatus?.value || "—")} ${statusBadge(ds.roadStatus)}</b></span></div>
    </div>

    <p class="eyebrow">RISK EXPLANATION</p>
    <div class="factor-list">${factors}</div>
    <div class="guidance">
      <p style="margin:0">${esc(z.riskExplanation || "")}</p>
    </div>

    <p class="eyebrow" style="margin-top:16px">RULE-BASED THRESHOLDS</p>
    <div class="guidance">
      <ul style="margin:0;padding-left:18px;font-size:12px;color:#586c87">${rules}</ul>
    </div>

    ${offline ? `<div class="notice small">OFFLINE / LIMITED DATA MODE — live weather/rainfall/satellite calls are all failing right now. Showing whatever was last cached; anything with no cached value shows "Unavailable" rather than 0.</div>`
        : (z.weatherError || z.aiError) ? `<div class="notice small">Some live data unavailable right now (${esc(z.weatherError || z.aiError)}). Other panels still reflect real computed values.</div>` : ""}
  `;
}

function renderStats() {
    const critical = S.zones.filter((z) => z.priorityLevel === "Critical").length;
    const high = S.zones.filter((z) => z.priorityLevel === "High").length;
    const totalPop = S.zones.reduce((sum, z) => sum + (z.population?.estimatedPopulation || 0), 0);
    const cards = [
        [String(S.zones.length), "monitored zones", "Live-computed each load"],
        [String(critical), "critical zones", "Priority ≥ 75"],
        [String(high), "high-priority zones", "Priority 50–74"],
        [totalPop >= 1000 ? (totalPop / 1000).toFixed(0) + "k" : String(totalPop), "people in range", "5km radius, approx"]
    ];
    $("stats").innerHTML = cards.map((c) => `<div class="stat"><b>${c[0]}</b><span>${c[1]}</span><small>${c[2]}</small></div>`).join("");
    if ($("officialStats")) {
        $("officialStats").innerHTML = [
            [String(critical), "critical zones"],
            [String(high), "high-priority zones"],
            [String(S.incidents.length), "field reports"],
            [String(S.incidents.filter((i) => i.status === "Pending").length), "awaiting review"]
        ]
            .map((c) => `<div class="stat"><b>${c[0]}</b><span>${c[1]}</span><small>Current session</small></div>`)
            .join("");
    }
}

// Turns a raw thresholdService rule id into a plain-language title +
// category. Falls back gracefully for anything not in this map so a
// future new rule never renders blank.
const ALERT_REASON_LABELS = {
    "24h_rainfall_critical": { title: "Heavy Rainfall Risk", type: "Rainfall" },
    "24h_rainfall_high": { title: "Elevated Rainfall Risk", type: "Rainfall" },
    "1h_cloudburst_intensity": { title: "Cloudburst-Intensity Rainfall", type: "Rainfall" },
    steep_slope: { title: "Steep Slope Hazard", type: "Terrain" },
    saturated_soil: { title: "Saturated Soil Risk", type: "Soil moisture" }
};

const RECOMMENDED_ACTION = {
    Critical: "Avoid this area and follow official guidance — response teams should be dispatched immediately.",
    High: "Monitor this zone closely and prepare a response; conditions can escalate quickly.",
    Moderate: "Stay alert and check back for updates — no immediate action needed yet.",
    Low: "No action needed — this zone is within its normal range and simply being monitored."
};

const ALERT_STATUS = {
    Critical: { label: "Active", cls: "active" },
    High: { label: "Active", cls: "active" },
    Moderate: { label: "Monitoring", cls: "monitoring" },
    Low: { label: "Clear", cls: "clear" }
};

// Builds the "why does this alert exist" content straight from the
// same real data the backend already computed — the rule-based
// thresholds that actually tripped (if any), otherwise the AI risk
// score. Never invents an event; if a zone is Low priority with
// nothing notable, it says so plainly instead of dressing it up.
function alertReason(zone) {
    const rules = zone.thresholds?.triggeredRules || [];
    if (rules.length) {
        const label = ALERT_REASON_LABELS[rules[0].rule] || { title: "Threshold Crossed", type: "Rule-based" };
        return { title: label.title, type: label.type, detail: rules.map((r) => r.detail).join(" · ") };
    }
    if ((zone.riskScore || 0) > 0) {
        return {
            title: "AI-Flagged Landslide Risk",
            type: "AI model",
            detail: `AI model estimates a ${Math.round((zone.riskScore || 0) * 100)}% landslide probability from current terrain and weather — no hard rainfall/slope/soil threshold was crossed.`
        };
    }
    return {
        title: "Landslide Risk",
        type: "Population impact",
        detail: "No rainfall/slope/soil threshold crossed and the AI model shows no elevated risk right now; the score here reflects only the population that would be affected if a slide occurred."
    };
}

function renderAlerts() {
    const ranked = [...S.zones]; // already priority-sorted by the backend
    const updatedLabel = S.generatedAt ? new Date(S.generatedAt).toLocaleString() : "just now";
    const active = ranked.filter((z) => z.priorityLevel !== "Low");
    const clear = ranked.filter((z) => z.priorityLevel === "Low");

    const actionBtn = (z) =>
        S.user?.role === "Official"
            ? `<button onclick="go('official');scrollToPanel('panel-dispatch')">📡 Dispatch</button>`
            : `<button onclick="goToSafeRoute('${z.zoneId}')">🧭 Safe route</button>`;

    const card = (z) => {
        const reason = alertReason(z);
        const status = ALERT_STATUS[z.priorityLevel] || ALERT_STATUS.Low;
        const action = RECOMMENDED_ACTION[z.priorityLevel] || RECOMMENDED_ACTION.Low;
        return `<article class="alert-card ${(z.priorityLevel || "low").toLowerCase()}">
        <div><span class="severity">${esc(z.priorityLevelLocalized || z.priorityLevel)}</span><span class="status-chip ${status.cls}">${status.label}</span></div>
        <h3>${esc(reason.title)} – ${esc(z.zoneName)}</h3>
        <p class="alert-meta">📍 ${esc(z.zoneName)} · ${esc(reason.type)} · priority ${z.priorityScore}/100 · as of ${esc(updatedLabel)}</p>
        <p>AI risk: ${esc(z.riskLevelLocalized || z.riskLevel)} · ~${(z.population?.estimatedPopulation || 0).toLocaleString()} people in range</p>
        <div class="alert-action"><b>Reason</b>${esc(reason.detail)}</div>
        <div class="alert-action"><b>Recommended action</b>${esc(action)}</div>
        <div class="alert-card-actions">
          <button onclick="go('map');selectSoon('${z.zoneId}')">📍 View on map</button>
          ${actionBtn(z)}
        </div>
      </article>`;
    };

    const clearBlock = clear.length
        ? `<div class="alert-clear-block">
        <p class="eyebrow">MONITORED · NO ACTIVE ALERT</p>
        ${clear
            .map(
                (z) =>
                    `<div class="alert-row"><i style="background:${priorityColor(z.priorityLevel)}"></i><div><b>${esc(z.zoneName)}</b><small>priority ${z.priorityScore}/100 · within normal range</small></div><span>→</span></div>`
            )
            .join("")}
      </div>`
        : "";

    $("alertGrid").innerHTML =
        (active.length
            ? active.map(card).join("")
            : `<p class="empty">No active alerts right now — every monitored zone is within the Low priority range.</p>`) + clearBlock;

    $("alertPreview").innerHTML = ranked
        .slice(0, 3)
        .map(
            (z) => `<div class="alert-row"><i style="background:${priorityColor(z.priorityLevel)}"></i><div><b>${esc(z.zoneName)}</b><small>priority ${z.priorityScore}/100 · ${esc(z.priorityLevelLocalized || z.priorityLevel)}</small></div><span>→</span></div>`
        )
        .join("");

    if ($("alertsLastUpdated")) $("alertsLastUpdated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

window.selectSoon = (zoneId) => setTimeout(() => select(zoneId), 60);
window.goToSafeRoute = (fromZoneId) => {
    go("map");
    setTimeout(() => {
        const zone = S.zones.find((z) => z.zoneId === fromZoneId);
        if (zone) {
            S.safeRouteStart = { lat: zone.lat, lng: zone.lng, estimated: false, nearZone: zone.zoneName };
            $("safeRouteStartLabel").textContent = `Start: near ${zone.zoneName}`;
        }
        document.getElementById("panel-riskTrend"); // no-op, keeps consistent pattern
        document.querySelector(".action-plan.citizen-only")?.scrollIntoView({ behavior: "smooth" });
    }, 80);
};

function renderPriorityTable() {
    if (!$("priorityTable")) return;
    const rows = S.zones
        .map((z) => {
            const status = ALERT_STATUS[z.priorityLevel] || ALERT_STATUS.Low;
            return `<tr>
      <td><b>${esc(z.zoneName)}</b></td>
      <td>${esc(z.riskLevelLocalized || z.riskLevel)}</td>
      <td>${z.priorityScore}</td>
      <td><span class="pill ${z.priorityLevel}">${esc(z.priorityLevelLocalized || z.priorityLevel)}</span></td>
      <td><span class="status-chip ${status.cls}">${status.label}</span></td>
      <td>${(z.population?.estimatedPopulation || 0).toLocaleString()}</td>
      <td>${esc(z.roadStatus?.value || "—")}</td>
    </tr>`;
        })
        .join("");
    $("priorityTable").innerHTML = `<table class="priority-table"><thead><tr><th>Zone</th><th>AI risk</th><th>Score</th><th>Priority</th><th>Status</th><th>Est. population</th><th>Road status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderHistory() {
    const states = [...new Set(S.history.map((h) => h.state))].sort();
    if ($("historyState") && !$("historyState").dataset.filled) {
        $("historyState").innerHTML += states.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
        $("historyState").dataset.filled = "1";
    }

    let records = S.history;
    if (S.historyOrigin) {
        records = records
            .map((h) => ({ ...h, distanceKm: h.location ? haversineKm(S.historyOrigin.lat, S.historyOrigin.lng, h.location.lat, h.location.lng) : null }))
            .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }

    $("historyList").innerHTML = records
        .map((h) => {
            const date = new Date(h.date).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
            const precisionBadge = h.coordinatePrecision === "town_approximate" ? '<span class="badge approx">town-approx location</span>' : "";
            const distanceChip = h.distanceKm != null ? `<span class="distance-chip">${h.distanceKm.toFixed(0)} km from you</span>` : "";
            return `<article class="history-card ${h.distanceKm != null && h.distanceKm < 50 ? "near-me" : ""}">
        <div class="toll"><b>${h.approxFatalities ?? "—"}</b><small>approx. deaths</small></div>
        <div>
          <h3>${esc(h.locationName)}, ${esc(h.state)} ${precisionBadge}${distanceChip}</h3>
          <p>${esc(h.description)}</p>
          <div class="meta">${date} · Source: ${esc(h.source)}</div>
        </div>
      </article>`;
        })
        .join("");
}

function renderQueue() {
    if (!$("officialQueue")) return;
    $("officialQueue").innerHTML = S.incidents
        .slice(0, 12)
        .map((x) => {
            const id = x._id || x.id;
            return `<div class="queue-item">
        <div><b>${esc(x.description).slice(0, 40)}</b><small>${esc(x.reportedBy)} · ${x.location ? x.location.lat.toFixed(2) + ", " + x.location.lng.toFixed(2) : ""} · ${x.evidence?.length || 0} evidence file(s)</small></div>
        <span>${esc(x.status)}</span>
        <div class="qactions">
          <button onclick="verifyIncident('${id}','Verified')">Verify</button>
          <button onclick="verifyIncident('${id}','Rejected')">Reject</button>
          <button onclick="attachEvidence('${id}')">+Evidence</button>
        </div>
      </div>`;
        })
        .join("");
}

function renderMyReports() {
    if (!$("myReports")) return;
    const mine = S.incidents.filter((x) => x.reportedBy === S.user?.name);
    $("myReports").innerHTML = mine.length
        ? mine.map((x) => `<div class="message"><b>${esc(x.status)}</b><p>${esc(x.description)}</p><small>${new Date(x.createdAt).toLocaleString()}</small></div>`).join("")
        : '<div class="empty">No reports yet — submit one and its status will appear here.</div>';
}

let seenHelpIds = new Set();
let needsHelpMapInstance = null;

function renderNeedsHelp(list) {
    S.needsHelpList = list; // shared with the Official Dashboard preview
    if (!$("needsHelpList")) return;

    // Chime on genuinely NEW help requests only (not on every poll of
    // the same ones), so officials get an audible cue without a siren
    // re-firing every refresh cycle.
    const currentIds = new Set(list.map((s) => s.userId || s.phone));
    let hasNew = false;
    currentIds.forEach((id) => {
        if (!seenHelpIds.has(id)) hasNew = true;
    });
    if (hasNew && seenHelpIds.size > 0) AudioAlert.chime();
    seenHelpIds = currentIds;

    $("needsHelpList").innerHTML = list.length
        ? list
              .map(
                  (s) =>
                      `<div class="queue-item"><div><b>${esc(s.name || s.phone || s.userId)}</b> ${s.source === "sms" ? '<span class="badge approx">via SMS</span>' : ""}<small>${esc(s.note || "no note")} · ${s.lastKnownLocation ? s.lastKnownLocation.lat.toFixed(3) + ", " + s.lastKnownLocation.lng.toFixed(3) : "no location shared"}</small></div><span>🆘 Need help</span></div>`
              )
              .join("")
        : '<div class="empty">Nobody has flagged needing help right now.</div>';

    if ($("needsHelpMap")) {
        if (!needsHelpMapInstance) {
            needsHelpMapInstance = L.map("needsHelpMap").setView([25.7, 92.5], 6);
            L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(needsHelpMapInstance);
        }
        needsHelpMapInstance.eachLayer((layer) => {
            if (layer instanceof L.Marker) needsHelpMapInstance.removeLayer(layer);
        });
        list.filter((s) => s.lastKnownLocation).forEach((s) => {
            L.marker([s.lastKnownLocation.lat, s.lastKnownLocation.lng])
                .addTo(needsHelpMapInstance)
                .bindPopup(`<b>${esc(s.name || s.phone || "Citizen")}</b><br>${esc(s.note || "No note")}`);
        });
    }

    // Keep the Official Dashboard's preview map in sync too, if it's
    // currently the visible page.
    if (document.getElementById("officialDashboard")?.classList.contains("active")) {
        renderNeedsHelpPreview(list);
    }
}

let dashNeedsHelpMapInstance = null;
function renderNeedsHelpPreview(list) {
    if (!$("dashNeedsHelpMap")) return;
    if (!dashNeedsHelpMapInstance) {
        dashNeedsHelpMapInstance = L.map("dashNeedsHelpMap").setView([25.7, 92.5], 6);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(dashNeedsHelpMapInstance);
    } else {
        dashNeedsHelpMapInstance.invalidateSize();
    }
    dashNeedsHelpMapInstance.eachLayer((layer) => {
        if (layer instanceof L.Marker) dashNeedsHelpMapInstance.removeLayer(layer);
    });
    list.filter((s) => s.lastKnownLocation).forEach((s) => {
        L.marker([s.lastKnownLocation.lat, s.lastKnownLocation.lng])
            .addTo(dashNeedsHelpMapInstance)
            .bindPopup(`<b>${esc(s.name || s.phone || "Citizen")}</b><br>${esc(s.note || "No note")}`);
    });

    $("dashNeedsHelpSummary").innerHTML = list.length
        ? `<b style="font-size:22px;font-family:Outfit,sans-serif;color:${list.length ? "#ed4d54" : "#16855f"}">${list.length}</b> <span class="muted small">${list.length === 1 ? "person has" : "people have"} flagged needing help right now${list.length ? " — " + list.slice(0, 2).map((s) => esc(s.name || s.phone || "Citizen")).join(", ") + (list.length > 2 ? `, +${list.length - 2} more` : "") : ""}</span>`
        : '<span class="muted small">Nobody has flagged needing help right now.</span>';
}

function renderSystemStatus() {
    if (!$("systemStatus")) return;
    const sources = [
        { key: "weatherError", label: "Weather forecast (Open-Meteo)" },
        { key: "rainfallError", label: "Rainfall data (Open-Meteo)" },
        { key: "satelliteRainfallError", label: "Satellite rainfall (NASA POWER)" },
        { key: "slopeError", label: "Terrain slope (OpenTopoData)" },
        {
            key: "aiError",
            label: "AI risk model",
            // Distinct from the others: the backend only calls the AI
            // model once it has weather+slope, so a missing aiError
            // doesn't mean the AI model is fine — check riskLevel too.
            degraded: (z) => Boolean(z.aiError) || z.riskLevel === "Unavailable"
        }
    ];
    $("systemStatus").innerHTML = sources
        .map((s) => {
            const isDegraded = (z) => (s.degraded ? s.degraded(z) : Boolean(z[s.key]));
            const affected = S.zones.filter(isDegraded).length;
            const ok = affected === 0;
            return `<div class="status-row">
        <span><span class="status-dot ${ok ? "ok" : "degraded"}"></span>${s.label}</span>
        <span class="status-tag">${ok ? "Live across all zones" : `Degraded in ${affected}/${S.zones.length} zone(s)`}</span>
      </div>`;
        })
        .join("");
}

// ---- data loading ----
let seenCriticalZoneIds = new Set();

async function refreshZones() {
    const data = await api(`/api/dashboard/summary?locale=${S.locale}`);
    S.zones = data.data;
    S.generatedAt = data.generatedAt;
    renderStats();
    renderAlerts();
    renderPriorityTable();
    renderSystemStatus();
    $("trustLine").innerHTML = `● Monitoring ${S.zones.length} zones <b>Updated ${new Date(data.generatedAt).toLocaleTimeString()}</b>`;
    const options = S.zones.map((z) => `<option value="${z.zoneId}">${esc(z.zoneName)}</option>`).join("");
    ["locationSelect", "citizenLocationSearch", "alertZone", "headcountZone", "dispatchZone", "routeZone", "candidateZone", "trendZone", "simZoneSelect", "teamsZoneSelect"].forEach((id) => {
        if ($(id)) $(id).innerHTML = options;
    });
    if ($("controlRoomZone")) {
        const selected = S.controlRoomZoneId || S.selectedZoneId || S.zones[0]?.zoneId;
        $("controlRoomZone").innerHTML = options;
        $("controlRoomZone").value = selected;
        S.controlRoomZoneId = selected;
    }
    if (S.maps.over) {
        S.maps.over.remove();
        S.maps.over = null;
    }
    mapOverview();
    select(S.selectedZoneId || S.zones[0]?.zoneId);

    // Siren for a NEWLY critical zone — not every refresh, so it
    // doesn't nag every 15-30s while the same zone stays critical.
    const currentCritical = new Set(S.zones.filter((z) => z.priorityLevel === "Critical").map((z) => z.zoneId));
    let hasNewCritical = false;
    currentCritical.forEach((id) => {
        if (!seenCriticalZoneIds.has(id)) hasNewCritical = true;
    });
    if (hasNewCritical && seenCriticalZoneIds.size > 0) AudioAlert.siren();
    seenCriticalZoneIds = currentCritical;
}

async function refreshHistory(state) {
    const data = await api(`/api/history/landslides${state ? `?state=${encodeURIComponent(state)}` : ""}`);
    S.history = data.data;
    renderHistory();
    const selected = S.zones.find((z) => z.zoneId === S.selectedZoneId);
    if (selected) renderHistoricalHazards(selected);
}

async function refreshIncidents() {
    try {
        const data = await api("/api/incidents");
        S.incidents = data.data;
    } catch {
        S.incidents = [];
    }
    renderStats();
    renderQueue();
    renderMyReports();
}

async function refreshNeedsHelp() {
    if (S.user?.role !== "Official") return;
    try {
        const data = await api("/api/safety/needs-help");
        renderNeedsHelp(data.data);
    } catch (e) {
        renderNeedsHelp([]);
    }
}

let needsHelpPollTimer = null;
function startNeedsHelpPolling() {
    if (needsHelpPollTimer || S.user?.role !== "Official") return;
    needsHelpPollTimer = setInterval(refreshNeedsHelp, 20000);
}

let zonesPollTimer = null;
function startZonesPolling() {
    if (zonesPollTimer) return;
    // Keeps the Alerts page (and anywhere else showing S.zones) feeling
    // genuinely live rather than a one-time snapshot — re-pulls the
    // real computed data every 45s regardless of which page is open.
    zonesPollTimer = setInterval(() => {
        refreshZones().catch(() => {
            /* a single missed poll isn't worth interrupting the user with a toast */
        });
    }, 45000);
}

async function refreshAll() {
    await Promise.all([refreshZones(), refreshHistory(), refreshIncidents()]);
    await refreshNeedsHelp();
}

// ---- actions ----
window.verifyIncident = async (id, status) => {
    try {
        await api(`/api/incidents/${encodeURIComponent(id)}/status`, { method: "PUT", body: JSON.stringify({ status }) });
        await refreshIncidents();
        toast(`Incident ${status.toLowerCase()}`);
    } catch (e) {
        toast(e.message);
    }
};

window.attachEvidence = (id) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.multiple = true;
    input.onchange = async () => {
        if (!input.files.length) return;
        try {
            const urls = await uploadEvidenceFiles(input.files);
            if (!urls.length) return;
            await api(`/api/incidents/${encodeURIComponent(id)}/evidence`, { method: "PUT", body: JSON.stringify({ urls }) });
            await refreshIncidents();
            toast("Evidence attached");
        } catch (e) {
            toast(e.message);
        }
    };
    input.click();
};

async function uploadEvidenceFiles(fileList) {
    // Validate before sending, not after — matches the backend's own
    // limits (middleware/uploadMiddleware.js and demoServer.js's
    // MAX_EVIDENCE_FILES/MAX_EVIDENCE_FILE_BYTES) so a citizen finds
    // out a 4K video is too large immediately, not after waiting for
    // an upload to fail.
    const files = [...fileList];
    if (files.length > 5) {
        toast(`Too many files selected (${files.length}) — up to 5 at a time.`);
        return [];
    }
    const tooLarge = files.find((f) => f.size > 25 * 1024 * 1024);
    if (tooLarge) {
        toast(`"${tooLarge.name}" is too large (max 25MB per file).`);
        return [];
    }
    const wrongType = files.find((f) => !/^(image|video)\//.test(f.type));
    if (wrongType) {
        toast(`"${wrongType.name}" isn't an image or video — only those are accepted.`);
        return [];
    }

    const form = new FormData();
    files.forEach((f) => form.append("evidence", f));
    try {
        const data = await api("/api/upload/evidence", { method: "POST", body: form });
        return data.urls || [];
    } catch (e) {
        toast(`Couldn't upload evidence: ${e.message}`);
        return [];
    }
}

// ---- auth ----
function populateSelectors() {
    const backendHtml = API_BASES.map((b) => `<option value="${b.value}" ${b.value === S.apiBase ? "selected" : ""}>${b.label}</option>`).join("");
    if ($("loginApiBase")) $("loginApiBase").innerHTML = backendHtml;
    if ($("settingsApiBase")) $("settingsApiBase").innerHTML = backendHtml;

    const localeHtml = LOCALES.map((l) => `<option value="${l.code}" ${l.code === S.locale ? "selected" : ""}>${l.label}${l.review ? " ⚠" : ""}</option>`).join("");
    if ($("language")) $("language").innerHTML = localeHtml;
    if ($("settingsLanguage")) $("settingsLanguage").innerHTML = localeHtml;
    if ($("alertLocales")) $("alertLocales").innerHTML = LOCALES.map((l) => `<option value="${l.code}">${l.label}${l.review ? " ⚠" : ""}</option>`).join("");

    const reviewList = LOCALES.filter((l) => l.review).map((l) => l.label).join(", ");
    if ($("localeReviewNote")) $("localeReviewNote").textContent = `⚠ marked languages (${reviewList}) are best-effort translations flagged for native-speaker review — see backend/services/i18nService.js.`;
}

function applyRoleUI() {
    document.querySelectorAll(".citizen-only").forEach((x) => x.classList.toggle("hidden", S.user?.role !== "Citizen"));
    document.querySelectorAll(".official-only").forEach((x) => x.classList.toggle("hidden", S.user?.role !== "Official"));
    document.body.classList.toggle("role-official", S.user?.role === "Official");
    $("avatarBtn").textContent = (S.user?.name || "?")[0].toUpperCase();
    $("profileInitial").textContent = (S.user?.name || "?")[0].toUpperCase();
    $("profileName").textContent = S.user?.name || "—";
    $("profileEmail").textContent = S.user?.email || "—";
    $("profileRoleBadge").textContent = (S.user?.role || "citizen").toUpperCase() + " ACCOUNT";
    renderBackendModeBadge();
}

// Persistent, always-visible label for which backend this session is
// actually talking to (S.apiBase — set at login/Settings, see
// initSettings()'s $("settingsApiBase") handler). Two real backends
// exist by design (demoServer.js: zero-setup/in-memory vs server.js:
// MongoDB-backed) and a person can switch between them, so this exists
// purely so it's never ambiguous which one produced what's on screen —
// it reuses the same LIVE/DEMO badge styling as every other data-source
// label in this app (statusBadge()), not a new visual language.
function renderBackendModeBadge() {
    const el = $("backendModeBadge");
    if (!el) return;
    const isDemo = S.apiBase === API_BASES[0].value;
    el.innerHTML = statusBadge(isDemo ? "DEMO" : "LIVE");
    el.title = isDemo
        ? "Demo backend (demoServer.js, port 5050) — zero setup, in-memory data. Switch in Settings."
        : "Full backend (server.js, port 5000) — MongoDB-backed, real auth. Switch in Settings.";
}

async function enterApp() {
    $("loginScreen").classList.add("hidden");
    $("bootLoader").classList.remove("hidden");
    applyRoleUI();
    populateSelectors();
    try {
        await refreshAll();
    } catch (e) {
        toast(e.message);
    }
    $("bootLoader").classList.add("hidden");
    startNeedsHelpPolling();
    startZonesPolling();
    initAgencyCheckboxes();
    if (S.user.role === "Official") {
        initAlertLogPanel();
        initResponseWorkflow();
    } else {
        autoDetectCitizenLocation();
    }
    go(S.user.role === "Official" ? "officialDashboard" : "home");
}

async function loginOrRegister(name, email, password, role) {
    try {
        return await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password, role }) });
    } catch (loginError) {
        // A 403 means the account exists under a different role — that's
        // a real, actionable error (wrong workspace chosen), not "no
        // account yet". Surface it directly instead of masking it behind
        // a confusing "already registered" error from the register
        // fallback below.
        if (loginError.status === 403) throw loginError;

        const reg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password, role }) });
        if (reg.token) return reg; // demo backend returns a token immediately
        return await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password, role }) }); // real backend: register then login
    }
}

function initAuth() {
    let role = "Citizen";
    document.querySelectorAll(".role-choice").forEach((btn) => {
        btn.onclick = () => {
            role = btn.dataset.role;
            document.querySelectorAll(".role-choice").forEach((y) => y.classList.toggle("selected", y === btn));
            $("authSubmit").textContent = `Enter ${role.toLowerCase()} workspace →`;
        };
    });

    $("authForm").onsubmit = async (e) => {
        e.preventDefault();
        try {
            const name = $("name").value.trim() || "Demo User";
            const email = $("email").value.trim();
            const password = $("password").value;
            const result = await loginOrRegister(name, email, password, role);
            S.token = result.token;
            S.user = result.user;
            localStorage.setItem("nerToken", S.token);
            localStorage.setItem("nerUser", JSON.stringify(S.user));
            await enterApp();
        } catch (err) {
            toast(err.message);
        }
    };

    $("demoBtn").onclick = async () => {
        try {
            const suffix = Date.now();
            const result = await loginOrRegister("Demo Citizen", `demo-${suffix}@sentinel.local`, "demo1234", "Citizen");
            S.token = result.token;
            S.user = result.user;
            localStorage.setItem("nerToken", S.token);
            localStorage.setItem("nerUser", JSON.stringify(S.user));
            await enterApp();
            toast("Demo workspace ready");
        } catch (err) {
            toast(err.message);
        }
    };

    $("avatarBtn").onclick = () => go("profile");

    $("logoutBtn").onclick = () => {
        localStorage.removeItem("nerToken");
        localStorage.removeItem("nerUser");
        location.reload();
    };
}

// ---- page-specific wiring ----
function initReportForm() {
    $("reportGps").onclick = () =>
        getPosition((p) => {
            S.reportLocation = p;
            const z = nearestZone(p.lat, p.lng);
            $("reportGpsStatus").textContent = `${p.estimated ? "Estimated" : "GPS"} location set near ${z?.zoneName || "your area"} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`;
        });

    $("evidenceHint").textContent = "";
    $("evidence").onchange = () => {
        $("evidenceHint").textContent = $("evidence").files.length ? `${$("evidence").files.length} file(s) selected` : "";
    };

    $("reportForm").onsubmit = async (e) => {
        e.preventDefault();
        try {
            const form = new FormData(e.target);
            const type = form.get("type");
            const locationText = form.get("location");
            const description = `[${type}] ${locationText ? locationText + " — " : ""}${form.get("description")}`;
            const loc = S.reportLocation || { lat: S.zones[0]?.lat, lng: S.zones[0]?.lng };

            let evidence = [];
            if ($("evidence").files.length) evidence = await uploadEvidenceFiles($("evidence").files);

            const { incident } = await api("/api/incidents", {
                method: "POST",
                body: JSON.stringify({ description, location: { lat: loc.lat, lng: loc.lng }, evidence, reportedBy: S.user?.name })
            });
            S.incidents.unshift(incident);
            renderMyReports();
            renderStats();
            e.target.reset();
            $("evidenceHint").textContent = "";
            toast("Report sent for review");
        } catch (err) {
            toast(err.message);
        }
    };
}

function initSafetyPage() {
    const sendStatus = (status) => {
        const finish = async (p) => {
            try {
                const note = $("safetyNote").value.trim();
                const data = await api(`/api/safety/status?locale=${S.locale}`, {
                    method: "POST",
                    body: JSON.stringify({ status, note, lat: p?.lat, lng: p?.lng })
                });
                $("safetyStatusResult").innerHTML = `<b>${esc(data.statusLabelLocalized)}</b> — recorded ${new Date().toLocaleTimeString()}${p?.manual ? " (pin dropped manually)" : ""}`;
                toast("Status updated");
                if (S.user?.role === "Official") refreshNeedsHelp();
            } catch (e) {
                if (e.queued) {
                    $("safetyStatusResult").innerHTML = `<b>CACHED — ${esc(status)}</b> — will be sent automatically when this device reconnects.`;
                }
                toast(e.message);
            }
        };

        getPosition(
            (p) => {
                $("gpsAccuracy").textContent = p.accuracy ? `GPS accuracy: ~${Math.round(p.accuracy)}m` : "";
                finish(p);
            },
            () => {
                // GPS denied/unavailable — offer the manual pin-drop map instead of silently guessing.
                $("pinDropHint").classList.remove("hidden");
                $("safetyPinMap").classList.remove("hidden");
                if (!S.maps.safetyPin) {
                    S.maps.safetyPin = initPinMap("safetyPinMap", (p) => finish(p));
                } else {
                    S.maps.safetyPin.invalidateSize();
                }
                toast("GPS unavailable — tap the map to set your location.");
            }
        );
    };
    $("markSafe").onclick = () => sendStatus("Safe");
    $("markHelp").onclick = () => sendStatus("NeedHelp");
    $("safetyGps").onclick = () =>
        getPosition(
            (p) => {
                $("gpsAccuracy").textContent = p.accuracy ? `GPS accuracy: ~${Math.round(p.accuracy)}m` : "";
                toast(`GPS captured: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`);
            },
            () => {
                $("pinDropHint").classList.remove("hidden");
                $("safetyPinMap").classList.remove("hidden");
                if (!S.maps.safetyPin) S.maps.safetyPin = initPinMap("safetyPinMap", () => toast("Location pin set"));
            }
        );

    $("watchLocationToggle").onchange = (e) => {
        if (e.target.checked) {
            startWatchingLocation(async (p) => {
                $("gpsAccuracy").textContent = `Live tracking — accuracy ~${Math.round(p.accuracy || 0)}m`;
                try {
                    await api("/api/safety/location", { method: "POST", body: JSON.stringify({ lat: p.lat, lng: p.lng }) });
                } catch {
                    /* silent — a single failed background ping isn't worth interrupting the user */
                }
            });
            toast("Sharing your live location while this page is open.");
        } else {
            stopWatchingLocation();
            $("gpsAccuracy").textContent = "";
            toast("Stopped sharing live location.");
        }
    };

    $("registerPhoneBtn").onclick = async () => {
        const phone = $("phoneForSms").value.trim();
        if (!/^\+\d{8,15}$/.test(phone)) return toast("Enter your number in international format, e.g. +919876543210");
        try {
            await api(`/api/safety/status?locale=${S.locale}`, {
                method: "POST",
                body: JSON.stringify({ status: "Safe", phone, note: "Phone registered for SMS reply" })
            });
            toast("Phone registered — you can now reply SAFE or HELP by SMS.");
        } catch (e) {
            toast(e.message);
        }
    };

    $("refreshNeedsHelp").onclick = refreshNeedsHelp;
}

function initOfficialAlertPanel() {
    $("sendAlertBtn").onclick = async () => {
        const zoneId = $("alertZone").value;
        const locales = [...$("alertLocales").selectedOptions].map((o) => o.value);
        try {
            const data = await api("/api/alerts/trigger", { method: "POST", body: JSON.stringify({ zoneId, locales: locales.length ? locales : ["en"] }) });
            const text = data.wouldSend || data.alertText || "(no message returned)";
            $("alertResult").innerHTML = `<b>${data.result && !data.result.simulated ? "Sent via Twilio" : "Simulated (no Twilio configured)"}</b><pre style="white-space:pre-wrap;font:inherit;margin:8px 0 0">${esc(text)}</pre>`;
            toast("Alert triggered");
        } catch (e) {
            toast(e.message);
        }
    };
}

async function initAgencyCheckboxes() {
    if (!$("agencyCheckboxes") || S.user?.role !== "Official") return;
    try {
        const data = await api("/api/alerts/agencies");
        $("agencyCheckboxes").innerHTML = data.data
            .map(
                (a) => `<label class="${a.configured ? "configured" : ""}"><input type="checkbox" value="${a.id}"> ${esc(a.label)}<span class="tag-off">${a.configured ? "configured" : "not configured"}</span></label>`
            )
            .join("");
    } catch (e) {
        $("agencyCheckboxes").innerHTML = `<div class="empty">Couldn't load agency list: ${esc(e.message)}</div>`;
    }
}

function initHeadcountPanel() {
    $("headcountBtn").onclick = async () => {
        const zone = S.zones.find((z) => z.zoneId === $("headcountZone").value);
        if (!zone) return toast("Pick a zone first");
        const radiusKm = Number($("headcountRadius").value) || 5;
        try {
            const data = await api(`/api/safety/count?lat=${zone.lat}&lng=${zone.lng}&radiusKm=${radiusKm}`);
            $("headcountResult").innerHTML = `<div class="headcount-grid">
        <div><b>${data.totalReporting}</b><span>Total reporting</span></div>
        <div><b>${data.safe}</b><span>Safe</span></div>
        <div><b>${data.needHelp}</b><span>Need help</span></div>
        <div><b>${data.unknown}</b><span>Unknown</span></div>
      </div>`;
        } catch (e) {
            toast(e.message);
        }
    };

    $("possiblyAffectedBtn").onclick = async () => {
        const zone = S.zones.find((z) => z.zoneId === $("headcountZone").value);
        if (!zone) return toast("Pick a zone in the field above first");
        const radiusKm = Number($("headcountRadius").value) || 5;
        const sinceCutoff = $("possiblyAffectedSince").value ? new Date($("possiblyAffectedSince").value).toISOString() : "";
        try {
            const data = await api(`/api/safety/possibly-affected?lat=${zone.lat}&lng=${zone.lng}&radiusKm=${radiusKm}${sinceCutoff ? `&sinceCutoff=${sinceCutoff}` : ""}`);
            $("possiblyAffectedResult").innerHTML = data.data.length
                ? data.data
                      .map((p) => `<div class="queue-item"><div><b>${esc(p.name)}</b><small>${p.distanceFromZoneKm}km away · last update ${new Date(p.updatedAt).toLocaleString()}</small></div><span>${esc(p.status)}</span></div>`)
                      .join("")
                : '<div class="empty">Nobody matches right now.</div>';
        } catch (e) {
            toast(e.message);
        }
    };
}

function initDispatchPanel() {
    $("dispatchBtn").onclick = async () => {
        const agencies = [...document.querySelectorAll("#agencyCheckboxes input:checked")].map((c) => c.value);
        if (!agencies.length) return toast("Select at least one agency");
        const zoneId = $("dispatchZone").value;
        const zone = S.zones.find((z) => z.zoneId === zoneId);
        try {
            const data = await api("/api/alerts/dispatch-agencies", {
                method: "POST",
                body: JSON.stringify({
                    zoneId,
                    agencies,
                    reason: $("dispatchReason").value,
                    population: zone?.population?.estimatedPopulation ?? "unknown",
                    locale: S.locale
                })
            });
            $("dispatchResult").innerHTML = data.results
                .map((r) => `<div><b>${esc(r.agency)}</b>: ${r.sent ? "sent via Twilio" : "simulated / " + esc(r.reason || "no real send")}<pre style="white-space:pre-wrap;font:inherit;margin:4px 0 10px;font-size:12px">${esc(r.message || r.wouldSend)}</pre></div>`)
                .join("");
            toast("Dispatch attempted");
        } catch (e) {
            toast(e.message);
        }
    };
}

function initRoutingPanel() {
    let routeStart = null;
    let currentRouteData = null;
    let routeMapInstance = null;
    let routeLayers = [];

    $("routeGpsBtn").onclick = () =>
        getPosition(
            (p) => {
                routeStart = p;
                $("routeStartLabel").textContent = `Start: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
            },
            () => toast("Couldn't get your location — check browser GPS permission.")
        );

    const drawRoute = (data) => {
        if (!routeMapInstance) routeMapInstance = L.map("routeMap");
        else routeLayers.forEach((l) => routeMapInstance.removeLayer(l));
        routeLayers = [];

        if (!routeMapInstance._hasTileLayer) {
            L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(routeMapInstance);
            routeMapInstance._hasTileLayer = true;
        }

        data.routes.forEach((r) => {
            const latlngs = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
            const isRecommended = r.index === data.recommendedIndex;
            const line = L.polyline(latlngs, routeLineStyle(isRecommended, data.simulated)).addTo(routeMapInstance);
            routeLayers.push(line);
        });
        const bounds = L.latLngBounds(routeLayers.flatMap((l) => l.getLatLngs()));
        routeMapInstance.fitBounds(bounds, { padding: [20, 20] });
        setTimeout(() => routeMapInstance.invalidateSize(), 100);
    };

    $("getRouteBtn").onclick = async () => {
        if (!routeStart) return toast("Set a starting point first (use my current location)");
        const toZoneId = $("routeZone").value;
        try {
            const data = await api(`/api/route?fromLat=${routeStart.lat}&fromLng=${routeStart.lng}&toZoneId=${toZoneId}`);
            currentRouteData = data;
            drawRoute(data);
            $("routeResult").innerHTML =
                (data.simulated ? '<div class="notice small">Live routing unavailable right now — showing a simulated straight-line estimate instead. The panel never just shows a blank error.</div>' : "") +
                `<p class="muted small">${esc(data.source)}</p>` +
                data.routes
                    .map(
                        (r) =>
                            `<div class="route-alt ${r.index === data.recommendedIndex ? "recommended" : ""}"><b>${r.index === data.recommendedIndex ? "✓ Recommended" : "Alternative"} — ${r.distanceKm}km, ~${r.durationMin} min${data.simulated ? " (simulated)" : ""}</b>${esc(r.riskAdvisory)}</div>`
                    )
                    .join("");
        } catch (e) {
            $("routeResult").innerHTML = `<div class="notice small">Routing failed: ${esc(e.message)}. This needs real internet access to reach OSRM's public routing server.</div>`;
        }
    };
}

// ============================================================
// RESPONSE workflow: department alerts, response teams, real OSRM
// routing per dispatch (shortest vs. low-risk), and status progression.
// Official-only — gated by the .official-only sections in index.html
// and by the backend requiring an Official token on every call.
// ============================================================
const statusPill = (status) => `<span class="status-pill ${status}">${esc(String(status).replace(/_/g, " "))}</span>`;

async function refreshResponseIncidents() {
    if (S.user?.role !== "Official" || !$("responseIncidentList")) return;
    try {
        const data = await api("/api/response/incidents");
        S.responseIncidents = data.data;
    } catch {
        S.responseIncidents = [];
    }
    renderResponseIncidents();
    renderResponseTeamsTable(); // incident dropdown options in the teams table depend on this list too
}

function renderResponseIncidents() {
    if (!$("responseIncidentList")) return;
    if (!S.responseIncidents.length) {
        $("responseIncidentList").innerHTML = '<div class="empty">No response incidents yet — use "Trigger Landslide" above to create one and dispatch department alerts.</div>';
        return;
    }
    $("responseIncidentList").innerHTML = [...S.responseIncidents]
        .reverse()
        .map((inc) => {
            const deptAlerts = inc.departmentAlerts
                .map((a) => {
                    let nextBtn = "";
                    if (inc.status === "Active") {
                        if (a.status === "SENT") nextBtn = `<button onclick="window.advanceAlert('${inc.id}','${a.id}','ACKNOWLEDGED')">Acknowledge</button>`;
                        else if (a.status === "ACKNOWLEDGED") nextBtn = `<button onclick="window.advanceAlert('${inc.id}','${a.id}','RESPONDING')">Mark Responding</button>`;
                        else if (a.status === "RESPONDING") nextBtn = `<button onclick="window.advanceAlert('${inc.id}','${a.id}','RESOLVED')">Resolve</button>`;
                    }
                    return `<div class="dept-alert"><b>${esc(a.departmentLabel)} ${statusPill(a.status)}</b><span class="muted">${esc(a.dispatchMethod)}</span>${nextBtn ? `<div class="dept-actions">${nextBtn}</div>` : ""}</div>`;
                })
                .join("");
            return `<div class="incident-card ${inc.status === "Resolved" ? "resolved" : ""}">
        <div class="incident-head">
          <div><h3>${esc(inc.type)} — ${esc(inc.zoneName)} <span class="pill Critical">${esc(inc.severity)}</span></h3>
          <small class="muted">${esc(inc.id)} · created ${new Date(inc.createdAt).toLocaleTimeString()}${inc.resolvedAt ? " · resolved " + new Date(inc.resolvedAt).toLocaleTimeString() : ""} <span class="demo-tag">DEMO</span></small></div>
          ${inc.status === "Active" ? `<button class="btn ghost" onclick="window.completeIncidentAction('${inc.id}')">✅ Complete Incident</button>` : '<span class="secure">RESOLVED</span>'}
        </div>
        <div class="dept-alert-grid">${deptAlerts}</div>
      </div>`;
        })
        .join("");
}

window.advanceAlert = async (incidentId, alertId, status) => {
    try {
        await api(`/api/response/incidents/${encodeURIComponent(incidentId)}/alerts/${encodeURIComponent(alertId)}`, { method: "PUT", body: JSON.stringify({ status }) });
        toast(`Department alert marked ${status}`);
        await refreshResponseIncidents();
    } catch (e) {
        toast(e.message);
    }
};

window.completeIncidentAction = async (incidentId) => {
    try {
        await api(`/api/response/incidents/${encodeURIComponent(incidentId)}/complete`, { method: "POST" });
        toast("Incident marked resolved — alerts and teams closed out");
        await Promise.all([refreshResponseIncidents(), refreshResponseTeams()]);
        renderResponseRoute(null);
    } catch (e) {
        toast(e.message);
    }
};

async function refreshResponseTeams() {
    if (S.user?.role !== "Official" || !$("responseTeamsTable")) return;
    const zoneId = $("teamsZoneSelect")?.value || "";
    try {
        const data = await api(`/api/response/teams${zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : ""}`);
        S.responseTeams = data.data;
    } catch {
        S.responseTeams = [];
    }
    renderResponseTeamsTable();
}

function renderResponseTeamsTable() {
    if (!$("responseTeamsTable")) return;
    if (!S.responseTeams.length) {
        $("responseTeamsTable").innerHTML = '<div class="empty">No teams loaded for this zone yet.</div>';
        return;
    }
    const activeIncidents = (S.responseIncidents || []).filter((i) => i.status === "Active");
    const incidentOptions = activeIncidents.map((i) => `<option value="${esc(i.id)}">${esc(i.id)} — ${esc(i.zoneName)}</option>`).join("");
    const rows = S.responseTeams
        .map((t) => {
            let actionsHtml;
            if (t.status === "READY") {
                actionsHtml = activeIncidents.length
                    ? `<select id="incSelect-${esc(t.id)}">${incidentOptions}</select> <button onclick="window.dispatchTeamAction('${t.id}')">🚚 Dispatch</button>`
                    : `<span class="muted small">No active incident</span>`;
            } else {
                actionsHtml = `<button onclick="window.viewTeamRoute('${t.id}')">🗺 View route</button>`;
            }
            return `<tr>
          <td><b>${esc(t.name)}</b></td>
          <td>${esc(t.departmentLabel)}</td>
          <td>${t.location.lat.toFixed(4)}, ${t.location.lng.toFixed(4)}</td>
          <td>${statusPill(t.status)}</td>
          <td>${t.eta ? esc(t.eta) : "—"}</td>
          <td>${t.assignedIncidentId ? esc(t.assignedIncidentId) : "—"}</td>
          <td>${actionsHtml}</td>
        </tr>`;
        })
        .join("");
    $("responseTeamsTable").innerHTML =
        `<table><thead><tr><th>Team</th><th>Department</th><th>Location</th><th>Status</th><th>ETA</th><th>Incident</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>` +
        `<p class="muted small" style="margin-top:8px">Simulated roster and starting locations. <span class="demo-tag">DEMO</span></p>`;
}

window.dispatchTeamAction = async (teamId) => {
    const sel = $(`incSelect-${teamId}`);
    if (!sel || !sel.value) return toast("No active incident to dispatch to");
    try {
        const data = await api(`/api/response/teams/${encodeURIComponent(teamId)}/dispatch`, { method: "POST", body: JSON.stringify({ incidentId: sel.value }) });
        toast(data.message);
        await Promise.all([refreshResponseTeams(), refreshResponseIncidents()]);
        renderResponseRoute(data.data);
        $("panel-responseRoute")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
        toast(e.message);
    }
};

window.viewTeamRoute = (teamId) => {
    const team = S.responseTeams.find((t) => t.id === teamId);
    if (!team) return;
    renderResponseRoute(team);
    $("panel-responseRoute")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.advanceTeamStatus = async (teamId, status) => {
    try {
        const data = await api(`/api/response/teams/${encodeURIComponent(teamId)}/status`, { method: "PUT", body: JSON.stringify({ status }) });
        toast(data.message);
        await Promise.all([refreshResponseTeams(), refreshResponseIncidents()]);
        renderResponseRoute(status === "RESOLVED" ? null : data.data);
    } catch (e) {
        toast(e.message);
    }
};

let responseRouteMapInstance = null;
let responseRouteLayers = [];
const TEAM_STATUS_ORDER = ["DISPATCHED", "EN_ROUTE", "ARRIVED", "RESOLVED"];
const TEAM_STATUS_LABEL = { DISPATCHED: "Dispatched", EN_ROUTE: "En Route", ARRIVED: "Arrived", RESOLVED: "Resolved" };

function renderResponseRoute(team) {
    if (!$("responseRouteCards")) return;
    if (!team || !team.route) {
        $("responseRouteHint").textContent = "Dispatch a team above (Response Teams panel) to see its real route here.";
        $("responseRouteMap").classList.add("hidden");
        $("responseRouteCards").innerHTML = "";
        $("responseTeamStatusRow").innerHTML = "";
        return;
    }
    const s = team.route.shortest,
        l = team.route.lowRisk;
    $("responseRouteHint").textContent = `${team.name} → ${esc(team.zoneName)} landslide site`;
    $("responseRouteMap").classList.remove("hidden");

    const cards = [];
    cards.push(
        `<div class="route-card ${!l ? "recommended" : ""}"><h4>Shortest route</h4><div class="rc-figures"><div><b>${s.distanceKm}km</b><span>Distance</span></div><div><b>${s.durationMin} min</b><span>ETA</span></div><div><b>${esc(s.risk)}</b><span>Risk</span></div></div><p class="muted small">${esc(s.riskAdvisory)}</p></div>`
    );
    if (l) {
        cards.push(
            `<div class="route-card recommended"><h4>✓ Low-risk route</h4><div class="rc-figures"><div><b>${l.distanceKm}km</b><span>Distance</span></div><div><b>${l.durationMin} min</b><span>ETA</span></div><div><b>${esc(l.risk)}</b><span>Risk</span></div></div><p class="muted small">${esc(l.riskAdvisory)}</p></div>`
        );
    } else {
        cards.push(`<div class="route-card"><h4>Low-risk route</h4><div class="rc-unavailable">${esc(team.route.lowRiskNote || "Live road condition data unavailable.")}</div></div>`);
    }
    $("responseRouteCards").innerHTML =
        cards.join("") + `<p class="muted small" style="grid-column:1/-1">${esc(team.route.source)}${team.route.simulated ? " — simulated fallback, not a live route" : ""}</p>`;

    if (!responseRouteMapInstance) responseRouteMapInstance = L.map("responseRouteMap");
    else responseRouteLayers.forEach((x) => responseRouteMapInstance.removeLayer(x));
    responseRouteLayers = [];
    if (!responseRouteMapInstance._hasTileLayer) {
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(responseRouteMapInstance);
        responseRouteMapInstance._hasTileLayer = true;
    }
    const drawLine = (r, isRecommended) => {
        if (!r?.geometry?.coordinates) return;
        const latlngs = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        responseRouteLayers.push(L.polyline(latlngs, routeLineStyle(isRecommended, team.route.simulated)).addTo(responseRouteMapInstance));
    };
    drawLine(s, !l);
    if (l) drawLine(l, true);
    if (responseRouteLayers.length) {
        responseRouteMapInstance.fitBounds(L.latLngBounds(responseRouteLayers.flatMap((x) => x.getLatLngs())), { padding: [20, 20] });
        setTimeout(() => responseRouteMapInstance.invalidateSize(), 100);
    }

    const idx = TEAM_STATUS_ORDER.indexOf(team.status);
    $("responseTeamStatusRow").innerHTML = TEAM_STATUS_ORDER.map((st, i) => {
        if (i === idx + 1) return `<button onclick="window.advanceTeamStatus('${team.id}','${st}')">${TEAM_STATUS_LABEL[st]} →</button>`;
        return `<button class="${i === idx ? "current" : ""}" disabled style="${i < idx ? "opacity:.5" : ""}">${TEAM_STATUS_LABEL[st]}</button>`;
    }).join("");
}

function initResponseWorkflow() {
    if (!$("triggerCriticalBtn") || $("triggerCriticalBtn")._wired) return;
    $("triggerCriticalBtn")._wired = true;

    $("triggerCriticalBtn").onclick = async () => {
        const zoneId = $("simZoneSelect").value;
        if (!zoneId) return toast("Pick a zone first");
        try {
            const data = await api("/api/response/trigger-critical-risk", { method: "POST", body: JSON.stringify({ zoneId }) });
            $("demoControlsResult").innerHTML = `<b>${esc(data.message)}</b>`;
            toast("Critical risk simulated");
        } catch (e) {
            toast(e.message);
        }
    };
    $("triggerLandslideBtn").onclick = async () => {
        const zoneId = $("simZoneSelect").value;
        if (!zoneId) return toast("Pick a zone first");
        try {
            const data = await api("/api/response/trigger-landslide", { method: "POST", body: JSON.stringify({ zoneId }) });
            $("demoControlsResult").innerHTML = `<b>${esc(data.message)}</b>`;
            toast("Landslide incident created — department alerts dispatched");
            await Promise.all([refreshResponseIncidents(), refreshResponseTeams()]);
            $("panel-deptAlerts")?.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (e) {
            toast(e.message);
        }
    };
    $("generateCitizensBtn").onclick = async () => {
        const zoneId = $("simZoneSelect").value;
        if (!zoneId) return toast("Pick a zone first");
        try {
            const data = await api(`/api/demo/citizens?zoneId=${encodeURIComponent(zoneId)}`);
            $("demoControlsResult").innerHTML = `<b>Generated ${data.total} demo citizens near ${esc(data.zoneName)}</b> — Safe: ${data.counts.safe}, Need help: ${data.counts.needHelp}, No response: ${data.counts.noResponse}. See them on the Risk Map by selecting this zone.`;
            toast("Demo citizens generated");
        } catch (e) {
            toast(e.message);
        }
    };
    $("generateHelpBtn").onclick = async () => {
        const zoneId = $("simZoneSelect").value;
        if (!zoneId) return toast("Pick a zone first");
        try {
            const data = await api("/api/demo/help-requests", { method: "POST", body: JSON.stringify({ zoneId, count: 5 }) });
            $("demoControlsResult").innerHTML = `<b>${esc(data.message)}</b>`;
            toast("Help requests generated");
            if (typeof refreshNeedsHelp === "function") refreshNeedsHelp();
        } catch (e) {
            toast(e.message);
        }
    };
    $("refreshIncidentsBtn").onclick = () => refreshResponseIncidents();
    $("teamsZoneSelect").onchange = () => refreshResponseTeams();

    refreshResponseIncidents();
    refreshResponseTeams();
    setInterval(() => {
        if (S.user?.role === "Official") {
            refreshResponseIncidents();
            refreshResponseTeams();
        }
    }, 30000);
}

// Tiny zero-dependency inline SVG sparkline — no charting library needed.
function renderSparkline(containerId, points, options = {}) {
    const el = $(containerId);
    if (!el) return;
    if (!points.length) {
        el.innerHTML = '<div class="empty">No history yet — see the note above.</div>';
        return;
    }
    const w = 560, h = 120, pad = 10;
    const values = points.map((p) => p.riskScore ?? 0);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 100);
    const x = (i) => pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((v - min) / Math.max(max - min, 1)) * (h - pad * 2);
    const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const last = values[values.length - 1];
    const color = last >= 75 ? "#ed4d54" : last >= 50 ? "#ff982f" : last >= 25 ? "#e5b72b" : "#27b889";

    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:120px">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"/>
    <circle cx="${x(values.length - 1)}" cy="${y(last)}" r="4" fill="${color}"/>
  </svg>
  <div class="muted small">${points.length} observed points · latest: <b style="color:${color}">${last}</b>/100 (${esc(points[points.length - 1].riskLevel || "—")})</div>`;
}

function initCandidatePanel() {
    if (!$("candidateBtn")) return;
    $("candidateBtn").onclick = async () => {
        const zone = S.zones.find((z) => z.zoneId === $("candidateZone").value);
        if (!zone) return toast("Pick a zone first");
        $("candidateResult").innerHTML = '<div class="muted small">Checking AI risk, thresholds, satellite rainfall and nearby reports…</div>';
        try {
            const data = await api("/api/intelligence/candidate", { method: "POST", body: JSON.stringify({ lat: zone.lat, lng: zone.lng }) });
            $("candidateResult").innerHTML = `
        <div class="notice small" style="background:${data.candidate ? "#fff0f0" : "#e8faf3"};border-color:${data.candidate ? "#f3c2c2" : "#b7e8d3"};color:${data.candidate ? "#c0392b" : "#16855f"}">
          <b>${data.candidate ? "⚠ Candidate — needs verification" : "No candidate signal"}</b><br>${esc(data.disclaimer)}
        </div>
        <div class="factor-list">
          <div><span>AI risk<b>${data.signals.mlRisk.riskLevel} (${data.signals.mlRisk.riskScore})</b></span></div>
          <div><span>Rule thresholds<b>${data.signals.threshold.isCritical ? "Critical" : "Not crossed"}</b></span></div>
          <div><span>Nearby pending reports<b>${data.signals.citizenReportCount}</b></span></div>
          <div><span>Satellite rainfall<b>${data.signals.satellite.totalMmOverWindow != null ? data.signals.satellite.totalMmOverWindow + " mm" : data.signals.satellite.note}</b></span></div>
        </div>`;
        } catch (e) {
            $("candidateResult").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
        }
    };
}

function initTrendPanel() {
    if (!$("trendBtn")) return;
    $("trendBtn").onclick = async () => {
        const zoneId = $("trendZone").value;
        try {
            const data = await api(`/api/risk-history?zoneId=${zoneId}&hours=24`);
            if (data.note) $("trendChart").innerHTML = `<div class="empty">${esc(data.note)}</div>`;
            renderSparkline("trendChart", data.points || []);
        } catch (e) {
            $("trendChart").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
        }
    };
}

function initSmsSimulatePanel() {
    if (!$("simSmsBtn")) return;
    $("simSmsBtn").onclick = async () => {
        const from = $("simPhone").value.trim();
        const body = $("simBody").value.trim();
        if (!from) return toast("Enter a phone number");
        try {
            const data = await api("/api/sms/simulate", { method: "POST", body: JSON.stringify({ from, body }) });
            $("simSmsResult").innerHTML = `<b>${data.ok ? (data.status === "NeedHelp" ? "🆘 Marked Need Help" : "✅ Marked Safe") : "Not recognized"}</b><br>Reply sent: "${esc(data.reply)}"`;
            toast("Simulated SMS processed");
            refreshNeedsHelp();
        } catch (e) {
            toast(e.message);
        }
    };
}

const alertKindLabel = (type) => ({ "auto-threshold": "⚡ Auto (threshold)", "manual-trigger": "👤 Manual trigger", "agency-dispatch": "📡 Agency dispatch" }[type] || type);

function renderAlertLogEntries(containerId, entries) {
    if (!$(containerId)) return;
    $(containerId).innerHTML = entries.length
        ? entries
              .map(
                  (a) =>
                      `<div class="queue-item"><div><b>${alertKindLabel(a.type)} — ${esc(a.zoneName)}</b><small>${a.agency ? esc(a.agency) + " · " : ""}${esc(a.trigger || a.note || "")} · ${new Date(a.at).toLocaleString()}</small></div><span>${a.sent ? "Sent" : "Simulated"}</span></div>`
              )
              .join("")
        : '<div class="empty">No alerts dispatched yet this session.</div>';
}

async function fetchRecentAlerts(limit = 20) {
    try {
        const data = await api(`/api/alerts/log?limit=${limit}`);
        return data.data;
    } catch {
        return [];
    }
}

function initAlertLogPanel() {
    const load = async () => renderAlertLogEntries("alertLogList", await fetchRecentAlerts(20));
    $("refreshAlertLog").onclick = load;
    load();
    setInterval(() => {
        if (S.user?.role === "Official") load();
    }, 30000);
}

// ---- Official Dashboard (the distinct landing page for officials) ----
const TOOL_TILES = [
    { icon: "ti-map-2", title: "Responder routing", desc: "Real OSRM road routing with a low-risk advisory for any responder type.", panel: "panel-routing", page: "official" },
    { icon: "ti-brain", title: "Candidate incident detection", desc: "AI + rule thresholds + nearby citizen reports combined — never auto-confirmed.", panel: "panel-candidate", page: "official" },
    { icon: "ti-chart-line", title: "Risk trend history", desc: "Real observed risk-score history from stored snapshots, not a fake chart.", panel: "panel-riskTrend", page: "official" },
    { icon: "ti-users-group", title: "Real headcount & possibly affected", desc: "Actual counts near any zone — not the dashboard's density estimate.", panel: "panel-headcount", page: "official" },
    { icon: "ti-broadcast", title: "Multi-agency dispatch", desc: "Notify Police, Fire, Medical and Disaster Management separately.", panel: "panel-dispatch", page: "official" },
    { icon: "ti-users-group", title: "Eight-department response teams", desc: "Assign and track Police, Disaster Management, Medical, Fire & Rescue, Search & Rescue, NGOs, Local Administration and Roads / PWD.", panel: "panel-responseTeams", page: "official" },
    { icon: "ti-message-2", title: "SMS reply, no app needed", desc: "Citizens reply SAFE or HELP by plain text. Demo it without ngrok.", panel: "panel-smsSimulate", page: "official" },
    { icon: "ti-list-check", title: "Field report queue", desc: "Verify or reject citizen reports, attach your own field evidence.", panel: "panel-queue", page: "official" },
    { icon: "ti-bell-ringing", title: "Trigger a critical alert", desc: "Push the same multilingual SMS alert the scheduler sends automatically.", panel: "panel-trigger", page: "official" },
    { icon: "ti-history", title: "Alert activity log", desc: "Every automatic and manual dispatch, so nothing happens silently.", panel: "panel-alertLog", page: "official" },
    { icon: "ti-clock-history", title: "Historical incident data", desc: "17 real NER landslide events, from routine to the largest disasters.", panel: null, page: "history" }
];

let officialControlMap = null;
let officialControlLayers = [];
const sourceBadge = (value) => `<span class="source-badge ${String(value || "UNAVAILABLE").toLowerCase()}">${esc(value || "UNAVAILABLE")}</span>`;

function controlRoomDetail(zone) {
    const status = zone?.dataStatus || {};
    const metric = (label, value, state) => `<div class="control-metric"><span>${esc(label)}</span><b>${esc(value ?? "—")}</b>${state ? sourceBadge(state) : ""}</div>`;
    if (!zone) {
        $("controlRoomDetail").innerHTML = '<div class="empty">No monitored zone is currently available.</div>';
        return;
    }
    const rainfall = zone.cumulativeRainfallMm?.["24h"] != null ? `${zone.cumulativeRainfallMm["24h"]} mm / 24h` : "Unavailable";
    const warning = zone.earlyWarning?.statusLabel || "No warning status";
    $("controlRoomDetail").innerHTML = `
      <div class="control-zone-title"><div><p class="eyebrow">SELECTED RISK ZONE</p><h3>${esc(zone.zoneName)}</h3>${zone.district ? `<p class="muted small" style="margin:2px 0 0">${esc(zone.district)}</p>` : ""}</div><span class="pill ${esc(zone.priorityLevel)}">${esc(zone.priorityLevelLocalized || zone.priorityLevel)}</span></div>
      <div class="control-risk"><b>${esc(zone.priorityScore)}/100</b><span>Emergency priority · AI risk ${esc(zone.riskLevelLocalized || zone.riskLevel)} ${sourceBadge(status.aiRisk)}</span></div>
      <div class="control-metrics">
        ${metric("Rainfall", rainfall, status.rainfall)}
        ${metric("Weather", zone.weather?.temperatureC != null ? `${zone.weather.temperatureC}°C` : "Unavailable", status.weather)}
        ${metric("Soil moisture", zone.soilMoisture?.value != null ? `${zone.soilMoisture.value}%` : "Unavailable", status.soilMoisture)}
        ${metric("Terrain / slope", zone.slopeDegrees != null ? `${zone.slopeDegrees}°` : "Unavailable", status.slope)}
      </div>
      <div class="control-warning"><b>Early warning</b><span>${esc(warning)}</span></div>
      <div class="control-context">
        <div><b>${esc(zone.perimeter?.radiusKm || 5)} km</b><span>affected zone on map</span></div>
        <div><b>${esc(zone.perimeter?.estimatedPopulation ?? "—")}</b><span>estimated population ${sourceBadge("ESTIMATED")}</span></div>
      </div>
      <div class="control-note"><b>Vulnerable roads</b><span>${esc(zone.roadStatus?.value || "Unavailable")} ${sourceBadge(status.roadStatus || "UNAVAILABLE")}</span><small>${esc(zone.roadStatus?.note || "No live road-closure feed connected.")}</small></div>
      <div class="control-note"><b>Villages / infrastructure at risk</b><span>${sourceBadge("UNAVAILABLE")}</span><small>No authoritative asset inventory or geocoded village exposure layer is configured; the population figure above is an area-level estimate, not a list of affected assets.</small></div>
      ${nearbyHistoricalPlacesHtml(zone)}`;
}

// Real (not invented) named places/infrastructure this zone has some
// history with — built from the same curated, sourced dataset the
// "Nearby historical landslides" History page already uses
// (data/historicalLandslides.js, fetched into S.history), filtered to
// this zone by the same 150km "nearby" threshold that page already
// uses for consistency. This is a real record of what's been reported
// affected before, NOT a live village/infrastructure exposure layer —
// clearly labeled as such, and kept separate from the UNAVAILABLE note
// above rather than replacing it, since it answers a different
// question (what has been hit before vs what's exposed right now).
function nearbyHistoricalPlacesHtml(zone) {
    const matches = (S.history || [])
        .filter((h) => h.location && haversineKm(zone.lat, zone.lng, h.location.lat, h.location.lng) <= 150)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!matches.length) {
        return `<div class="control-note"><b>Historically-affected places nearby</b><span>${sourceBadge(S.history?.length ? "LIVE" : "UNAVAILABLE")}</span><small>No record in the curated historical dataset names a place within 150km of ${esc(zone.zoneName)} — this is an absence in a small, non-comprehensive sample, not confirmation the area is unaffected.</small></div>`;
    }

    const rows = matches
        .slice(0, 5)
        .map((h) => `<div class="queue-item"><div><b>${esc(h.locationName || h.state)}</b><small>${new Date(h.date).toLocaleDateString()} · ${esc(h.state)}${h.approxFatalities ? ` · ~${h.approxFatalities} fatalities` : ""}</small></div></div>`)
        .join("");

    return `<div class="control-note"><b>Historically-affected places nearby</b><span>${sourceBadge("LIVE")}</span><small>${matches.length} record${matches.length === 1 ? "" : "s"} within 150km, from the same sourced sample used on the History page — real named places/infrastructure that have been hit before, not a live exposure prediction.</small><div class="queue-list" style="margin-top:8px">${rows}</div></div>`;
}

function renderOfficialControlRoom() {
    if (!$("officialControlMap") || !S.zones.length) return;
    const focusedId = S.controlRoomZoneId || S.selectedZoneId || S.zones[0].zoneId;
    const focused = S.zones.find((z) => z.zoneId === focusedId) || S.zones[0];
    S.controlRoomZoneId = focused.zoneId;
    if ($("controlRoomZone")) $("controlRoomZone").value = focused.zoneId;
    $("controlRoomLegend").innerHTML = ["Low", "Moderate", "High", "Critical"].map((level) => `<span><i style="background:${priorityColor(level)}"></i>${level}</span>`).join("");
    controlRoomDetail(focused);
    if (!officialControlMap) {
        officialControlMap = L.map("officialControlMap", { zoomControl: true }).setView([focused.lat, focused.lng], 7);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(officialControlMap);
        $("controlRoomZone").onchange = (event) => { S.controlRoomZoneId = event.target.value; renderOfficialControlRoom(); };
    }
    officialControlLayers.forEach((layer) => officialControlMap.removeLayer(layer));
    officialControlLayers = [];
    const add = (layer) => { officialControlLayers.push(layer); return layer; };
    S.zones.forEach((z) => {
        const color = priorityColor(z.priorityLevel);
        add(L.circle([z.lat, z.lng], { radius: 5000, color, weight: z.zoneId === focused.zoneId ? 2.5 : 1, fillColor: color, fillOpacity: z.zoneId === focused.zoneId ? 0.20 : 0.09 }).addTo(officialControlMap));
        add(L.circleMarker([z.lat, z.lng], { radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(officialControlMap).bindPopup(`<b>${esc(z.zoneName)}</b><br>${esc(z.priorityLevel)} priority · ${esc(z.priorityScore)}/100<br>AI risk: ${esc(z.riskLevel)} ${sourceBadge(z.dataStatus?.aiRisk)}`).on("click", () => { S.controlRoomZoneId = z.zoneId; renderOfficialControlRoom(); }));
    });
    (S.history || []).forEach((event) => {
        const point = event.location;
        if (point?.lat == null || point?.lng == null) return;
        add(L.circleMarker([point.lat, point.lng], { radius: 4, color: "#573b8a", weight: 1, fillColor: "#fff", fillOpacity: 0.9 }).addTo(officialControlMap).bindPopup(`<b>Historical landslide</b><br>${esc(event.locationName || "Recorded event")}<br>${esc(event.date || "Date unavailable")}`));
    });
    (S.needsHelpList || []).forEach((person) => {
        const point = person.lastKnownLocation || person.location;
        if (point?.lat == null || point?.lng == null) return;
        add(L.circleMarker([point.lat, point.lng], { radius: 6, color: "#fff", weight: 2, fillColor: "#ed4d54", fillOpacity: 1 }).addTo(officialControlMap).bindPopup(`<b>Citizen needs help</b><br>Last known location · ${sourceBadge("LIVE")}`));
    });
    officialControlMap.setView([focused.lat, focused.lng], 8);
    setTimeout(() => officialControlMap.invalidateSize(), 60);
}

async function renderOfficialDashboard() {
    if (!$("officialDashStats")) return;

    // KPIs
    const critical = S.zones.filter((z) => z.priorityLevel === "Critical").length;
    const high = S.zones.filter((z) => z.priorityLevel === "High").length;
    const needHelpCount = (S.needsHelpList || []).length;
    const pending = S.incidents.filter((i) => i.status === "Pending").length;
    $("officialDashStats").innerHTML = [
        [String(critical), "critical zones", "Priority ≥ 75 — needs action now"],
        [String(high), "high-priority zones", "Priority 50–74"],
        [String(needHelpCount), "people need help", "Live, auto-refreshing every 20s"],
        [String(pending), "reports awaiting review", "In the field report queue"]
    ]
        .map((c) => `<div class="stat"><b>${c[0]}</b><span>${c[1]}</span><small>${c[2]}</small></div>`)
        .join("");

    // Top 3 zones
    $("dashTopZones").innerHTML = S.zones
        .slice(0, 3)
        .map(
            (z) =>
                `<div class="zone-mini-row"><b>${esc(z.zoneName)}</b><span class="pill ${z.priorityLevel}">${esc(z.priorityLevelLocalized || z.priorityLevel)} · ${z.priorityScore}</span></div>`
        )
        .join("");

    // Needs-help preview (reuse whatever was last fetched; if nothing yet, fetch now)
    if (!S.needsHelpList) await refreshNeedsHelp();
    renderNeedsHelpPreview(S.needsHelpList || []);
    renderOfficialControlRoom();

    // Tool tiles, with real config-based badges where relevant
    let agencyConfiguredCount = 0;
    try {
        const data = await api("/api/alerts/agencies");
        agencyConfiguredCount = data.data.filter((a) => a.configured).length;
    } catch {
        /* badge just won't show a count if this fails */
    }

    $("toolTiles").innerHTML = TOOL_TILES.map((t) => {
        let badge = '<span class="tool-badge ready">Ready</span>';
        if (t.title === "Multi-agency dispatch") {
            badge = agencyConfiguredCount
                ? `<span class="tool-badge ready">${agencyConfiguredCount}/4 configured</span>`
                : '<span class="tool-badge setup">Add numbers in .env</span>';
        }
        if (t.title === "Responder routing") badge = '<span class="tool-badge ready">Ready (needs internet)</span>';
        if (t.title === "SMS reply, no app needed") badge = '<span class="tool-badge ready">Demoable now</span>';
        const onclick = t.panel ? `go('${t.page}');scrollToPanel('${t.panel}')` : `go('${t.page}')`;
        return `<button class="tool-tile" onclick="${onclick}"><i class="ti ${t.icon}"></i><b>${esc(t.title)}</b><span>${esc(t.desc)}</span>${badge}</button>`;
    }).join("");

    // Recent activity
    renderAlertLogEntries("dashRecentAlerts", await fetchRecentAlerts(5));
}

function initSettings() {
    $("settingsApiBase").onchange = (e) => {
        localStorage.setItem("nerApiBase", e.target.value);
        toast("Backend changed — reloading…");
        setTimeout(() => location.reload(), 600);
    };
    $("settingsLanguage").onchange = async (e) => {
        S.locale = e.target.value;
        localStorage.setItem("nerLocale", S.locale);
        $("language").value = S.locale;
        await refreshZones();
        if (document.getElementById("officialDashboard")?.classList.contains("active")) renderOfficialDashboard();
        toast("Language updated");
    };
    $("language").onchange = async (e) => {
        S.locale = e.target.value;
        localStorage.setItem("nerLocale", S.locale);
        $("settingsLanguage").value = S.locale;
        await refreshZones();
        if (document.getElementById("officialDashboard")?.classList.contains("active")) renderOfficialDashboard();
        toast("Language updated");
    };
}

function initHistoryFilter() {
    $("historyState").onchange = (e) => refreshHistory(e.target.value);
}

function initMapGps() {
    $("gpsBtn").onclick = () =>
        getPosition((p) => {
            S.personalLocation = p;
            go("map");
            const put = () => {
                if (!S.maps.main) return setTimeout(put, 120);
                renderPersonalLocationOnMap();
                personalLocationMarker?.openPopup();
                S.maps.main.setView([p.lat, p.lng], 10);
            };
            setTimeout(put, 50);
        });
    $("locationSelect").onchange = (e) => select(e.target.value);
    $("perimeterToggle").onclick = (e) => {
        perimeterVisible = !perimeterVisible;
        e.target.textContent = perimeterVisible ? "Hide 5km perimeter" : "Show 5km perimeter";
        const z = S.zones.find((x) => x.zoneId === S.selectedZoneId) || S.zones[0];
        renderPerimeter(z);
    };
}

// ---- Your Area (GPS-personalized citizen dashboard card) ----
function initYourAreaCard() {
    if (!$("yourAreaGpsBtn")) return;
    const showGpsArea = () => {
        $("yourAreaContent").innerHTML = '<p class="muted small">Getting your location…</p>';
        getPosition((p) => {
            const zone = nearestZone(p.lat, p.lng);
            if (!zone) {
                $("yourAreaContent").innerHTML = '<p class="muted small">No zones loaded yet — try again in a moment.</p>';
                return;
            }
            renderCitizenRisk(zone, p, "automatic");
        }, () => {
            $("yourAreaContent").innerHTML = '<p class="muted small">GPS unavailable or denied — you can still browse the map manually.</p>';
        });
    };
    $("yourAreaGpsBtn").onclick = showGpsArea;
    $("citizenLocationSearchBtn").onclick = () => {
        const zone = S.zones.find((z) => z.zoneId === $("citizenLocationSearch").value);
        if (!zone) return toast("Select a supported NER location first.");
        renderCitizenRisk(zone, { lat: zone.lat, lng: zone.lng, estimated: true }, "manual");
    };
}

function citizenRiskLevel(z) {
    // The priority pipeline calls its middle band "Moderate"; citizens see
    // the equivalent requested "Medium" label without changing the score.
    return z.priorityLevel === "Moderate" ? "Medium" : (z.priorityLevel || "Unavailable");
}

function citizenSafetyAction(z) {
    const level = citizenRiskLevel(z);
    if (level === "Critical") return "Move away from slopes and unstable drainage paths now; follow official evacuation instructions.";
    if (level === "High") return "Avoid slopes and stream channels, keep essentials ready, and follow official alerts closely.";
    if (level === "Medium") return "Stay alert, avoid unnecessary travel near steep slopes, and check for updated warnings.";
    return "No immediate action is indicated. Stay informed and report any cracks, movement, or unusual water flow.";
}

// A transport/cache status is meaningful only when its corresponding
// value arrived. Older compatible backends can omit an optional field;
// present that truthfully as UNAVAILABLE instead of a misleading CACHED
// or LIVE badge beside an empty value.
function availableStatus(status, hasValue) {
    return hasValue ? status : "UNAVAILABLE";
}

function renderCitizenRisk(zone, point, mode) {
    const ds = zone.dataStatus || {};
    const cw = zone.cumulativeRainfallMm || {};
    const weather = zone.weather || {};
    const distance = point && mode === "automatic" ? haversineKm(point.lat, point.lng, zone.lat, zone.lng).toFixed(1) : null;
    const historicalCount = (S.history || []).filter((h) => h.location && haversineKm(zone.lat, zone.lng, h.location.lat, h.location.lng) <= 150).length;
    const risk = citizenRiskLevel(zone);
    const color = priorityColor(zone.priorityLevel);
    S.personalLocation = point;
    S.safeRouteStart = { ...point, nearZone: zone.zoneName };
    // Keep the GIS context aligned with this person: their marker, the
    // matched monitored risk zone, and that zone's historical hazards.
    S.selectedZoneId = zone.zoneId;
    if ($("citizenLocationSearch")) $("citizenLocationSearch").value = zone.zoneId;
    if ($("citizenLocationLine")) $("citizenLocationLine").textContent = `📍 Your Area: ${zone.zoneName} (${mode === "automatic" ? "browser location" : "manual selection"})`;
    renderPersonalLocationOnMap();
    renderHistoricalHazards(zone);
    renderCitizenWarning(zone);
    $("yourAreaContent").innerHTML = `
      <div class="your-area-result">
        <div class="your-area-badge" style="background:${color}22;border:1px solid ${color}55"><b style="color:${color}">⚠ ${esc(risk)}</b><span style="color:${color}">LANDSLIDE RISK</span></div>
        <div class="your-area-meta">
          <h3>📍 Your Area: ${esc(zone.zoneName)}</h3>
          <p>${mode === "automatic" ? `Browser-permitted location${distance != null ? ` · nearest supported zone is ${distance} km away` : ""}` : "Manually selected supported area"}. ${statusBadge(ds.aiRisk)} AI risk: ${esc(zone.riskLevelLocalized || zone.riskLevel || "Unavailable")}.</p>
        </div>
      </div>
      <div class="factor-list citizen-factor-list">
        <div><span>🌧️ Rainfall (24h)<b>${cw["24h"] != null ? `${cw["24h"]} mm` : "Unavailable"} ${statusBadge(availableStatus(ds.rainfall, cw["24h"] != null))}</b></span></div>
        <div><span>☁️ Weather now<b>${weather.temperatureC != null ? `${weather.temperatureC}°C · ${weather.humidityPercent ?? "—"}% humidity` : "Unavailable"} ${statusBadge(availableStatus(ds.weather, weather.temperatureC != null))}</b></span></div>
        <div><span>💧 Soil moisture<b>${zone.soilMoisture?.value != null ? `${zone.soilMoisture.value}%` : "Unavailable"} ${statusBadge(availableStatus(ds.soilMoisture, zone.soilMoisture?.value != null))}</b></span></div>
        <div><span>⛰️ Terrain<b>${zone.slopeDegrees != null ? `${zone.slopeDegrees}° slope · ${zone.elevation ?? "—"} m elevation` : "Unavailable"} ${statusBadge(availableStatus(ds.slope, zone.slopeDegrees != null))}</b></span></div>
        <div><span>⚠️ Landslide possibility<b>${esc(zone.earlyWarning?.statusLabel || "UNAVAILABLE")}</b></span></div>
        <div><span>Nearby historical landslides<b>${historicalCount ? `${historicalCount} within 150 km` : "No plotted records within 150 km"} ${statusBadge(S.history?.length ? "LIVE" : "UNAVAILABLE")}</b></span></div>
      </div>
      <div class="guidance"><b>Main risk factors</b><p>${esc(zone.riskExplanation || "Risk explanation unavailable while source data is unavailable.")}</p></div>
      <div class="guidance" style="margin-top:10px;border-left:4px solid ${color}"><b>👉 What You Should Do</b><p>${esc(citizenSafetyAction(zone))}</p></div>
      <div class="your-area-actions"><button class="btn ghost" onclick="go('map');selectSoon('${zone.zoneId}')">🗺️ Show everything on GIS</button><button class="btn ghost" onclick="go('map');setTimeout(()=>document.querySelector('.action-plan.citizen-only')?.scrollIntoView({behavior:'smooth'}),100)">🧭 Find safe route</button></div>`;
}

function renderCitizenWarning(zone) {
    const banner = $("citizenWarningBanner");
    if (!banner || S.user?.role !== "Citizen") return;
    const level = citizenRiskLevel(zone);
    const warning = zone.earlyWarning || {};
    const color = priorityColor(zone.priorityLevel);
    const message = warning.reasons?.[0]
        || (level === "Low" ? "No immediate warning signal is active for your matched supported area." : "Conditions require extra caution in your matched supported area.");
    // A distinct icon per level (not just color) — so the alert is
    // still unmistakable for anyone who can't rely on color alone.
    const icon = { Critical: "🚨", High: "⚠️", Medium: "⚠️", Low: "✅" }[level] || "⚠️";
    banner.className = `citizen-warning ${level.toLowerCase()}`;
    banner.innerHTML = `<div><p class="eyebrow">${["Critical", "High"].includes(level) ? "URGENT — " : ""}PERSONAL SAFETY WARNING</p><h2>${icon} ${esc(zone.zoneName)}: ${esc(level).toUpperCase()} LANDSLIDE RISK</h2><p>${esc(message)}</p></div><div class="citizen-warning-action"><b>${esc(citizenSafetyAction(zone))}</b><button class="btn ghost" onclick="go('map');selectSoon('${zone.zoneId}')">View on GIS</button></div>`;
    banner.style.setProperty("--warning-color", color);
}

// ---- Safe Route (citizen-facing: GPS → nearest zone that ISN'T high-risk) ----
function initSafeRoutePanel() {
    if (!$("getSafeRouteBtn")) return;
    let routeMapInstance = null;
    let routeLayers = [];

    $("safeRouteGpsBtn").onclick = () =>
        getPosition(
            (p) => {
                S.safeRouteStart = p;
                $("safeRouteStartLabel").textContent = `Start: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}${p.estimated ? " (estimated)" : ""}`;
            },
            () => toast("Couldn't get your location — check browser GPS permission.")
        );

    // Quick-access from the map toolbar (top of the page) straight to
    // this GPS-based safe-route panel (bottom of the page) — the
    // feature already existed, this just makes it one click from
    // wherever you're looking at the map instead of requiring a scroll
    // to notice it. Also fires the GPS lookup immediately so a citizen
    // in a hurry doesn't need a second tap.
    $("jumpToSafeRouteBtn")?.addEventListener("click", () => {
        $("safeRouteGpsBtn").click();
        document.querySelector(".action-plan.citizen-only")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    $("getSafeRouteBtn").onclick = async () => {
        if (!S.safeRouteStart) return toast("Set your location first (Use my location)");
        if (!S.zones.length) return toast("Zone data still loading — try again in a moment");

        // Safety target: the nearest zone that is NOT Critical/High —
        // i.e. actually route AWAY from danger, not just to the closest point.
        const safeZones = S.zones.filter((z) => !["Critical", "High"].includes(z.priorityLevel));
        const candidates = safeZones.length ? safeZones : S.zones; // if everything is high-risk, at least route to the least-bad one
        const target = candidates.reduce(
            (best, z) => (haversineKm(S.safeRouteStart.lat, S.safeRouteStart.lng, z.lat, z.lng) < haversineKm(S.safeRouteStart.lat, S.safeRouteStart.lng, best.lat, best.lng) ? z : best),
            candidates[0]
        );

        try {
            const data = await api(`/api/route?fromLat=${S.safeRouteStart.lat}&fromLng=${S.safeRouteStart.lng}&toZoneId=${target.zoneId}`);

            if (!routeMapInstance) routeMapInstance = L.map("safeRouteMap");
            else routeLayers.forEach((l) => routeMapInstance.removeLayer(l));
            routeLayers = [];
            if (!routeMapInstance._hasTileLayer) {
                L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(routeMapInstance);
                routeMapInstance._hasTileLayer = true;
            }
            data.routes.forEach((r) => {
                const latlngs = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
                const isRecommended = r.index === data.recommendedIndex;
                routeLayers.push(L.polyline(latlngs, routeLineStyle(isRecommended, data.simulated)).addTo(routeMapInstance));
            });
            routeMapInstance.fitBounds(L.latLngBounds(routeLayers.flatMap((l) => l.getLatLngs())), { padding: [20, 20] });
            setTimeout(() => routeMapInstance.invalidateSize(), 100);

            $("safeRouteResult").innerHTML =
                `<p class="muted small">Safest reachable zone: <b>${esc(target.zoneName)}</b> (${esc(target.priorityLevelLocalized || target.priorityLevel)}) — ${esc(data.source)}${data.simulated ? " (simulated — live routing unavailable right now)" : ""}</p>` +
                data.routes
                    .map((r) => `<div class="route-alt ${r.index === data.recommendedIndex ? "recommended" : ""}"><b>${r.index === data.recommendedIndex ? "✓ Recommended" : "Alternative"} — ${r.distanceKm}km, ~${r.durationMin} min</b>${esc(r.riskAdvisory)}</div>`)
                    .join("");
        } catch (e) {
            $("safeRouteResult").innerHTML = `<div class="notice small">Couldn't compute a route: ${esc(e.message)}. This needs real internet access.</div>`;
        }
    };
}

// ---- History: sort by distance from citizen's GPS ----
function initHistoryNearMe() {
    if (!$("historyNearMeBtn")) return;
    $("historyNearMeBtn").onclick = () =>
        getPosition(
            (p) => {
                S.historyOrigin = p;
                renderHistory();
                toast("Sorted by distance from you");
            },
            () => toast("Couldn't get your location — check browser GPS permission.")
        );
}

// ---- alert audio (Web Audio API — a real two-tone siren, not a beep) ----
const AudioAlert = (() => {
    let ctx = null;
    let muted = localStorage.getItem("nerMuted") === "1";

    const getCtx = () => {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        return ctx;
    };

    // Two alternating tones, like an emergency vehicle siren — for a
    // genuinely new Critical zone, not a generic notification beep.
    const siren = () => {
        if (muted) return;
        try {
            const c = getCtx();
            const now = c.currentTime;
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.type = "sine";
            osc.connect(gain);
            gain.connect(c.destination);
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
            for (let i = 0; i < 4; i++) {
                const t = now + i * 0.4;
                osc.frequency.setValueAtTime(880, t);
                osc.frequency.linearRampToValueAtTime(660, t + 0.2);
                osc.frequency.linearRampToValueAtTime(880, t + 0.4);
            }
            gain.gain.setValueAtTime(0.18, now + 1.5);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.7);
            osc.start(now);
            osc.stop(now + 1.8);
        } catch {
            /* AudioContext blocked until a user gesture — fine, just silent */
        }
    };

    // A short, gentle double-chime for a new help request — distinct
    // from the siren so officials can tell the two apart by ear.
    const chime = () => {
        if (muted) return;
        try {
            const c = getCtx();
            const now = c.currentTime;
            [660, 880].forEach((freq, i) => {
                const osc = c.createOscillator();
                const gain = c.createGain();
                osc.type = "triangle";
                osc.frequency.value = freq;
                osc.connect(gain);
                gain.connect(c.destination);
                const t = now + i * 0.18;
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
                osc.start(t);
                osc.stop(t + 0.24);
            });
        } catch {
            /* ignore */
        }
    };

    const toggleMute = () => {
        muted = !muted;
        localStorage.setItem("nerMuted", muted ? "1" : "0");
        if ($("soundToggle")) $("soundToggle").textContent = muted ? "🔇" : "🔊";
        return muted;
    };

    const isMuted = () => muted;

    return { siren, chime, toggleMute, isMuted };
})();

// ---- pin-drop map (fallback when GPS is denied/unavailable) ----
function initPinMap(containerId, onPick) {
    const center = S.zones[0] ? [S.zones[0].lat, S.zones[0].lng] : [25.7, 92.5];
    const map = L.map(containerId).setView(center, 7);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19 }).addTo(map);
    let marker = null;
    map.on("click", (e) => {
        if (marker) map.removeLayer(marker);
        marker = L.marker(e.latlng).addTo(map);
        onPick({ lat: e.latlng.lat, lng: e.latlng.lng, estimated: true, manual: true });
    });
    return map;
}

// ---- boot ----
async function init() {
    document.querySelectorAll(".nav").forEach((b) => (b.onclick = () => go(b.dataset.page)));
    populateSelectors();
    initAuth();
    initReportForm();
    initSafetyPage();
    initOfficialAlertPanel();
    initHeadcountPanel();
    initDispatchPanel();
    initRoutingPanel();
    initSmsSimulatePanel();
    initCandidatePanel();
    initTrendPanel();
    initSettings();
    initHistoryFilter();
    initHistoryNearMe();
    initMapGps();
    initYourAreaCard();
    initSafeRoutePanel();

    $("soundToggle").textContent = AudioAlert.isMuted() ? "🔇" : "🔊";
    $("soundToggle").onclick = () => {
        const muted = AudioAlert.toggleMute();
        toast(muted ? "Alert sound muted" : "Alert sound on");
        if (!muted) AudioAlert.chime(); // audible confirmation, also unlocks AudioContext on this gesture
    };

    if (S.token && S.user) {
        await enterApp();
    }

    // A queued status/report is retried only after the browser tells us it
    // has regained connectivity, and again on startup for a pending queue.
    window.addEventListener("online", flushOfflineQueue);
    window.addEventListener("offline", () => toast("Offline / low-network mode — new safety updates and text-only reports will be marked CACHED."));
    flushOfflineQueue();
}

document.addEventListener("DOMContentLoaded", () => init().catch((e) => toast("Startup error: " + e.message)));

// Offline app-shell support — see sw.js for exactly what is and isn't
// cached (never live API data). Registration failing (e.g. served
// over plain http on a non-localhost host) is non-fatal — the app
// just runs without offline support in that case.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((error) => console.log("Service worker registration failed:", error));
    });
}
