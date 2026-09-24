// Rule-based critical-threshold detection.
//
// Deliberately independent of the ML model: if the AI service is down,
// slow, or simply wrong on an edge case, these plain if/else rules
// (based on published landslide-triggering rainfall/slope thresholds
// used in Indian Meteorological Dept / GSI early-warning literature,
// simplified for a prototype) still flag an obviously dangerous
// situation. This is meant to run ALONGSIDE the AI prediction, not
// replace it — the dashboard should show both.

const THRESHOLDS = {
    rainfall24hCriticalMm: 100, // heavy-to-very-heavy rainfall in 24h
    rainfall24hHighMm: 60,
    rainfall1hCriticalMm: 30, // cloudburst-scale intensity
    slopeDegreesCriticalMin: 30, // above this, even moderate rain is dangerous
    soilMoistureCriticalPercent: 80
};

// inputs: { cumulativeRainfall: { "1h", "3h", "6h", "24h" }, slopeDegrees, soilMoisturePercent }
const evaluateThresholds = (inputs = {}) => {
    const {
        cumulativeRainfall = {},
        slopeDegrees = null,
        soilMoisturePercent = null
    } = inputs;

    const triggeredRules = [];

    if (
        typeof cumulativeRainfall["24h"] === "number" &&
        cumulativeRainfall["24h"] >= THRESHOLDS.rainfall24hCriticalMm
    ) {
        triggeredRules.push({
            rule: "24h_rainfall_critical",
            detail: `${cumulativeRainfall["24h"]}mm in 24h >= ${THRESHOLDS.rainfall24hCriticalMm}mm critical threshold`
        });
    } else if (
        typeof cumulativeRainfall["24h"] === "number" &&
        cumulativeRainfall["24h"] >= THRESHOLDS.rainfall24hHighMm
    ) {
        triggeredRules.push({
            rule: "24h_rainfall_high",
            detail: `${cumulativeRainfall["24h"]}mm in 24h >= ${THRESHOLDS.rainfall24hHighMm}mm elevated threshold`
        });
    }

    if (
        typeof cumulativeRainfall["1h"] === "number" &&
        cumulativeRainfall["1h"] >= THRESHOLDS.rainfall1hCriticalMm
    ) {
        triggeredRules.push({
            rule: "1h_cloudburst_intensity",
            detail: `${cumulativeRainfall["1h"]}mm in 1h >= ${THRESHOLDS.rainfall1hCriticalMm}mm cloudburst threshold`
        });
    }

    if (
        typeof slopeDegrees === "number" &&
        slopeDegrees >= THRESHOLDS.slopeDegreesCriticalMin
    ) {
        triggeredRules.push({
            rule: "steep_slope",
            detail: `${slopeDegrees}\u00b0 slope >= ${THRESHOLDS.slopeDegreesCriticalMin}\u00b0 critical threshold`
        });
    }

    if (
        typeof soilMoisturePercent === "number" &&
        soilMoisturePercent >= THRESHOLDS.soilMoistureCriticalPercent
    ) {
        triggeredRules.push({
            rule: "saturated_soil",
            detail: `${soilMoisturePercent}% soil moisture >= ${THRESHOLDS.soilMoistureCriticalPercent}% saturation threshold`
        });
    }

    const isCritical = triggeredRules.some((r) =>
        r.rule.endsWith("_critical") || r.rule === "1h_cloudburst_intensity" || r.rule === "steep_slope" || r.rule === "saturated_soil"
    );

    return {
        isCritical,
        triggeredRules,
        thresholds: THRESHOLDS
    };
};

module.exports = { evaluateThresholds, THRESHOLDS };
