const express = require("express");
const aiService = require("../services/aiService");

const router = express.Router();

// Proxy: AI service health check (used by dashboards/monitoring to
// confirm the model is loaded before relying on predictions).
router.get("/health", async (req, res) => {
    try {
        const { status, data } = await aiService.checkHealth();
        res.status(status).json(data);
    } catch (error) {
        res.status(503).json({
            message: "AI service unreachable",
            error: error.message
        });
    }
});

// Proxy: AI model metadata (type, accuracy, features, classes).
router.get("/model-info", async (req, res) => {
    try {
        const { status, data } = await aiService.getModelInfo();
        res.status(status).json(data);
    } catch (error) {
        res.status(503).json({
            message: "AI service unreachable",
            error: error.message
        });
    }
});

// Proxy: landslide risk prediction. The request body is forwarded to
// the AI service exactly as received — all 11 fields defined in
// ai/docs/AI_INTEGRATION_CONTRACT.md are the caller's responsibility.
// The AI service's response (risk_score, risk_level, confidence,
// class_probabilities, contributing_factors, explanation_method,
// model_version) is returned unmodified, including its own 422s for
// invalid/out-of-range input (e.g. elevation_m, temperature_c).
router.post("/predict", async (req, res) => {
    try {
        const { status, data } = await aiService.getPrediction(req.body);
        res.status(status).json(data);
    } catch (error) {
        res.status(503).json({
            message: "AI service unreachable",
            error: error.message
        });
    }
});

module.exports = router;
