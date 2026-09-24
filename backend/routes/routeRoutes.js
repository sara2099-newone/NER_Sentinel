const express = require("express");
const protect = require("../middleware/authMiddleware");
const { getRoute } = require("../services/routingService");
const { calculateDistance } = require("../services/geoService");
const { getZones } = require("../config/zones");

const router = express.Router();

// GET /api/route?fromLat&fromLng&toZoneId  — any authenticated user.
// Officials use this for responder dispatch; citizens use the same
// real routing for "safe route" (away from a hazard zone, toward the
// nearest lower-risk one). The computation is identical either way —
// only the frontend presents it differently per role.
router.get("/", protect, async (req, res) => {
    const fromLat = Number(req.query.fromLat);
    const fromLng = Number(req.query.fromLng);
    const toZoneId = req.query.toZoneId;

    const destination = getZones().find((z) => z.id === toZoneId);
    if (!destination) return res.status(400).json({ message: "toZoneId not recognised" });
    if (Number.isNaN(fromLat) || Number.isNaN(fromLng)) {
        return res.status(400).json({ message: "fromLat and fromLng query params are required" });
    }

    try {
        const otherZones = getZones()
            .filter((z) => z.id !== toZoneId)
            .map((z) => ({ zoneName: z.name, lat: z.lat, lng: z.lng }));

        const result = await getRoute(fromLat, fromLng, destination.lat, destination.lng, otherZones);
        res.status(200).json({ destination: destination.name, ...result });
    } catch (error) {
        // Graceful straight-line fallback when OSRM is unreachable (no
        // internet, firewall, etc.) — never leave the panel with
        // nothing but an error. Clearly labeled as simulated.
        const straightKm = calculateDistance(fromLat, fromLng, destination.lat, destination.lng);
        res.status(200).json({
            destination: destination.name,
            simulated: true,
            error: error.message,
            routes: [
                {
                    index: 0,
                    distanceKm: straightKm,
                    durationMin: Math.round((straightKm / 40) * 60),
                    geometry: { type: "LineString", coordinates: [[fromLng, fromLat], [destination.lng, destination.lat]] },
                    riskAdvisory: "Simulated straight-line estimate — live road routing unavailable right now.",
                    hazardProximity: []
                }
            ],
            recommendedIndex: 0,
            source: "Simulated (straight-line distance) — OSRM's public routing server could not be reached",
            note: "This is a fallback estimate, not a real route. It appears automatically whenever live routing is unreachable, so the panel never just shows an error."
        });
    }
});

module.exports = router;
