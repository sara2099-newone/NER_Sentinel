// DEMO / SIMULATED citizen population generator for the 5km Citizen
// Zone feature.
//
// This is intentionally NOT real data — NER Sentinel has no telecom or
// device-tracking access, so there is no real way to know how many
// people are physically inside a 5km radius right now. Everything this
// module returns is clearly labeled demo:true and every citizen id is
// prefixed DEMO- so it can never be confused with a real safety report
// (see safetyStatuses / presenceService.js, which ARE real reports).
//
// It IS deterministic, not re-randomized on every request: the same
// zone always produces the same simulated roster (seeded from the zone
// id), and the Safe/NeedHelp/NoResponse split is weighted by that
// zone's REAL current priority level (from riskIntelligenceService /
// the AI risk pipeline) — a Critical zone simulates more people
// needing help than a Low zone. So the only "made up" part is the
// existence of the demo citizens themselves; how risky their situation
// looks still tracks the real Risk Map.

// ---- tiny deterministic PRNG (mulberry32) so results are stable per zone ----
const hashStringToSeed = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
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

// How the simulated population splits by status, keyed by the zone's
// REAL current priority level.
const SPLIT_BY_PRIORITY = {
    Critical: { safe: 0.45, needHelp: 0.3, noResponse: 0.25 },
    High: { safe: 0.6, needHelp: 0.15, noResponse: 0.25 },
    Moderate: { safe: 0.75, needHelp: 0.05, noResponse: 0.2 },
    Low: { safe: 0.85, needHelp: 0.02, noResponse: 0.13 }
};

const DEFAULT_COUNT = 30;

// Uniform-random point within radiusKm of (lat,lng) — sqrt(rand) keeps
// points spread evenly over the disc's area rather than bunching near
// the center.
const randomPointInRadius = (rand, lat, lng, radiusKm) => {
    const angle = rand() * 2 * Math.PI;
    const distanceKm = radiusKm * Math.sqrt(rand());
    const dLat = (distanceKm / 111.32) * Math.cos(angle);
    const dLng = (distanceKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
    return { lat: Number((lat + dLat).toFixed(5)), lng: Number((lng + dLng).toFixed(5)) };
};

/**
 * Generate a deterministic, clearly-labeled demo citizen roster for a
 * zone's 5km perimeter.
 */
const generateDemoCitizens = ({ zoneId, zoneName, lat, lng, priorityLevel, radiusKm = 5, count = DEFAULT_COUNT }) => {
    const rand = mulberry32(hashStringToSeed(String(zoneId)));
    const split = SPLIT_BY_PRIORITY[priorityLevel] || SPLIT_BY_PRIORITY.Low;

    const citizens = [];
    for (let i = 0; i < count; i++) {
        const roll = rand();
        const status = roll < split.needHelp ? "NeedHelp" : roll < split.needHelp + split.safe ? "Safe" : "NoResponse";
        const point = randomPointInRadius(rand, lat, lng, radiusKm);
        // Stable-looking 4-digit id derived from the seed + index, not
        // Math.random(), so it doesn't change between requests.
        const idNumber = 1000 + ((hashStringToSeed(`${zoneId}:${i}`) >>> 0) % 9000);
        citizens.push({
            id: `DEMO-${idNumber}`,
            status,
            lastKnownLocation: point,
            demo: true
        });
    }

    const counts = {
        safe: citizens.filter((c) => c.status === "Safe").length,
        needHelp: citizens.filter((c) => c.status === "NeedHelp").length,
        noResponse: citizens.filter((c) => c.status === "NoResponse").length
    };

    return {
        demo: true,
        zoneId,
        zoneName,
        center: { lat, lng },
        radiusKm,
        total: citizens.length,
        counts,
        citizens,
        method:
            "SIMULATED for testing — NER Sentinel has no telecom/device tracking, so this is not a real headcount. " +
            "The Safe/Need Help/No Response split is weighted by this zone's real current priority level."
    };
};

module.exports = { generateDemoCitizens };
