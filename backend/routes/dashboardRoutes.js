const express = require("express");
const protect = require("../middleware/authMiddleware");

const { getZones } = require("../config/zones");
const { withCache } = require("../services/cacheService");
const getWeatherData = require("../services/weatherService");
const getRainfallData = require("../services/rainfallService");
const { computeCumulativeWindows, computeForecastWindow } = require("../services/rainfallService");
const { getSatelliteRainfall } = require("../services/satelliteRainfallService");
const getSlopeData = require("../services/slopeService");
const aiService = require("../services/aiService");
const { evaluateThresholds } = require("../services/thresholdService");
const { estimateAffectedPopulation } = require("../services/populationService");
const { computePriority, rankByPriority } = require("../services/prioritizationService");
const { translateRiskLevel, translatePriorityLevel, SUPPORTED_LOCALES } = require("../services/i18nService");
const {
    buildSoilMoisture,
    buildEarlyWarning,
    buildContributingFactors,
    buildDataStatuses
} = require("../services/riskIntelligenceService");

const router = express.Router();

const WEATHER_TTL_MS = 5 * 60 * 1000; // 5 min — changes fast
const RAINFALL_TTL_MS = 5 * 60 * 1000;
const SATELLITE_TTL_MS = 30 * 60 * 1000; // NASA POWER updates with days-latency anyway
const SLOPE_TTL_MS = 24 * 60 * 60 * 1000; // terrain doesn't change

// Cheap heuristic stand-in for real road/traffic data (which needs a
// traffic API + hazard-road mapping we don't have). Explicitly marked
// as heuristic in the response rather than presented as measured.
const heuristicRoadStatus = (priorityLevel) => {
    if (priorityLevel === "Critical") return "Caution advised — high-risk zone";
    if (priorityLevel === "High") return "Monitor — elevated risk";
    return "No known issues reported";
};

const buildZoneSummary = async (zone, locale = "en") => {
    const summary = {
        zoneId: zone.id,
        zoneName: zone.name,
        district: zone.district || null,
        lat: zone.lat,
        lng: zone.lng
    };

    // Weather + rainfall (best-effort — one upstream failing shouldn't
    // take down the whole dashboard for every other zone).
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
    const cumulativeRainfall = rainfall
        ? computeCumulativeWindows(rainfall.hourly, rainfall.utcOffsetSeconds)
        : null;

    // Real weather-linked forecast (not derived from the past — the
    // same Open-Meteo response already carries up to 7 days ahead;
    // this just reads it forward instead of only backward).
    const forecastRainfallNext24hMm = rainfall
        ? computeForecastWindow(rainfall.hourly, rainfall.utcOffsetSeconds, 24)
        : null;

    const soilMoisture = buildSoilMoisture({ weather, cumulativeRainfall });
    const soilMoisturePercent = soilMoisture.value;

    const thresholdResult = evaluateThresholds({
        cumulativeRainfall: cumulativeRainfall || {},
        slopeDegrees: slope?.slopeDegrees ?? null,
        soilMoisturePercent
    });

    // AI risk prediction — this microservice may not be running in
    // every environment; degrade to "unavailable" rather than fake a
    // score if it's unreachable.
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
                // Remaining contract fields depend on the AI service's
                // documented schema (ai/docs/AI_INTEGRATION_CONTRACT.md,
                // not included in this backend-only package) — pass
                // through whatever else that contract requires.
            });

            if (status === 200 && data) {
                riskScore = typeof data.risk_score === "number" ? data.risk_score : 0;
                riskLevel = data.risk_level || "Unknown";
                aiExplainability = {
                    confidence: data.confidence ?? null,
                    contributingFactors: data.contributing_factors ?? null,
                    explanationMethod: data.explanation_method ?? null,
                    modelVersion: data.model_version ?? null
                };
            } else {
                summary.aiError = data?.message || `AI service returned ${status}`;
            }
        } catch (error) {
            summary.aiError = error.message;
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
        note: "Derived from priority level, not live traffic data — no traffic API is integrated."
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
    // Same freshness signal as the rest of the rainfall figures — the
    // forecast comes from the same Open-Meteo call, so it's LIVE iff
    // that call actually returned fresh data.
    dataStatus.forecast = rainfallFresh && !summary.rainfallError ? "LIVE" : "UNAVAILABLE";

    return {
        ...summary,
        riskScore,
        riskLevel,
        riskLevelLocalized: translateRiskLevel(riskLevel, locale),
        aiExplainability,
        thresholds: thresholdResult,
        cumulativeRainfallMm: cumulativeRainfall,
        // Real weather-linked forecast (problem-statement requirement
        // "weather-linked risk forecasts") — the forward-looking
        // counterpart to cumulativeRainfallMm above, from the same
        // already-fetched Open-Meteo forecast window, not a projection.
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
        priorityBreakdown: priority.breakdown,
        roadStatus,
        contributingFactors: contributingFactors.factors,
        riskExplanation: contributingFactors.explanation,
        earlyWarning,
        dataStatus,
        lastUpdated: new Date().toISOString(),
        perimeter: { radiusKm: 5, estimatedPopulation: population.estimatedPopulation }
    };
};

// GET /api/dashboard/summary?locale=hi — computed, ranked view across
// all monitored zones. Requires login (any role) so this doesn't sit
// wide open next to the incident data it aggregates. locale defaults
// to English; see services/i18nService.js for supported codes and
// which are review-confirmed vs best-effort.
router.get("/summary", protect, async (req, res) => {
    try {
        const requestedLocale = req.query.locale;
        const locale = SUPPORTED_LOCALES.includes(requestedLocale) ? requestedLocale : "en";

        const zones = getZones();
        const zoneSummaries = await Promise.all(zones.map((zone) => buildZoneSummary(zone, locale)));
        const ranked = rankByPriority(zoneSummaries);

        res.status(200).json({
            message: "Dashboard summary computed",
            locale,
            generatedAt: new Date().toISOString(),
            count: ranked.length,
            data: ranked
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to compute dashboard summary",
            error: error.message
        });
    }
});

module.exports = router;
