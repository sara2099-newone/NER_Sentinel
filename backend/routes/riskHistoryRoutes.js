const express = require("express");
const protect = require("../middleware/authMiddleware");
const WeatherData = require("../models/WeatherData");
const { getZones } = require("../config/zones");

const router = express.Router();

// GET /api/risk-history?zoneId=shillong&hours=24
// Real observed risk-score history from the snapshots
// scheduler/weatherScheduler.js writes every 10 minutes (each one now
// includes the AI's riskScore/riskLevel at that moment — see the
// scheduler for why). hours defaults to 24, capped at 72.
router.get("/", protect, async (req, res) => {
    try {
        const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 72);
        const zones = getZones();
        const zone = zones.find((z) => z.id === req.query.zoneId) || zones[0];
        if (!zone) return res.status(400).json({ message: "No monitored zones configured" });

        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const snapshots = await WeatherData.find({
            "location.lat": zone.lat,
            "location.lng": zone.lng,
            createdAt: { $gte: since },
            riskScore: { $ne: null }
        })
            .sort({ createdAt: 1 })
            .select("riskScore riskLevel createdAt -_id");

        res.status(200).json({
            zone: zone.name,
            hours,
            points: snapshots.map((s) => ({ observedAt: s.createdAt, riskScore: s.riskScore, riskLevel: s.riskLevel })),
            note: snapshots.length
                ? undefined
                : "No snapshots yet for this window — the scheduler writes one every 10 minutes, so a freshly-started server won't have history yet."
        });
    } catch (error) {
        res.status(500).json({ message: "Failed to load risk history", error: error.message });
    }
});

module.exports = router;
