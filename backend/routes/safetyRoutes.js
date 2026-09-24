const express = require("express");
const SafetyStatus = require("../models/SafetyStatus");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { translateSafetyStatus, SUPPORTED_LOCALES } = require("../services/i18nService");
const { countByRadius, findPossiblyAffected } = require("../services/presenceService");

const router = express.Router();

// Citizen: set / update own status ("I'm Safe" or "I Need Help"),
// optionally with a location ping and/or a phone number so they can
// later reply "SAFE"/"HELP" by plain SMS with no app open.
router.post("/status", protect, async (req, res) => {
    try {
        const { status, note, lat, lng, phone, displayName } = req.body;

        if (!["Safe", "NeedHelp"].includes(status)) {
            return res.status(400).json({
                message: "status must be 'Safe' or 'NeedHelp'"
            });
        }

        const update = {
            status,
            note: note || "",
            source: "app"
        };
        if (phone) update.phone = phone;
        if (displayName) update.displayName = displayName;

        if (lat !== undefined && lng !== undefined) {
            update.lastKnownLocation = {
                lat: Number(lat),
                lng: Number(lng),
                capturedAt: new Date()
            };
        }

        const saved = await SafetyStatus.findOneAndUpdate(
            { user: req.user.userId },
            update,
            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({
            message: "Safety status updated",
            data: saved,
            statusLabelLocalized: translateSafetyStatus(
                status,
                SUPPORTED_LOCALES.includes(req.query.locale) ? req.query.locale : "en"
            )
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to update safety status",
            error: error.message
        });
    }
});

// Citizen: location-only ping, without changing status (e.g. a
// periodic background update while status stays "Safe").
router.post("/location", protect, async (req, res) => {
    try {
        const { lat, lng } = req.body;

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({
                message: "lat and lng are required"
            });
        }

        const saved = await SafetyStatus.findOneAndUpdate(
            { user: req.user.userId },
            {
                lastKnownLocation: {
                    lat: Number(lat),
                    lng: Number(lng),
                    capturedAt: new Date()
                }
            },
            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({
            message: "Location updated",
            data: saved
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to update location",
            error: error.message
        });
    }
});

// Official-only: everyone currently flagged "I Need Help", most
// recent first — includes both app-based and SMS-based reports.
router.get("/needs-help", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const records = await SafetyStatus.find({ status: "NeedHelp" })
            .populate("user", "name email")
            .sort({ updatedAt: -1 });

        res.status(200).json({
            count: records.length,
            data: records
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch help requests",
            error: error.message
        });
    }
});

// Official-only: REAL count of citizens who have reported a status
// within radiusKm of a point — not a density estimate, an actual
// count of people who used the app or SMS. See presenceService.js.
router.get("/count", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const lat = Number(req.query.lat);
        const lng = Number(req.query.lng);
        const radiusKm = Number(req.query.radiusKm) || 5;

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ message: "lat and lng query params are required" });
        }

        const all = await SafetyStatus.find({ "lastKnownLocation.lat": { $ne: null } });
        const records = all.map((r) => ({
            lat: r.lastKnownLocation?.lat,
            lng: r.lastKnownLocation?.lng,
            status: r.status,
            updatedAt: r.updatedAt
        }));

        res.status(200).json(countByRadius(records, lat, lng, radiusKm));
    } catch (error) {
        res.status(500).json({ message: "Failed to compute count", error: error.message });
    }
});

// Official-only: citizens possibly affected — inside the radius and
// either flagged NeedHelp or silent since sinceCutoff. Honest proxy
// for "may be affected", built only from real app/SMS reports — see
// presenceService.js for exactly what this can and can't see.
router.get("/possibly-affected", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const lat = Number(req.query.lat);
        const lng = Number(req.query.lng);
        const radiusKm = Number(req.query.radiusKm) || 5;
        const sinceCutoff = req.query.sinceCutoff || null;

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ message: "lat and lng query params are required" });
        }

        const all = await SafetyStatus.find({ "lastKnownLocation.lat": { $ne: null } }).populate("user", "name");
        const records = all.map((r) => ({
            lat: r.lastKnownLocation?.lat,
            lng: r.lastKnownLocation?.lng,
            status: r.status,
            updatedAt: r.updatedAt,
            name: r.user?.name || r.displayName || r.phone || "Unknown",
            source: r.source
        }));

        const affected = findPossiblyAffected(records, lat, lng, radiusKm, sinceCutoff);
        res.status(200).json({
            count: affected.length,
            data: affected,
            method: "Real app/SMS reports only — not telecom-level tracking. See presenceService.js."
        });
    } catch (error) {
        res.status(500).json({ message: "Failed to compute possibly-affected list", error: error.message });
    }
});

module.exports = router;
