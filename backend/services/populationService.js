// Affected-population estimate within a radius of a point.
//
// There's no real gridded population dataset wired in here (that would
// mean WorldPop/GHSL raster data + a GIS stack, out of scope for this
// prototype). Instead: find the nearest monitored zone (config/zones.js)
// and use its approximate population density as a flat rate across the
// requested radius. This is a genuine computation (not a hardcoded
// number on the dashboard), but it is an order-of-magnitude estimate,
// not a census-accurate count — say so wherever this number is shown.

const { calculateDistance } = require("./geoService");
const { getZones } = require("../config/zones");

const findNearestZone = (latitude, longitude) => {
    const zones = getZones();
    if (!zones.length) return null;

    let nearest = zones[0];
    let nearestDistanceKm = calculateDistance(latitude, longitude, zones[0].lat, zones[0].lng);

    for (const zone of zones.slice(1)) {
        const distanceKm = calculateDistance(latitude, longitude, zone.lat, zone.lng);
        if (distanceKm < nearestDistanceKm) {
            nearest = zone;
            nearestDistanceKm = distanceKm;
        }
    }

    return { zone: nearest, distanceKm: nearestDistanceKm };
};

const estimateAffectedPopulation = (latitude, longitude, radiusKm = 5) => {
    const nearest = findNearestZone(latitude, longitude);

    if (!nearest) {
        return {
            estimatedPopulation: null,
            method: "no zones configured"
        };
    }

    const areaSqKm = Math.PI * radiusKm * radiusKm;
    const estimatedPopulation = Math.round(
        areaSqKm * nearest.zone.populationDensityPerSqKm
    );

    return {
        estimatedPopulation,
        radiusKm,
        areaSqKm: Number(areaSqKm.toFixed(2)),
        basedOnZone: nearest.zone.name,
        distanceToZoneCenterKm: nearest.distanceKm,
        populationDensityPerSqKmUsed: nearest.zone.populationDensityPerSqKm,
        method: "approximate: nearest-zone density * circular area (not a real gridded population layer)"
    };
};

module.exports = { estimateAffectedPopulation, findNearestZone };
