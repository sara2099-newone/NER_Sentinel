// Candidate incident detection — combines three independent real
// signals (AI risk model, rule-based thresholds, nearby pending
// citizen reports) plus satellite rainfall context into one "does
// this look like it might be happening" signal for officials.
//
// This is deliberately NOT auto-confirmation. A candidate here means
// "an official should look at this", not "a landslide occurred" — the
// disclaimer travels with every response, and nothing in this system
// auto-creates or auto-verifies an Incident from it.

const getWeatherData = require("../services/weatherService");
const getRainfallData = require("../services/rainfallService");
const { computeCumulativeWindows } = require("../services/rainfallService");
const getSlopeData = require("../services/slopeService");
const { getSatelliteRainfall } = require("../services/satelliteRainfallService");
const aiService = require("../services/aiService");
const { evaluateThresholds } = require("../services/thresholdService");
const { buildSoilMoisture } = require("../services/riskIntelligenceService");

const NEARBY_DEGREES = 0.05; // ~5km bounding box

// countNearbyPending is injected so the zero-dependency demo server
// (no Mongo, no npm install) can supply its own in-memory equivalent
// instead of a Mongoose query — the rest of the detection logic is
// identical either way. The Mongoose Incident model is required lazily,
// only if the caller doesn't inject their own counter, so simply
// requiring this file never forces mongoose to load (which demoServer.js
// deliberately never installs).
const defaultCountNearbyPending = async (lat, lng) => {
    const Incident = require("../models/Incident");
    return (
        await Incident.find({
            status: "Pending",
            "location.lat": { $gte: lat - NEARBY_DEGREES, $lte: lat + NEARBY_DEGREES },
            "location.lng": { $gte: lng - NEARBY_DEGREES, $lte: lng + NEARBY_DEGREES }
        }).limit(20)
    ).length;
};

const detectCandidate = async (lat, lng, countNearbyPending = defaultCountNearbyPending) => {
    const [weather, rainfall, slope, satellite, nearbyCount] = await Promise.allSettled([
        getWeatherData(lat, lng),
        getRainfallData(lat, lng),
        getSlopeData(lat, lng),
        getSatelliteRainfall(lat, lng),
        countNearbyPending(lat, lng)
    ]);

    const weatherData = weather.status === "fulfilled" ? weather.value : null;
    const rainfallData = rainfall.status === "fulfilled" ? rainfall.value : null;
    const slopeData = slope.status === "fulfilled" ? slope.value : null;
    const satelliteData = satellite.status === "fulfilled" ? satellite.value : null;
    const reportCount = nearbyCount.status === "fulfilled" ? nearbyCount.value : 0;

    // See services/rainfallService.js: utcOffsetSeconds must come from
    // the LOCATION, not the server, or "now" resolves to the wrong hour.
    const cumulativeRainfall = rainfallData ? computeCumulativeWindows(rainfallData.hourly, rainfallData.utcOffsetSeconds) : {};
    const soilMoisture = buildSoilMoisture({ weather: weatherData, cumulativeRainfall });
    const soilMoisturePercent = soilMoisture.value;

    const threshold = evaluateThresholds({
        cumulativeRainfall,
        slopeDegrees: slopeData?.slopeDegrees ?? null,
        soilMoisturePercent
    });

    let mlRisk = { riskScore: 0, riskLevel: "Unavailable" };
    if (slopeData && weatherData) {
        try {
            const { status, data } = await aiService.getPrediction({
                latitude: lat,
                longitude: lng,
                elevation_m: slopeData.elevation,
                slope_degrees: slopeData.slopeDegrees,
                temperature_c: weatherData.current?.temperature_2m,
                humidity_percent: weatherData.current?.relative_humidity_2m,
                rainfall_24h_mm: cumulativeRainfall?.["24h"],
                soil_moisture_percent: soilMoisturePercent
            });
            if (status === 200 && data) {
                mlRisk = { riskScore: typeof data.risk_score === "number" ? data.risk_score : 0, riskLevel: data.risk_level || "Unknown" };
            }
        } catch {
            /* mlRisk stays Unavailable — other signals still contribute */
        }
    }

    const signals = {
        mlRisk,
        threshold,
        cumulativeRainfall,
        soilMoisture,
        citizenReportCount: reportCount,
        satellite: satelliteData
            ? { totalMmOverWindow: satelliteData.totalMmOverWindow, source: satelliteData.source }
            : { note: "Satellite rainfall unavailable this check" }
    };

    const candidate = mlRisk.riskScore >= 70 || threshold.isCritical || reportCount > 0;

    return {
        candidate,
        status: candidate ? "candidate_requires_verification" : "no_candidate",
        signals,
        disclaimer: "A candidate is not a confirmed landslide. Official verification is required before any response action."
    };
};

module.exports = { detectCandidate };
