const getSlopeData = async (latitude, longitude) => {
    try {
        // Create 4 nearby points around the requested location
        const offset = 0.001;

        const locations = [
            `${latitude},${longitude}`,
            `${latitude + offset},${longitude}`,
            `${latitude - offset},${longitude}`,
            `${latitude},${longitude + offset}`,
            `${latitude},${longitude - offset}`
        ];

        const url =
            `https://api.opentopodata.org/v1/aster30m?locations=${locations.join("|")}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Elevation API error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.results || data.results.length !== 5) {
            throw new Error("Incomplete elevation data received");
        }

        const centerElevation = data.results[0].elevation;
        const northElevation = data.results[1].elevation;
        const southElevation = data.results[2].elevation;
        const eastElevation = data.results[3].elevation;
        const westElevation = data.results[4].elevation;

        if (
            centerElevation === null ||
            northElevation === null ||
            southElevation === null ||
            eastElevation === null ||
            westElevation === null
        ) {
            throw new Error("Elevation data unavailable");
        }

        // Approximate distance represented by 0.001 degrees
        const horizontalDistance = 111;

        const northSouthSlope =
            (northElevation - southElevation) /
            (2 * horizontalDistance);

        const eastWestSlope =
            (eastElevation - westElevation) /
            (2 * horizontalDistance);

        const slopePercent =
            Math.sqrt(
                Math.pow(northSouthSlope, 2) +
                Math.pow(eastWestSlope, 2)
            ) * 100;

        const slopeDegrees =
            Math.atan(slopePercent / 100) *
            (180 / Math.PI);

        return {
            latitude,
            longitude,
            elevation: centerElevation,
            slopePercent: Number(slopePercent.toFixed(2)),
            slopeDegrees: Number(slopeDegrees.toFixed(2))
        };

    } catch (error) {
        console.error("Slope API failed:", error.message);
        throw error;
    }
};

module.exports = getSlopeData;