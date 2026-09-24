const express = require("express");
const Incident = require("../models/Incident");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const router = express.Router();


// 1. Create a new incident report
router.post("/", async (req, res) => {
    try {
        const incident = new Incident(req.body);

        const savedIncident = await incident.save();

        res.status(201).json({
            message: "Incident reported successfully",
            incident: savedIncident
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to report incident",
            error: error.message
        });
    }
});


// 2. Get all incidents with optional status filter
router.get("/", protect ,async (req, res) => {
    try {
        const { status } = req.query;

        let filter = {};

        if (status) {
            if (!["Pending", "Verified", "Rejected"].includes(status)) {
                return res.status(400).json({
                    message: "Invalid status. Use Pending, Verified, or Rejected."
                });
            }

            filter.status = status;
        }

        const incidents = await Incident
            .find(filter)
            .sort({ createdAt: -1 });

        res.status(200).json({
            count: incidents.length,
            data: incidents
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch incidents",
            error: error.message
        });
    }
});


// 3. Update incident status
router.put("/:id/status", protect, authorizeRoles("Official"),async (req, res) => {
    try {
        const { status } = req.body;

        if (!["Pending", "Verified", "Rejected"].includes(status)) {
            return res.status(400).json({
                message: "Invalid status"
            });
        }

        const updatedIncident = await Incident.findByIdAndUpdate(
            req.params.id,
            { status: status },
            {
                new: true,
                runValidators: true
            }
        );

        if (!updatedIncident) {
            return res.status(404).json({
                message: "Incident not found"
            });
        }

        res.status(200).json({
            message: "Incident status updated successfully",
            incident: updatedIncident
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to update incident status",
            error: error.message
        });
    }
});


// 4. Official: attach field-verification evidence (photos/videos
// already uploaded via POST /api/upload/evidence) to an incident.
// This is the missing "field official upload path" — officials
// previously had no way to attach their own on-site evidence to a
// report; citizens could only attach evidence at creation time.
router.put("/:id/evidence", protect, authorizeRoles("Official"), async (req, res) => {
    try {
        const { urls } = req.body;

        if (!Array.isArray(urls) || !urls.length) {
            return res.status(400).json({
                message: "urls must be a non-empty array of uploaded evidence URLs"
            });
        }

        const incident = await Incident.findById(req.params.id);

        if (!incident) {
            return res.status(404).json({
                message: "Incident not found"
            });
        }

        incident.evidence = [...(incident.evidence || []), ...urls];
        await incident.save();

        res.status(200).json({
            message: "Field evidence attached",
            incident
        });
    } catch (error) {
        res.status(500).json({
            message: "Failed to attach evidence",
            error: error.message
        });
    }
});


module.exports = router;