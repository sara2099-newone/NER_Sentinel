const mongoose = require("mongoose");

const weatherDataSchema = new mongoose.Schema(
    {
        location: {
            lat: {
                type: Number,
                required: true
            },
            lng: {
                type: Number,
                required: true
            }
        },

        temperature: Number,
        humidity: Number,
        rainfall: Number,
        precipitation: Number,
        windSpeed: Number,
        soilMoisture: Number,

        weatherCode: Number,

        // Real observed risk score/level at the moment this snapshot was
        // taken (computed the same way the dashboard does — AI model +
        // rule thresholds). Populated by scheduler/weatherScheduler.js;
        // this is what backs the risk-trend chart in the frontend,
        // replacing what would otherwise be a fake hardcoded trend line.
        riskScore: { type: Number, default: null },
        riskLevel: { type: String, default: null }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("WeatherData", weatherDataSchema);