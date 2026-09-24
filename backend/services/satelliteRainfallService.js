// Satellite-derived rainfall — NASA POWER API.
//
// Honesty note (read before demoing this as "GPM/IMERG"):
// Full GPM/IMERG access is served through NASA GES DISC / Earthdata,
// which requires an Earthdata Login + OPeNDAP/Giovanni token — not a
// simple no-auth REST call, and out of scope for a hackathon timeline.
// NASA POWER (power.larc.nasa.gov) is a genuinely public, no-key REST
// API, also run by NASA, that serves PRECTOTCORR — precipitation
// derived from the same family of satellite + reanalysis (MERRA-2)
// sources. It's a real satellite-backed data source, just coarser
// resolution (~50km) and daily (not sub-hourly like IMERG). Use this
// service and describe it accurately as "NASA POWER satellite
// precipitation" rather than claiming raw IMERG.

const POWER_BASE_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";

const formatDate = (date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
};

// Returns the last `days` days of satellite-derived daily precipitation
// (mm/day) for a point. NASA POWER has a few days of latency, so we ask
// for a window ending a few days back rather than "today".
const getSatelliteRainfall = async (latitude, longitude, days = 7) => {
    const latencyBufferDays = 3;
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - latencyBufferDays);

    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);

    const url =
        `${POWER_BASE_URL}` +
        `?latitude=${latitude}` +
        `&longitude=${longitude}` +
        `&start=${formatDate(start)}` +
        `&end=${formatDate(end)}` +
        `&parameters=PRECTOTCORR` +
        `&community=AG` +
        `&format=JSON`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`NASA POWER API error: ${response.status}`);
        }

        const data = await response.json();

        const dailySeries =
            data?.properties?.parameter?.PRECTOTCORR || {};

        const entries = Object.entries(dailySeries).filter(
            // NASA POWER uses -999 as a "no data" sentinel.
            ([, value]) => typeof value === "number" && value > -900
        );

        const totalMm = entries.reduce((sum, [, value]) => sum + value, 0);
        const averageMmPerDay = entries.length
            ? Number((totalMm / entries.length).toFixed(2))
            : null;

        return {
            source: "NASA POWER (PRECTOTCORR, MERRA-2/satellite-derived)",
            latitude,
            longitude,
            dailyPrecipitationMm: Object.fromEntries(entries),
            totalMmOverWindow: Number(totalMm.toFixed(2)),
            averageMmPerDay,
            windowDays: days,
            note:
                "Coarse-resolution (~50km) reanalysis-blended satellite " +
                "estimate with ~3 day latency, not raw high-res IMERG."
        };
    } catch (error) {
        console.error("Satellite rainfall (NASA POWER) failed:", error.message);
        throw error;
    }
};

module.exports = { getSatelliteRainfall };
