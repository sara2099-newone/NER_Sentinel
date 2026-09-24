const getWeatherData = async (latitude, longitude) => {
    try {
        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${latitude}` +
            `&longitude=${longitude}` +
            `&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m` +
            `&hourly=precipitation,rain,soil_moisture_0_to_7cm` +
            `&timezone=auto`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Weather API error: ${response.status}`);
        }

        const data = await response.json();

        return data;

    } catch (error) {
        console.error("Weather API failed:", error.message);
        throw error;
    }
};

module.exports = getWeatherData;