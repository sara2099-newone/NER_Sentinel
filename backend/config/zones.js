// Monitored zones for NER Sentinel.
//
// This replaces the single hardcoded Shillong coordinate the scheduler
// used to run against. Add/remove zones here — nothing else needs to
// change; the scheduler, dashboard aggregation, and population estimate
// all iterate this list.
//
// populationDensityPerSqKm is an APPROXIMATE, indicative figure (rounded,
// derived from publicly available town/district-level census reporting).
// It is a stand-in for a real gridded population layer (e.g. WorldPop /
// GHSL), which is out of scope for this prototype. Treat any "affected
// population" number computed from it as an order-of-magnitude estimate
// for demo purposes, not a precise count.

// district: the real administrative district each zone's town is the
// headquarters of — verified (Gangtok district was renamed from "East
// Sikkim" in Dec 2021; Itanagar sits in Papum Pare district but is
// administered day-to-day as its own "Capital Complex" sub-unit under
// a separate Deputy Commissioner — both noted below rather than
// simplified away). Supports the "district administrations" framing
// the alerting/dispatch flow is meant to serve — real names, not
// invented ones.
const ZONES = [
    {
        id: "shillong",
        name: "Shillong, Meghalaya",
        district: "East Khasi Hills district",
        lat: 25.5788,
        lng: 91.8933,
        populationDensityPerSqKm: 3000
    },
    {
        id: "aizawl",
        name: "Aizawl, Mizoram",
        district: "Aizawl district",
        lat: 23.7271,
        lng: 92.7176,
        populationDensityPerSqKm: 2200
    },
    {
        id: "kohima",
        name: "Kohima, Nagaland",
        district: "Kohima district",
        lat: 25.6751,
        lng: 94.1086,
        populationDensityPerSqKm: 1800
    },
    {
        id: "itanagar",
        name: "Itanagar, Arunachal Pradesh",
        district: "Papum Pare district (Itanagar Capital Complex)",
        lat: 27.0844,
        lng: 93.6053,
        populationDensityPerSqKm: 1200
    },
    {
        id: "gangtok",
        name: "Gangtok, Sikkim",
        district: "Gangtok district",
        lat: 27.3389,
        lng: 88.6065,
        populationDensityPerSqKm: 2600
    }
];

const getZones = () => ZONES;

const getZoneById = (id) => ZONES.find((zone) => zone.id === id) || null;

module.exports = {
    ZONES,
    getZones,
    getZoneById
};
