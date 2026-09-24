// Real headcounts computed from actual safety-status records — this is
// NOT the same thing as services/populationService.js, which is a
// density-based *estimate* of everyone who lives in an area. This
// counts only citizens who have actually used NER Sentinel (app or
// SMS) and shared a status/location. Small number, but a real one.

const { calculateDistance } = require("./geoService");

// records: [{ lat, lng, status: "Safe"|"NeedHelp"|"Unknown", updatedAt }]
const countByRadius = (records, centerLat, centerLng, radiusKm) => {
    const inRange = records.filter(
        (r) => r.lat != null && r.lng != null && calculateDistance(r.lat, r.lng, centerLat, centerLng) <= radiusKm
    );

    return {
        totalReporting: inRange.length,
        safe: inRange.filter((r) => r.status === "Safe").length,
        needHelp: inRange.filter((r) => r.status === "NeedHelp").length,
        unknown: inRange.filter((r) => !r.status || r.status === "Unknown").length,
        radiusKm,
        method: "Real count of citizens who shared a status/location via the app or SMS — not everyone in the area, only those who have reported in."
    };
};

// "Possibly affected": inside the radius, and either flagged NeedHelp
// or haven't sent any update since `sinceCutoff` (a landslide/event
// timestamp) — i.e. went quiet during/after the event. This is the
// honest substitute for telecom-grade presence detection: it can only
// see citizens who have used the app or replied by SMS at least once,
// and "went quiet" is a proxy for "may be affected", not proof.
const findPossiblyAffected = (records, centerLat, centerLng, radiusKm, sinceCutoff) => {
    const cutoff = sinceCutoff ? new Date(sinceCutoff) : null;

    return records
        .filter((r) => r.lat != null && r.lng != null && calculateDistance(r.lat, r.lng, centerLat, centerLng) <= radiusKm)
        .filter((r) => r.status === "NeedHelp" || (cutoff && new Date(r.updatedAt) < cutoff))
        .map((r) => ({ ...r, distanceFromZoneKm: calculateDistance(r.lat, r.lng, centerLat, centerLng) }));
};

module.exports = { countByRadius, findPossiblyAffected };
