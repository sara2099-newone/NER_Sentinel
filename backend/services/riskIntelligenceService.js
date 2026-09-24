// Risk Map intelligence layer — soil moisture resolution, data-source
// status tagging, landslide early-warning detection, and the plain-
// language "why this score" explanation shown when a marker is clicked.
//
// Everything here is a pure function of values already computed
// elsewhere (rainfall windows, slope, AI prediction, thresholds). It
// never invents a number and never rolls a random one — the one place
// it *does* synthesize a value (soil moisture when no live reading
// exists) is derived deterministically from real rainfall/season inputs
// and always labelled DEMO SENSOR so it can never be mistaken for a
// live reading. Swapping in a real sensor/API later means replacing
// buildSoilMoisture's DEMO branch — the LIVE branch and everything
// downstream (thresholds, early warning, contributing factors) already
// expects the same shape and needs no other change.

const { THRESHOLDS } = require("./thresholdService");
const { resolveHourIndex } = require("./rainfallService");

// ---- soil moisture ----
//
// Open-Meteo's `soil_moisture_0_to_7cm` (volumetric water content,
// 0-1 fraction of soil volume) is a real, live-computed model estimate,
// not a physical ground sensor — but it IS the real live data source
// this project already has wired in for weather. The old code always
// read index [0] of the hourly array, which is midnight-local for
// whatever day the forecast starts — a frozen, usually-stale value
// that just happened to look plausible. Fixed to read the same "now"
// index used for rainfall.
const buildSoilMoisture = ({ weather, cumulativeRainfall }) => {
    const times = weather?.hourly?.time;
    const series = weather?.hourly?.soil_moisture_0_to_7cm;
    const utcOffsetSeconds = typeof weather?.utc_offset_seconds === "number" ? weather.utc_offset_seconds : 0;

    if (Array.isArray(times) && Array.isArray(series)) {
        const idx = resolveHourIndex(times, utcOffsetSeconds);
        const raw = idx >= 0 ? series[idx] : null;
        if (typeof raw === "number") {
            return {
                value: Number((raw * 100).toFixed(1)),
                status: "LIVE",
                source: "Open-Meteo (modeled soil moisture, 0-7cm)"
            };
        }
    }

    // No live reading available for this point right now — demo sensor
    // mode, clearly labelled, derived from real cumulative rainfall (not
    // random) so it still moves sensibly with actual conditions: a dry
    // baseline that climbs with recent rain and saturates instead of
    // exceeding 100%.
    const rain24h = typeof cumulativeRainfall?.["24h"] === "number" ? cumulativeRainfall["24h"] : 0;
    const demoValue = Math.max(20, Math.min(98, 35 + rain24h * 0.45));

    return {
        value: Number(demoValue.toFixed(1)),
        status: "DEMO SENSOR DATA",
        source: "Synthetic demo sensor (derived from 24h rainfall) — no live soil sensor/API wired in for this point"
    };
};

// ---- landslide early warning ----
//
// Distinct from the rule-based CRITICAL flag in thresholdService (which
// only fires once a hard limit is crossed): this looks for conditions
// *approaching* those limits, so officials get a heads-up before a rule
// actually trips. Every reason is only added if the underlying data
// says it's true — nothing here is invented.
const WARNING_FRACTION = 0.75; // "approaching" = at least 75% of the critical threshold

const buildEarlyWarning = ({ cumulativeRainfall = {}, slopeDegrees, soilMoisture, thresholds, riskLevel }) => {
    const reasons = [];
    let level = "NONE"; // NONE | WATCH | WARNING | CRITICAL

    const rain24h = cumulativeRainfall?.["24h"];
    const rain1h = cumulativeRainfall?.["1h"];

    if (typeof rain24h === "number") {
        if (rain24h >= THRESHOLDS.rainfall24hCriticalMm) {
            reasons.push(`24h rainfall (${rain24h}mm) is at or above the critical threshold (${THRESHOLDS.rainfall24hCriticalMm}mm)`);
        } else if (rain24h >= THRESHOLDS.rainfall24hCriticalMm * WARNING_FRACTION) {
            reasons.push(`24h rainfall (${rain24h}mm) is approaching the critical threshold (${THRESHOLDS.rainfall24hCriticalMm}mm)`);
        }
    }

    if (typeof rain1h === "number" && rain1h >= THRESHOLDS.rainfall1hCriticalMm * WARNING_FRACTION) {
        reasons.push(`1h rainfall intensity (${rain1h}mm) is approaching cloudburst levels (${THRESHOLDS.rainfall1hCriticalMm}mm/hr)`);
    }

    if (typeof soilMoisture?.value === "number" && soilMoisture.value >= THRESHOLDS.soilMoistureCriticalPercent * WARNING_FRACTION) {
        const label = soilMoisture.status === "LIVE" ? "Soil moisture" : "Soil moisture (demo sensor)";
        reasons.push(`${label} (${soilMoisture.value}%) is approaching saturation (${THRESHOLDS.soilMoistureCriticalPercent}%)`);
    }

    if (typeof slopeDegrees === "number" && slopeDegrees >= THRESHOLDS.slopeDegreesCriticalMin * WARNING_FRACTION) {
        reasons.push(`Terrain slope (${slopeDegrees}\u00b0) gives high exposure once rainfall/soil conditions worsen`);
    }

    if (riskLevel && !["Unavailable", "Unknown"].includes(riskLevel)) {
        if (riskLevel === "High" || riskLevel === "Critical") {
            reasons.push(`AI model currently rates this zone's risk as ${riskLevel}`);
        }
    }

    if (thresholds?.isCritical) {
        level = "CRITICAL";
    } else if (reasons.length >= 2) {
        level = "WARNING";
    } else if (reasons.length === 1) {
        level = "WATCH";
    }

    return {
        level, // NONE | WATCH | WARNING | CRITICAL
        statusLabel:
            level === "CRITICAL" ? "CRITICAL THRESHOLD REACHED" :
            level === "WARNING" ? "CRITICAL THRESHOLD APPROACHING" :
            level === "WATCH" ? "CONDITIONS WORTH WATCHING" :
            "NO EARLY-WARNING SIGNAL",
        reasons
    };
};

