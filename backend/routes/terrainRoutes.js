const express = require("express");
const getTerrainData = require("../services/terrainService");

const router = express.Router();

// Get terrain/elevation data
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

        const terrainData = await getTerrainData(
            latitude,
            longitude
        );

        res.status(200).json({
            message: "Terrain data fetched successfully",
            data: terrainData
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch terrain data",
            error: error.message
        });
    }
});

module.exports = router;