const cron = require("node-cron");
const getWeatherData = require("../services/weatherService");
const getRainfallData = require("../services/rainfallService");
const { computeCumulativeWindows } = require("../services/rainfallService");
const getSlopeData = require("../services/slopeService");
const aiService = require("../services/aiService");
const WeatherData = require("../models/WeatherData");
const { getZones } = require("../config/zones");
const { evaluateThresholds } = require("../services/thresholdService");
const { sendAlertSms } = require("../services/alertService");
const { renderMultilingualAlert, SUPPORTED_LOCALES } = require("../services/i18nService");
const { record: recordAlertLog } = require("../services/alertLogService");
const { withCache } = require("../services/cacheService");
const { buildSoilMoisture } = require("../services/riskIntelligenceService");

// Comma-separated E.164 numbers in .env, e.g. ALERT_SMS_RECIPIENTS=+919876543210,+919876543211
const alertRecipients = (process.env.ALERT_SMS_RECIPIENTS || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

// Comma-separated locale codes, e.g. ALERT_SMS_LOCALES=en,hi,as
// Defaults to English + Hindi. See services/i18nService.js for which
// locales are review-confirmed vs best-effort.
const alertLocales = (process.env.ALERT_SMS_LOCALES || "en,hi")
    .split(",")
    .map((l) => l.trim())
    .filter((l) => SUPPORTED_LOCALES.includes(l));

const SLOPE_TTL_MS = 24 * 60 * 60 * 1000; // terrain doesn't change, cache it a full day

const monitorZone = async (zone) => {
    console.log(`Fetching weather data for ${zone.name}...`);

    const weatherData = await getWeatherData(zone.lat, zone.lng);
    const current = weatherData.current;

    // Cross-check against hard rule thresholds, independent of the ML
    // model, using the same rainfall data we just fetched.
    // NOTE: rainfallData.utcOffsetSeconds (the LOCATION's own UTC
    // offset, not the server's) is required here — see
    // services/rainfallService.js for why. Passing rainfallData.hourly
    // alone silently mis-locates "now" for every zone whose timezone
    // differs from the server's, which is exactly what was making
    // scheduled snapshots (and the auto-alert threshold check that
    // reads them) see wrong/zero rainfall.
    let cumulativeRainfall = null;
    try {
        const rainfallData = await getRainfallData(zone.lat, zone.lng);
        cumulativeRainfall = computeCumulativeWindows(rainfallData.hourly, rainfallData.utcOffsetSeconds);
    } catch (error) {
        console.error(`Rainfall check failed for ${zone.name}:`, error.message);
    }

    const soilMoisture = buildSoilMoisture({ weather: weatherData, cumulativeRainfall });
    const soilMoisturePercent = soilMoisture.value;

    // Real risk score for this snapshot — same inputs the dashboard uses
    // — so the risk-trend chart is built from real recorded history,
    // not a fabricated line. Slope is cached (it doesn't change);
    // AI unavailability degrades to a null score rather than failing
    // the whole snapshot.
    let riskScore = null;
    let riskLevel = null;
    try {
        const { data: slope } = await withCache("scheduler-slope", zone.lat, zone.lng, SLOPE_TTL_MS, () => getSlopeData(zone.lat, zone.lng));
        const { status, data } = await aiService.getPrediction({
            latitude: zone.lat,
            longitude: zone.lng,
            elevation_m: slope.elevation,
            slope_degrees: slope.slopeDegrees,
            temperature_c: current.temperature_2m,
            humidity_percent: current.relative_humidity_2m,
            rainfall_24h_mm: cumulativeRainfall?.["24h"],
            soil_moisture_percent: soilMoisturePercent
        });
        if (status === 200 && data) {
            riskScore = typeof data.risk_score === "number" ? data.risk_score : null;
            riskLevel = data.risk_level || null;
        }
    } catch (error) {
        console.log(`Risk score unavailable for ${zone.name} this cycle (${error.message}) — snapshot saved without it.`);
    }

    const newWeatherData = new WeatherData({
        location: { lat: zone.lat, lng: zone.lng },
        temperature: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        rainfall: current.rain,
        precipitation: current.precipitation,
        windSpeed: current.wind_speed_10m,
        weatherCode: current.weather_code,
        soilMoisture: soilMoisturePercent,
        riskScore,
        riskLevel
    });

    await newWeatherData.save();
    console.log(`Weather data for ${zone.name} saved to MongoDB`);

    const thresholdResult = evaluateThresholds({
        cumulativeRainfall: cumulativeRainfall || {},
        soilMoisturePercent
        // slopeDegrees intentionally omitted here for the THRESHOLD
        // check specifically — it's already folded into riskScore
        // above via the AI call; re-fetching it here would be redundant.
    });

    if (thresholdResult.isCritical) {
        console.warn(`CRITICAL threshold crossed for ${zone.name}:`, thresholdResult.triggeredRules);

        if (alertRecipients.length) {
            const message = renderMultilingualAlert(alertLocales, {
                zone: zone.name,
                rules: thresholdResult.triggeredRules.map((r) => r.rule).join(", ")
            });

            const alertResult = await sendAlertSms(alertRecipients, message);
            console.log(`Alert dispatch for ${zone.name}:`, alertResult.simulated ? "simulated (Twilio not configured)" : "sent");
            recordAlertLog({
                type: "auto-threshold",
                zoneName: zone.name,
                trigger: thresholdResult.triggeredRules.map((r) => r.rule).join(", "),
                message,
                sent: !alertResult.simulated,
                recipients: alertRecipients.length
            });
        } else {
            console.log(`No ALERT_SMS_RECIPIENTS configured — skipping SMS dispatch for ${zone.name}`);
            recordAlertLog({
                type: "auto-threshold",
                zoneName: zone.name,
                trigger: thresholdResult.triggeredRules.map((r) => r.rule).join(", "),
                message: null,
                sent: false,
                recipients: 0,
                note: "ALERT_SMS_RECIPIENTS not configured — threshold crossed but nothing to notify"
            });
        }
    }
};

// Run every 10 minutes, across every configured zone.
cron.schedule("*/10 * * * *", async () => {
    const zones = getZones();

    for (const zone of zones) {
        try {
            await monitorZone(zone);
        } catch (error) {
            console.error(`Scheduled weather collection failed for ${zone.name}:`, error.message);
        }
    }
});
