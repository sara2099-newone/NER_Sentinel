const express = require("express");
const { calculateDistance } = require("../services/geoService");

const router = express.Router();

// Calculate distance between two locations
router.get("/distance", (req, res) => {
    try {
        const {
            lat1,
            lng1,
            lat2,
            lng2
        } = req.query;

        if (
            lat1 === undefined ||
            lng1 === undefined ||
            lat2 === undefined ||
            lng2 === undefined
        ) {
            return res.status(400).json({
                message: "Four coordinates are required: lat1, lng1, lat2, lng2"
            });
        }

        const latitude1 = parseFloat(lat1);
        const longitude1 = parseFloat(lng1);
        const latitude2 = parseFloat(lat2);
        const longitude2 = parseFloat(lng2);

        if (
            [latitude1, longitude1, latitude2, longitude2].some(
                Number.isNaN
            )
        ) {
            return res.status(400).json({
                message: "All coordinates must be valid numbers"
            });
        }

        if (
            latitude1 < -90 ||
            latitude1 > 90 ||
            latitude2 < -90 ||
            latitude2 > 90 ||
            longitude1 < -180 ||
            longitude1 > 180 ||
            longitude2 < -180 ||
            longitude2 > 180
        ) {
            return res.status(400).json({
                message: "Invalid latitude or longitude"
            });
        }

        const distance = calculateDistance(
            latitude1,
            longitude1,
            latitude2,
            longitude2
        );

        res.status(200).json({
            message: "Distance calculated successfully",
            data: {
                from: {
                    latitude: latitude1,
                    longitude: longitude1
                },
                to: {
                    latitude: latitude2,
                    longitude: longitude2
                },
                distanceKm: distance
            }
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to calculate distance",
            error: error.message
        });
    }
});

module.exports = router;