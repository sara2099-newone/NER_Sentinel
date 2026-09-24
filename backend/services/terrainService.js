const getTerrainData = async (latitude, longitude) => {
    try {
        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${latitude}` +
            `&longitude=${longitude}` +
            `&current=temperature_2m` +
            `&timezone=auto`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Terrain API error: ${response.status}`);
        }

        const data = await response.json();

        return {
            latitude: data.latitude,
            longitude: data.longitude,
            elevation: data.elevation
        };

    } catch (error) {
        console.error("Terrain API failed:", error.message);
        throw error;
    }
};

module.exports = getTerrainData;