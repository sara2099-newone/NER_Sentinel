const getRainfallData = async (latitude, longitude) => {
    try {
        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${latitude}` +
            `&longitude=${longitude}` +
            `&hourly=precipitation,rain` +
            `&daily=precipitation_sum,rain_sum` +
            `&forecast_days=7` +
            `&timezone=auto`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Rainfall API error: ${response.status}`);
        }

        const data = await response.json();

        return {
            latitude: data.latitude,
            longitude: data.longitude,
            hourly: data.hourly,
            daily: data.daily,
            // Open-Meteo always returns this alongside timezone=auto — the
            // number of seconds to add to a UTC instant to get the LOCAL
            // wall-clock time that the "hourly.time" strings are labelled
            // in. Callers need this to correctly find "now" inside the
            // hourly series (see computeCumulativeWindows/resolveHourIndex
            // below) — without it, every zone outside the server's own
            // timezone silently reads the wrong hour.
            utcOffsetSeconds: typeof data.utc_offset_seconds === "number" ? data.utc_offset_seconds : 0,
            timezone: data.timezone || null
        };

    } catch (error) {
        console.error("Rainfall API failed:", error.message);
        throw error;
    }
};

// ----------------------------------------------------------------
// ROOT CAUSE of "1h/3h/6h/24h rainfall always showing 0mm":
//
// Open-Meteo's `timezone=auto` returns "hourly.time" as LOCAL
// wall-clock strings with no "Z"/offset suffix, e.g. "2026-09-22T10:00"
// meaning 10am at the requested location — NOT 10am UTC.
//
// The old code found "now" two different (both broken) ways:
//   1. It built `nowIso` from `new Date().toISOString()`, which is the
//      current hour in UTC, and looked for that exact string inside an
//      array labelled in the LOCATION's local time. For every NER zone
//      (UTC+5:30) this is off by 5.5 hours from what it should match,
//      so the exact-match almost always failed.
//   2. Its fallback parsed each "Z"-less time string with `new
//      Date(t)`, which JavaScript interprets in the SERVER's own local
//      timezone (whatever the deploy host's OS/container clock is set
//      to — typically UTC on a cloud box), not the zone's timezone. On
//      a UTC server this silently reinterprets "10:00 Shillong time" as
//      "10:00 UTC" — again off by 5.5 hours.
//
// Both paths land on the wrong index. Depending on what time of day the
// request happens to land, that wrong index can point at an overnight
// hour where precipitation is genuinely 0 — which is exactly the "every
// window shows 0mm" symptom, even while satelliteRainfallService (which
// works entirely in UTC calendar days, never touches hourly local-time
// strings) keeps returning a real number.
//
// FIX: resolve "now" using the LOCATION's own utc_offset_seconds
// (returned by Open-Meteo itself, see getRainfallData above) and never
// let `new Date(...)` parse a timezone-less string — compare local-label
// strings to local-label strings the whole way through.
const resolveHourIndex = (times, utcOffsetSeconds = 0) => {
    if (!Array.isArray(times) || !times.length) return -1;

    // Shift the true current instant by the location's own offset, then
    // read its UTC fields back out — this reproduces the exact string
    // convention Open-Meteo uses for its local-time labels, so it can be
    // compared as plain strings (which also sort correctly, since they're
    // ISO 8601) instead of ever being re-parsed as a Date.
    const nowAtLocationMs = Date.now() + utcOffsetSeconds * 1000;
    const nowHourLabel = new Date(nowAtLocationMs).toISOString().slice(0, 13); // "YYYY-MM-DDTHH"

    const exactIdx = times.findIndex((t) => t.startsWith(nowHourLabel));
    if (exactIdx !== -1) return exactIdx;

    // No exact hour match (e.g. right at the edge of the series) — take
    // the latest timestamp that is still <= "now", using string
    // comparison only.
    const nowFullLabel = new Date(nowAtLocationMs).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
    let fallbackIdx = -1;
    for (let i = 0; i < times.length; i++) {
        if (times[i] <= nowFullLabel) fallbackIdx = i;
        else break;
    }
    return fallbackIdx === -1 ? 0 : fallbackIdx;
};

// Cumulative rainfall over the last N hours, computed from the hourly
// series Open-Meteo already returns (no extra API call). Open-Meteo's
// "hourly" array runs from the start of today through +7 days, so the
// most recently elapsed hours sit right before the current forecast
// hour. We find "now" in the timestamps array (using the location's own
// UTC offset — see resolveHourIndex) and sum backwards.
const computeCumulativeWindows = (hourlyData, utcOffsetSeconds = 0, windowsHours = [1, 3, 6, 24]) => {
    if (!hourlyData || !Array.isArray(hourlyData.time) || !Array.isArray(hourlyData.precipitation)) {
        return null;
    }

    const times = hourlyData.time;
    const precipitation = hourlyData.precipitation;

    const nowIndex = resolveHourIndex(times, utcOffsetSeconds);
    if (nowIndex === -1) return null;

    const result = {};

    for (const hours of windowsHours) {
        const startIdx = Math.max(0, nowIndex - hours + 1);
        const slice = precipitation.slice(startIdx, nowIndex + 1);
        const validValues = slice.filter((v) => typeof v === "number");

        result[`${hours}h`] = validValues.length
            ? Number(validValues.reduce((sum, v) => sum + v, 0).toFixed(2))
            : null;
    }

    return result;
};

// Forward-looking counterpart to computeCumulativeWindows: total
// forecast rainfall over the NEXT N hours, from the same hourly series
// Open-Meteo already returns (forecast_days=7 in getRainfallData
// above, so up to 168 hours ahead are already in every response — this
// was fetched but never read forward). Real forecast data, not a
// projection computed from the past; if Open-Meteo doesn't have enough
// hours ahead (rare, only right at the edge of its window), returns null
// rather than a partial/misleading sum.
const computeForecastWindow = (hourlyData, utcOffsetSeconds = 0, hoursAhead = 24) => {
    if (!hourlyData || !Array.isArray(hourlyData.time) || !Array.isArray(hourlyData.precipitation)) {
        return null;
    }

    const times = hourlyData.time;
    const precipitation = hourlyData.precipitation;
    const nowIndex = resolveHourIndex(times, utcOffsetSeconds);
    if (nowIndex === -1) return null;

    const endIdx = Math.min(times.length - 1, nowIndex + hoursAhead);
    const slice = precipitation.slice(nowIndex + 1, endIdx + 1);
    const validValues = slice.filter((v) => typeof v === "number");
    if (!validValues.length) return null;

    return Number(validValues.reduce((sum, v) => sum + v, 0).toFixed(2));
};

module.exports = getRainfallData;
module.exports.computeCumulativeWindows = computeCumulativeWindows;
module.exports.computeForecastWindow = computeForecastWindow;
module.exports.resolveHourIndex = resolveHourIndex;