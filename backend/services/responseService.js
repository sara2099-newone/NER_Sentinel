// ============================================================
// RESPONSE workflow service
// ============================================================
// Covers: department alerts, a demo response-team roster, real OSRM
// road routing (shortest vs. low-risk) when a team is dispatched to
// an incident, and team status progression.
//
// HONESTY NOTES (read before changing the routing logic):
// - "DEMO DISPATCH": department alerts here NEVER send a real SMS,
//   WhatsApp message, or email. There is no telecom/WhatsApp Business
//   integration in this project. Every alert this module creates is
//   tagged demo:true and dispatchMethod:"DEMO DISPATCH" — if you're
//   tempted to wire this to alertService/Twilio, don't; that's a
//   product decision, see config/departments.js.
// - Response team locations are SIMULATED starting points (deterministic
//   per zone+department, not GPS-tracked real vehicles). Clearly
//   labeled demo:true on every team object.
// - Routing itself IS real: dispatchTeam() calls routingService.getRoute(),
//   which hits OSRM's public routing server over the real OpenStreetMap
//   road network — not a straight line. "Low-risk" is a real, computed
//   comparison between OSRM's actual alternative routes (which one
//   passes closer to the landslide site / other active-incident zones),
//   not a random pick. If OSRM has no alternative route to compare, or
//   is unreachable, we say so explicitly instead of inventing a second
//   route — see buildRoutePlan().
//
// In-memory only, like the rest of the demo backend — state resets on
// process restart.

const { getZones, getZoneById } = require("../config/zones");
const { DEPARTMENTS } = require("../config/departments");
const { getRoute } = require("./routingService");
const { calculateDistance } = require("./geoService");

