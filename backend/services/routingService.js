// Real turn-by-turn routing via OSRM's public demo server
// (router.project-osrm.org) — free, no API key, real OpenStreetMap
// road network. This is genuine routing, not a mockup line drawn
// between two points.
//
// "Low-risk route" honesty note: OSRM has no concept of landslide
// risk. What this adds on top is a simple heuristic — for each
// alternative route OSRM returns, check how close its path comes to
// any OTHER monitored zone that's currently Critical/High priority,
// and prefer the alternative that stays further away. That is a real,
// computed comparison between real routes, but it is NOT the same as
// live road-closure or traffic-aware routing (no such data source
// exists here) — label it as an advisory, not a guarantee.

const { calculateDistance } = require("./geoService");

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

// Distance from a route's geometry to a hazard point, sampled along
// the polyline (coarse but enough for a "does this pass near X" check).
const minDistanceToPoint = (coordinates, lat, lng) => {
    let min = Infinity;
    for (const [lon, latPt] of coordinates) {
        const d = calculateDistance(latPt, lon, lat, lng);
        if (d < min) min = d;
    }
    return min;
};

const getRoute = async (fromLat, fromLng, toLat, toLng, hazardZones = []) => {
    const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?geometries=geojson&overview=full&alternatives=true&steps=false`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`OSRM API error: ${response.status}`);
    const data = await response.json();

    if (data.code !== "Ok" || !data.routes?.length) {
        throw new Error(`OSRM couldn't find a route (${data.code || "unknown error"})`);
    }

    const routes = data.routes.map((r, idx) => {
        const coords = r.geometry.coordinates; // [lng, lat][]

        const hazardProximity = hazardZones.map((zone) => ({
            zoneName: zone.zoneName,
            closestApproachKm: Number(minDistanceToPoint(coords, zone.lat, zone.lng).toFixed(2))
        }));

        const closestHazardKm = hazardProximity.length
            ? Math.min(...hazardProximity.map((h) => h.closestApproachKm))
            : null;

        return {
            index: idx,
            distanceKm: Number((r.distance / 1000).toFixed(1)),
            durationMin: Math.round(r.duration / 60),
            geometry: r.geometry, // GeoJSON LineString — draw directly on Leaflet
            hazardProximity,
            closestHazardKm,
            riskAdvisory:
                closestHazardKm === null
                    ? "No other monitored high-risk zones nearby."
                    : closestHazardKm < 2
                    ? `Passes within ${closestHazardKm}km of another high-risk zone — consider the alternative route if available.`
                    : `Stays ${closestHazardKm}km+ from other monitored high-risk zones.`
        };
    });

    // Prefer the route with the greatest distance from any other
    // hazard zone; ties broken by shortest duration.
    const recommended = [...routes].sort((a, b) => {
        const aHazard = a.closestHazardKm ?? Infinity;
        const bHazard = b.closestHazardKm ?? Infinity;
        if (aHazard !== bHazard) return bHazard - aHazard;
        return a.durationMin - b.durationMin;
    })[0];

    return {
        routes,
        recommendedIndex: recommended.index,
        source: "OSRM public demo server (router.project-osrm.org) — real OpenStreetMap road network",
        note: "riskAdvisory is a heuristic distance-from-other-hazard-zones check, not live traffic or road-closure data."
    };
};

module.exports = { getRoute };
