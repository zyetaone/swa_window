export function mapWeatherToVisuals(weatherData, sunAltitude) {
    // Rule: cloudCoverage = clamp(weather.cloudsAll / 100, 0.0, 0.95)
    const cloudCoverage = Math.min(Math.max(weatherData.cloudsAll / 100, 0.0), 0.95);
    
    // Rule: turbidity = 1.5 + cloudCoverage * 6.0
    const turbidity = 1.5 + (cloudCoverage * 6.0);
    
    // Rule: mieCoefficient = 0.003 + cloudCoverage * 0.05
    const mieCoefficient = 0.003 + (cloudCoverage * 0.05);
    
    // Rule: cloudSpeed = 0.01 + windSpeed / 50
    const cloudSpeed = 0.01 + (weatherData.windSpeed / 50);
    
    // Rule: rainIntensity
    const rainIntensity = Math.min(Math.max(weatherData.rain1h / 10, 0.0), 1.0);

    // Night Logic
    let sunIntensity = 1.0;
    let starAlpha = 0.0;
    
    if (sunAltitude < 0) {
        sunIntensity = 0.15; // Dim scene
        // alpha = clamp(-sunAltitude / 0.5, 0, 1)
        starAlpha = Math.min(Math.max(-sunAltitude / 0.5, 0.0), 1.0);
    }

    return {
        cloudCoverage,
        turbidity,
        mieCoefficient,
        cloudSpeed,
        rainIntensity,
        sunIntensity,
        starAlpha
    };
}
