const express = require("express");
const getRainfallData = require("../services/rainfallService");

const router = express.Router();


// Get rainfall data for a location
router.get("/", async (req, res) => {
    try {
        const { lat, lng } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({
                message: "Latitude and longitude are required"
            });
        }

        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        if (
            Number.isNaN(latitude) ||
            Number.isNaN(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ) {
            return res.status(400).json({
                message: "Invalid latitude or longitude"
            });
        }

        const rainfallData = await getRainfallData(
            latitude,
            longitude
        );

        res.status(200).json({
            message: "Rainfall data fetched successfully",
            data: rainfallData
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch rainfall data",
            error: error.message
        });
    }
});

module.exports = router;