// ---- contributing factors (for the "why this score" panel) ----
const bucket = (value, warnAt, criticalAt) => {
    if (typeof value !== "number") return "UNKNOWN";
    if (value >= criticalAt) return "HIGH";
    if (value >= warnAt) return "MODERATE";
    return "LOW";
};

const buildContributingFactors = ({ cumulativeRainfall = {}, soilMoisture, slopeDegrees, population, roadStatus }) => {
    const rain24h = cumulativeRainfall?.["24h"];
    const factors = [
        {
            factor: "Rainfall",
            level: bucket(rain24h, THRESHOLDS.rainfall24hHighMm, THRESHOLDS.rainfall24hCriticalMm),
            detail: typeof rain24h === "number" ? `${rain24h}mm in the last 24h` : "24h rainfall unavailable"
        },
        {
            factor: "Soil Moisture",
            level: bucket(soilMoisture?.value, THRESHOLDS.soilMoistureCriticalPercent * WARNING_FRACTION, THRESHOLDS.soilMoistureCriticalPercent),
            detail: typeof soilMoisture?.value === "number" ? `${soilMoisture.value}% (${soilMoisture.status})` : "Soil moisture unavailable"
        },
        {
            factor: "Slope",
            level: bucket(slopeDegrees, THRESHOLDS.slopeDegreesCriticalMin * WARNING_FRACTION, THRESHOLDS.slopeDegreesCriticalMin),
            detail: typeof slopeDegrees === "number" ? `${slopeDegrees}\u00b0` : "Slope unavailable"
        },
        {
            factor: "Population",
            level: typeof population?.estimatedPopulation === "number"
                ? (population.estimatedPopulation >= 100000 ? "HIGH" : population.estimatedPopulation >= 30000 ? "MODERATE" : "LOW")
                : "UNKNOWN",
            detail: typeof population?.estimatedPopulation === "number"
                ? `~${population.estimatedPopulation.toLocaleString()} within ${population.radiusKm}km (estimate)`
                : "Population estimate unavailable"
        },
        {
            factor: "Road Access",
            level: roadStatus?.isHeuristic ? (roadStatus.value?.startsWith("Caution") ? "HIGH" : roadStatus.value?.startsWith("Monitor") ? "MODERATE" : "LOW") : "UNKNOWN",
            detail: roadStatus?.value || "Road status unavailable"
        }
    ];

    const highFactors = factors.filter((f) => f.level === "HIGH").map((f) => f.factor.toLowerCase());
    let explanation;
    if (highFactors.length) {
        explanation = `${highFactors.join(" and ")} have increased the calculated landslide risk for this area.`;
        explanation = explanation.charAt(0).toUpperCase() + explanation.slice(1);
    } else if (factors.some((f) => f.level === "MODERATE")) {
        explanation = "Some factors are elevated but none have crossed a high-risk threshold right now.";
    } else {
        explanation = "No individual factor is currently elevated; the score mainly reflects potential impact if conditions change.";
    }

    return { factors, explanation };
};

// ---- data source status, per field ----
// One of: LIVE | CACHED | DEMO | ESTIMATED | HEURISTIC | UNAVAILABLE
const buildDataStatuses = ({
    weatherFresh, weatherError,
    rainfallFresh, rainfallError,
    satelliteRainfall, satelliteRainfallError, satelliteFresh,
    soilMoistureStatus,
    slopeError, slopeFresh,
    aiAvailable, aiError
}) => ({
    rainfall: rainfallError ? "UNAVAILABLE" : rainfallFresh === false ? "CACHED" : "LIVE",
    satelliteRainfall: satelliteRainfallError ? "UNAVAILABLE" : satelliteFresh === false ? "CACHED" : satelliteRainfall ? "LIVE" : "UNAVAILABLE",
    soilMoisture: soilMoistureStatus === "LIVE" ? "LIVE" : "DEMO",
    slope: slopeError ? "UNAVAILABLE" : slopeFresh === false ? "CACHED" : "LIVE",
    weather: weatherError ? "UNAVAILABLE" : weatherFresh === false ? "CACHED" : "LIVE",
    aiRisk: aiAvailable ? "LIVE" : "UNAVAILABLE",
    population: "ESTIMATED",
    roadStatus: "HEURISTIC"
});

module.exports = {
    buildSoilMoisture,
    buildEarlyWarning,
    buildContributingFactors,
    buildDataStatuses,
    WARNING_FRACTION
};
