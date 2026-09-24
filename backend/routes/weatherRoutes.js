const express = require("express");
const getWeatherData = require("../services/weatherService");
const WeatherData = require("../models/WeatherData");

const router = express.Router();

// Get current weather data from Open-Meteo
router.get("/", async (req, res) => {
    try {
        const { lat, lng } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({
                message: "Latitude and longitude are required"
            });
        }

        const weatherData = await getWeatherData(lat, lng);

        res.status(200).json({
            message: "Weather data fetched successfully",
            data: weatherData
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch weather data",
            error: error.message
        });
    }
});


// Get weather history from MongoDB
router.get("/history", async (req, res) => {
    try {
        const weatherHistory = await WeatherData
            .find()
            .sort({ createdAt: -1 })
            .limit(100);

        res.status(200).json({
            message: "Weather history fetched successfully",
            count: weatherHistory.length,
            data: weatherHistory
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch weather history",
            error: error.message
        });
    }
});


// Test route
router.get("/test", (req, res) => {
    res.status(200).json({
        message: "Weather routes are working"
    });
});


module.exports = router;