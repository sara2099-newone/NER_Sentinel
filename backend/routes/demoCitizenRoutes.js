const express = require("express");
const { getZoneById } = require("../config/zones");
const { generateDemoCitizens } = require("../services/demoCitizenService");
const SafetyStatus = require("../models/SafetyStatus");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { withCache } = require("../services/cacheService");
const getWeatherData = require("../services/weatherService");
const getRainfallData = require("../services/rainfallService");
const { computeCumulativeWindows } = require("../services/rainfallService");
const getSlopeData = require("../services/slopeService");
const aiService = require("../services/aiService");
const { evaluateThresholds } = require("../services/thresholdService");
const { estimateAffectedPopulation } = require("../services/populationService");
const { computePriority } = require("../services/prioritizationService");

const router = express.Router();

// Best-effort real priority level for this zone, reusing the same
// pipeline as /api/dashboard/summary, so the DEMO citizen split is
// weighted by real current risk — not a second, disconnected number.
// Falls back to "Low" weighting (never fabricates a risk level) if any
// upstream call fails.
const getCurrentPriorityLevel = async (zone) => {
    try {
        const [weatherCached, rainfallCached, slope] = await Promise.all([
            withCache("weather", zone.lat, zone.lng, 5 * 60 * 1000, () => getWeatherData(zone.lat, zone.lng)),
            withCache("rainfall", zone.lat, zone.lng, 5 * 60 * 1000, () => getRainfallData(zone.lat, zone.lng)),
            withCache("slope", zone.lat, zone.lng, 24 * 60 * 60 * 1000, () => getSlopeData(zone.lat, zone.lng))
        ]);
        const weather = weatherCached.data;
        const rainfall = rainfallCached.data;
        const cumulativeRainfall = rainfall ? computeCumulativeWindows(rainfall.hourly, rainfall.utcOffsetSeconds) : {};
        const thresholdResult = evaluateThresholds({
            cumulativeRainfall,
            slopeDegrees: slope.data?.slopeDegrees ?? null,
            soilMoisturePercent: null
        });

        let riskScore = 0;
        if (slope.data && weather) {
            const { status, data } = await aiService.getPrediction({
                latitude: zone.lat,
                longitude: zone.lng,
                elevation_m: slope.data.elevation,
                slope_degrees: slope.data.slopeDegrees,
                temperature_c: weather.current?.temperature_2m,
                humidity_percent: weather.current?.relative_humidity_2m,
                rainfall_24h_mm: cumulativeRainfall?.["24h"]
            });
            if (status === 200 && data) riskScore = typeof data.risk_score === "number" ? data.risk_score : 0;
        }

        const population = estimateAffectedPopulation(zone.lat, zone.lng, 5);
        const priority = computePriority({ riskScore, isCritical: thresholdResult.isCritical, estimatedPopulation: population.estimatedPopulation });
        return priority.priorityLevel || "Low";
    } catch {
        return "Low";
    }
};

// GET /api/demo/citizens?zoneId=shillong — 5km Citizen Zone, DEMO/SIMULATED
// roster (see services/demoCitizenService.js). Public, same as the demo
// server's version: citizens viewing the map need this, not just Officials.
router.get("/citizens", async (req, res) => {
    const zone = getZoneById(req.query.zoneId);
    if (!zone) return res.status(400).json({ message: "zoneId not recognised" });

    const priorityLevel = await getCurrentPriorityLevel(zone);
    const result = generateDemoCitizens({
        zoneId: zone.id,
        zoneName: zone.name,
        lat: zone.lat,
        lng: zone.lng,
        priorityLevel,
        radiusKm: 5
    });
    res.status(200).json(result);
});

// POST /api/demo/help-requests (Official-only) — DEMO/SIMULATED "Generate
// Help Requests" control. This existed in demoServer.js (in-memory store)
// but was missing here, so an Official running the full Mongo-backed
// server got a 404 clicking the same button the demo server supports.
// Writes into the SAME SafetyStatus collection the real "who needs help"
// features read from, tagged source:"demo"/demo:true so it's never
// confused with a genuine report — mirrors demoServer.js's version.
router.post("/help-requests", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const zone = getZoneById(req.body.zoneId);
        if (!zone) return res.status(400).json({ message: "zoneId not recognised" });
        const count = Math.min(Math.max(Number(req.body.count) || 5, 1), 20);

        const created = [];
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const distanceKm = 5 * Math.sqrt(Math.random());
            const dLat = (distanceKm / 111.32) * Math.cos(angle);
            const dLng = (distanceKm / (111.32 * Math.cos((zone.lat * Math.PI) / 180))) * Math.sin(angle);
            const record = await SafetyStatus.create({
                displayName: `Demo Citizen ${i + 1}`,
                source: "demo",
                demo: true,
                status: "NeedHelp",
                note: "Simulated help request (DEMO/SIMULATED) generated by an Official for workflow testing.",
                lastKnownLocation: {
                    lat: Number((zone.lat + dLat).toFixed(5)),
                    lng: Number((zone.lng + dLng).toFixed(5)),
                    capturedAt: new Date()
                }
            });
            created.push(record);
        }
        res.status(201).json({ message: `${count} simulated help requests generated (DEMO/SIMULATED) near ${zone.name}`, data: created });
    } catch (error) {
        res.status(500).json({ message: "Failed to generate demo help requests", error: error.message });
    }
});

module.exports = router;
