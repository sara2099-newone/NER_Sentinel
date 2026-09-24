// AI Prediction Service client (Member 3's FastAPI microservice).
// Pure HTTP pass-through — no prediction logic lives here, and no
// request/response fields are transformed. This module only knows how
// to reach the service; base URL is configurable via AI_SERVICE_URL so
// it can point at a different host/port in staging or production
// without any code change.

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8002";

const checkHealth = async () => {
    const response = await fetch(`${AI_SERVICE_URL}/health`);
    const data = await response.json();
    return { status: response.status, data };
};

const getModelInfo = async () => {
    const response = await fetch(`${AI_SERVICE_URL}/model-info`);
    const data = await response.json();
    return { status: response.status, data };
};

// inputFields must match the AI service's 11-field contract exactly
// (see ai/docs/AI_INTEGRATION_CONTRACT.md). Forwarded as-is.
const getPrediction = async (inputFields) => {
    const response = await fetch(`${AI_SERVICE_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputFields)
    });

    const data = await response.json();
    return { status: response.status, data };
};

module.exports = {
    AI_SERVICE_URL,
    checkHealth,
    getModelInfo,
    getPrediction
};
