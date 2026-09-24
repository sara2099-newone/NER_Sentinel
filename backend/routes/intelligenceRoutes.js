const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { detectCandidate } = require("../services/candidateIncidentService");

const router = express.Router();

// POST /api/intelligence/candidate  { lat, lng }  (Official-only)
// Combines AI risk + rule thresholds + nearby citizen reports +
// satellite rainfall into one signal. Never auto-confirms — see
// candidateIncidentService.js for the disclaimer this always carries.
router.post("/candidate", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const lat = Number(req.body.lat);
        const lng = Number(req.body.lng);
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ message: "lat and lng are required" });
        }
        res.status(200).json(await detectCandidate(lat, lng));
    } catch (error) {
        res.status(502).json({ message: "Candidate detection failed", error: error.message });
    }
});

module.exports = router;
