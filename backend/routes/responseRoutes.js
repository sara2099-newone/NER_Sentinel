// Official response-workflow API.
//
// The same service is used by the zero-install demo server. These routes make
// the workflow available when running the full Express/Mongo backend as well.
// The roster and department dispatch simulation remain deliberately DEMO only;
// responseService documents that distinction and never sends external alerts.

const express = require("express");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { DEPARTMENTS } = require("../config/departments");
const responseService = require("../services/responseService");

const router = express.Router();
router.use(protect, authorizeRoles("Official"));

router.get("/departments", (req, res) => res.status(200).json({ data: DEPARTMENTS }));
router.get("/teams", (req, res) => res.status(200).json({ data: responseService.listTeams(req.query.zoneId || undefined) }));
router.get("/incidents", (req, res) => res.status(200).json({ data: responseService.listIncidents() }));
router.get("/incidents/:id", (req, res) => {
    const incident = responseService.getIncident(req.params.id);
    if (!incident) return res.status(404).json({ message: "incident not found" });
    res.status(200).json({ data: incident });
});

router.post("/trigger-critical-risk", (req, res) => {
    try {
        const data = responseService.triggerCriticalRisk(req.body.zoneId);
        res.status(200).json({ message: `Critical risk simulated for ${data.zoneName} (DEMO/SIMULATED)`, data });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

router.post("/trigger-landslide", (req, res) => {
    try {
        const incident = responseService.triggerLandslide(req.body.zoneId);
        res.status(201).json({ message: `Landslide incident created for ${incident.zoneName} — department alerts dispatched (DEMO DISPATCH)`, data: incident });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

router.put("/incidents/:id/alerts/:alertId", (req, res) => {
    try {
        const data = responseService.updateAlertStatus(req.params.id, req.params.alertId, req.body.status);
        res.status(200).json({ message: "Department alert status updated", data });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

router.post("/teams/:teamId/dispatch", async (req, res) => {
    try {
        const data = await responseService.dispatchTeam(req.params.teamId, req.body.incidentId);
        res.status(200).json({ message: `${data.name} dispatched (DEMO)`, data });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

router.put("/teams/:teamId/status", (req, res) => {
    try {
        const data = responseService.updateTeamStatus(req.params.teamId, req.body.status);
        res.status(200).json({ message: `Team status updated to ${data.statusLabel}`, data });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

router.post("/incidents/:id/complete", (req, res) => {
    try {
        const data = responseService.completeIncident(req.params.id);
        res.status(200).json({ message: "Incident marked resolved — all department alerts and teams closed out", data });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

module.exports = router;