// ---- tiny deterministic PRNG (mulberry32), same approach as demoCitizenService.js ----
const hashStringToSeed = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return h >>> 0;
};
const mulberry32 = (seed) => {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
const randomPointNear = (rand, lat, lng, maxKm) => {
    const angle = rand() * 2 * Math.PI;
    const distanceKm = maxKm * (0.25 + 0.75 * rand()); // keep bases a plausible few km out, not right on top of the zone
    const dLat = (distanceKm / 111.32) * Math.cos(angle);
    const dLng = (distanceKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
    return { lat: Number((lat + dLat).toFixed(5)), lng: Number((lng + dLng).toFixed(5)) };
};

// ---- constants ----
const DEPT_ALERT_STATUSES = ["SENT", "ACKNOWLEDGED", "RESPONDING", "RESOLVED"];
const TEAM_STATUSES = ["READY", "DISPATCHED", "EN_ROUTE", "ARRIVED", "RESOLVED"];
const TEAM_STATUS_LABEL = { READY: "Ready", DISPATCHED: "Dispatched", EN_ROUTE: "En Route", ARRIVED: "Arrived", RESOLVED: "Resolved" };

// ---- in-memory state ----
let incidentAutoId = 1;
let alertAutoId = 1;
const incidents = []; // emergency RESPONSE incidents (landslide events) — separate from citizen hazard reports in demoServer's `incidents` array
const simulatedCriticalZones = new Map(); // zoneId -> { at, zoneName }
const teams = [];

// ---- seed the demo team roster once, deterministic per zone+department ----
const seedTeams = () => {
    getZones().forEach((zone) => {
        const rand = mulberry32(hashStringToSeed(`response-teams:${zone.id}`));
        DEPARTMENTS.forEach((dept) => {
            const location = randomPointNear(rand, zone.lat, zone.lng, 7);
            teams.push({
                id: `TEAM-${zone.id}-${dept.id}`,
                name: `${dept.label} Unit — ${zone.name.split(",")[0]}`,
                department: dept.id,
                departmentLabel: dept.label,
                zoneId: zone.id,
                zoneName: zone.name,
                location,
                status: "READY",
                statusLabel: TEAM_STATUS_LABEL.READY,
                eta: null,
                etaMinutes: null,
                assignedIncidentId: null,
                route: null,
                updatedAt: new Date(),
                demo: true
            });
        });
    });
};
seedTeams();

const listTeams = (zoneId) => (zoneId ? teams.filter((t) => t.zoneId === zoneId) : teams);
const getTeam = (teamId) => teams.find((t) => t.id === teamId) || null;

const createDepartmentAlerts = () =>
    DEPARTMENTS.map((d) => ({
        id: `ALT-${alertAutoId++}`,
        department: d.id,
        departmentLabel: d.label,
        status: "SENT",
        dispatchMethod: "DEMO DISPATCH",
        demo: true,
        sentAt: new Date(),
        updatedAt: new Date(),
        history: [{ status: "SENT", at: new Date() }]
    }));

const getIncident = (id) => incidents.find((i) => i.id === id) || null;
const listIncidents = () => incidents;

// ---- 1. simulate a zone crossing into critical risk (does not by itself alert anyone — see triggerLandslide) ----
const triggerCriticalRisk = (zoneId) => {
    const zone = getZoneById(zoneId);
    if (!zone) throw new Error("zoneId not recognised");
    const record = { zoneId: zone.id, zoneName: zone.name, at: new Date() };
    simulatedCriticalZones.set(zoneId, record);
    return { ...record, demo: true, note: "Simulated for testing — does not change the real Risk Map. Trigger a landslide next to create an incident and dispatch department alerts." };
};

const listSimulatedCriticalZones = () => [...simulatedCriticalZones.values()];

// ---- 1/2. a landslide becomes critical -> create the incident + fire department alerts (DEMO DISPATCH) ----
const triggerLandslide = (zoneId) => {
    const zone = getZoneById(zoneId);
    if (!zone) throw new Error("zoneId not recognised");

    const incident = {
        id: `INC-${incidentAutoId++}`,
        type: "Landslide",
        zoneId: zone.id,
        zoneName: zone.name,
        location: { lat: zone.lat, lng: zone.lng },
        severity: "Critical",
        status: "Active", // Active | Resolved
        createdAt: new Date(),
        resolvedAt: null,
        demo: true,
        departmentAlerts: createDepartmentAlerts(),
        assignedTeamIds: []
    };
    incidents.push(incident);
    simulatedCriticalZones.delete(zoneId); // the "critical risk" phase is now superseded by an actual incident
    return incident;
};

// ---- department alert status: SENT -> ACKNOWLEDGED -> RESPONDING -> RESOLVED (manual, Official-driven) ----
const updateAlertStatus = (incidentId, alertId, status) => {
    if (!DEPT_ALERT_STATUSES.includes(status) || status === "SENT") {
        throw new Error(`status must be one of ${DEPT_ALERT_STATUSES.filter((s) => s !== "SENT").join(", ")}`);
    }
    const incident = getIncident(incidentId);
    if (!incident) throw new Error("incident not found");
    const alert = incident.departmentAlerts.find((a) => a.id === alertId);
    if (!alert) throw new Error("department alert not found on this incident");

    alert.status = status;
    alert.updatedAt = new Date();
    alert.history.push({ status, at: new Date() });
    return alert;
};

// ---- routing: real OSRM shortest vs. heuristic low-risk route, team -> incident ----
const categorizeRisk = (closestHazardKm) => {
    if (closestHazardKm === null || closestHazardKm === undefined) return "Unknown";
    if (closestHazardKm < 1) return "High";
    if (closestHazardKm < 3) return "Moderate";
    return "Low";
};

// Other zones with an Active incident right now — real hazard points to
// route away from, in addition to the destination landslide itself.
const otherActiveHazardZones = (excludeZoneId) => {
    const activeZoneIds = new Set(incidents.filter((i) => i.status === "Active" && i.zoneId !== excludeZoneId).map((i) => i.zoneId));
    return getZones()
        .filter((z) => activeZoneIds.has(z.id))
        .map((z) => ({ zoneName: `${z.name} (active incident)`, lat: z.lat, lng: z.lng }));
};

const decorateRoute = (r) =>
    r && {
        distanceKm: r.distanceKm,
        durationMin: r.durationMin,
        etaMinutesFromNow: r.durationMin,
        etaAt: new Date(Date.now() + r.durationMin * 60000).toISOString(),
        risk: categorizeRisk(r.closestHazardKm ?? null),
        riskAdvisory: r.riskAdvisory,
        geometry: r.geometry
    };

/**
 * Real road routing from (fromLat,fromLng) to the incident's landslide
 * location. Returns { shortest, lowRisk, lowRiskNote, sameRoute, source, simulated }.
 * lowRisk is null (with lowRiskNote explaining why) whenever we don't
 * actually have a second route to compare — never fabricated.
 */
const buildRoutePlan = async (fromLat, fromLng, incident) => {
    const hazardZones = [{ zoneName: `${incident.zoneName} — landslide site`, lat: incident.location.lat, lng: incident.location.lng }, ...otherActiveHazardZones(incident.zoneId)];

    try {
        const result = await getRoute(fromLat, fromLng, incident.location.lat, incident.location.lng, hazardZones);
        const routes = result.routes;
        const shortest = [...routes].sort((a, b) => a.distanceKm - b.distanceKm)[0];
        const recommended = routes.find((r) => r.index === result.recommendedIndex) || routes[0];

        // Only present a distinct "low-risk route" if OSRM actually gave
        // us more than one alternative AND it differs from the shortest —
        // otherwise there is nothing honest to show as a second option.
        const hasRealAlternative = routes.length > 1 && recommended.index !== shortest.index;

        return {
            shortest: decorateRoute(shortest),
            lowRisk: hasRealAlternative ? decorateRoute(recommended) : null,
            lowRiskNote: hasRealAlternative ? null : "Live road condition data unavailable.",
            sameRoute: !hasRealAlternative,
            source: result.source,
            simulated: false
        };
    } catch (error) {
        // OSRM unreachable — same honest straight-line fallback the
        // existing /api/route endpoint uses, clearly marked simulated.
        const straightKm = calculateDistance(fromLat, fromLng, incident.location.lat, incident.location.lng);
        const durationMin = Math.round((straightKm / 40) * 60);
        const fallback = {
            distanceKm: straightKm,
            durationMin,
            etaMinutesFromNow: durationMin,
            etaAt: new Date(Date.now() + durationMin * 60000).toISOString(),
            risk: "Unknown",
            riskAdvisory: "Simulated straight-line estimate — live road routing unavailable right now.",
            geometry: { type: "LineString", coordinates: [[fromLng, fromLat], [incident.location.lng, incident.location.lat]] }
        };
        return {
            shortest: fallback,
            lowRisk: null,
            lowRiskNote: "Live road condition data unavailable.",
            sameRoute: true,
            source: `Simulated (straight-line distance) — OSRM's public routing server could not be reached (${error.message})`,
            simulated: true
        };
    }
};

// ---- 2/3. dispatch a team to an incident: assigns + computes the real route ----
const dispatchTeam = async (teamId, incidentId) => {
    const team = getTeam(teamId);
    if (!team) throw new Error("team not found");
    const incident = getIncident(incidentId);
    if (!incident) throw new Error("incident not found");
    if (incident.status !== "Active") throw new Error("this incident is already resolved");

    const plan = await buildRoutePlan(team.location.lat, team.location.lng, incident);
    const chosen = plan.lowRisk || plan.shortest;

    team.status = "DISPATCHED";
    team.statusLabel = TEAM_STATUS_LABEL.DISPATCHED;
    team.assignedIncidentId = incident.id;
    team.route = plan;
    team.etaMinutes = chosen?.durationMin ?? null;
    team.eta = chosen ? `${chosen.durationMin} min` : null;
    team.updatedAt = new Date();

    if (!incident.assignedTeamIds.includes(team.id)) incident.assignedTeamIds.push(team.id);

    // Dispatching a team is treated as that department acknowledging its alert.
    const alert = incident.departmentAlerts.find((a) => a.department === team.department);
    if (alert && alert.status === "SENT") {
        alert.status = "ACKNOWLEDGED";
        alert.updatedAt = new Date();
        alert.history.push({ status: "ACKNOWLEDGED", at: new Date(), note: `${team.name} dispatched` });
    }

    return team;
};

// ---- 5. DISPATCHED -> EN ROUTE -> ARRIVED -> RESOLVED ----
const TEAM_ORDER = ["DISPATCHED", "EN_ROUTE", "ARRIVED", "RESOLVED"];
const updateTeamStatus = (teamId, status) => {
    const normalized = String(status || "").toUpperCase().replace(/\s+/g, "_");
    if (!TEAM_ORDER.includes(normalized)) throw new Error(`status must be one of ${TEAM_ORDER.join(", ")}`);
    const team = getTeam(teamId);
    if (!team) throw new Error("team not found");
    if (!team.assignedIncidentId) throw new Error("team has not been dispatched to an incident yet");

    team.status = normalized;
    team.statusLabel = TEAM_STATUS_LABEL[normalized];
    team.updatedAt = new Date();

    const incident = getIncident(team.assignedIncidentId);
    const alert = incident?.departmentAlerts.find((a) => a.department === team.department);
    if (alert) {
        if (normalized === "EN_ROUTE" && ["SENT", "ACKNOWLEDGED"].includes(alert.status)) {
            alert.status = "RESPONDING";
            alert.updatedAt = new Date();
            alert.history.push({ status: "RESPONDING", at: new Date(), note: `${team.name} en route` });
        }
        if (normalized === "RESOLVED" && alert.status !== "RESOLVED") {
            alert.status = "RESOLVED";
            alert.updatedAt = new Date();
            alert.history.push({ status: "RESOLVED", at: new Date(), note: `${team.name} resolved` });
        }
    }

    if (normalized === "RESOLVED") {
        // Team returns to base, free for reassignment in the demo.
        team.assignedIncidentId = null;
        team.route = null;
        team.eta = null;
        team.etaMinutes = null;
        team.status = "READY";
        team.statusLabel = TEAM_STATUS_LABEL.READY;
    }

    return team;
};

// ---- "Complete Incident" demo control: force-resolve everything tied to it ----
const completeIncident = (incidentId) => {
    const incident = getIncident(incidentId);
    if (!incident) throw new Error("incident not found");
    if (incident.status === "Resolved") return incident;

    incident.status = "Resolved";
    incident.resolvedAt = new Date();
    incident.departmentAlerts.forEach((a) => {
        if (a.status !== "RESOLVED") {
            a.status = "RESOLVED";
            a.updatedAt = new Date();
            a.history.push({ status: "RESOLVED", at: new Date(), note: "incident marked complete" });
        }
    });
    incident.assignedTeamIds.forEach((teamId) => {
        const team = getTeam(teamId);
        if (team) {
            team.status = "READY";
            team.statusLabel = TEAM_STATUS_LABEL.READY;
            team.assignedIncidentId = null;
            team.route = null;
            team.eta = null;
            team.etaMinutes = null;
            team.updatedAt = new Date();
        }
    });
    return incident;
};

module.exports = {
    DEPT_ALERT_STATUSES,
    TEAM_STATUSES,
    listTeams,
    getTeam,
    listIncidents,
    getIncident,
    triggerCriticalRisk,
    listSimulatedCriticalZones,
    triggerLandslide,
    updateAlertStatus,
    dispatchTeam,
    updateTeamStatus,
    completeIncident
};
