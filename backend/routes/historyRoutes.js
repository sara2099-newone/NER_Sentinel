const express = require("express");
const HistoricalLandslide = require("../models/HistoricalLandslide");
const { RECORDS } = require("../data/historicalLandslides");

const router = express.Router();

// GET /api/history/landslides?state=Mizoram
// Reads from MongoDB if it's been seeded (node scripts/seedHistoricalLandslides.js);
// falls back to the in-code dataset directly if the DB collection is
// empty, so this endpoint works even before you've run the seed script.
router.get("/landslides", async (req, res) => {
    try {
        const { state } = req.query;
        const filter = state ? { state } : {};

        let records = await HistoricalLandslide.find(filter).sort({ date: -1 });

        if (!records.length) {
            records = RECORDS.filter((r) => !state || r.state === state).sort(
                (a, b) => b.date - a.date
            );
        }

        res.status(200).json({
            count: records.length,
            data: records,
            note:
                "Real, publicly-sourced sample spanning small local incidents to the two largest NER landslide-related disasters (2022 Manipur/Tupul, 2023 Sikkim GLOF) plus 2025-2026 events — not a comprehensive inventory. " +
                "See data/historicalLandslides.js for sourcing and coordinate-precision notes."
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch historical landslide records",
            error: error.message
        });
    }
});

module.exports = router;
