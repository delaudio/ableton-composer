/**
 * Weather context fetcher using Open-Meteo (free, no API key required).
 *
 * Configure via .env:
 *   WEATHER_LAT=45.07
 *   WEATHER_LON=7.69
 *   WEATHER_CITY=Torino   (display only)
 */

// WMO Weather interpretation codes → human-readable
const WMO_CODES = {
  0:  'clear sky',
  1:  'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'depositing rime fog',
  51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
  61: 'slight rain', 63: 'moderate rain', 65: 'heavy rain',
  71: 'slight snow', 73: 'moderate snow', 75: 'heavy snow',
  80: 'slight showers', 81: 'moderate showers', 82: 'violent showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'heavy thunderstorm with hail',
};

/**
 * Fetch current weather for the configured location.
 * @returns {Promise<object>} Weather context object
 */
export async function fetchWeather() {
  const lat = process.env.WEATHER_LAT;
  const lon = process.env.WEATHER_LON;

  if (!lat || !lon) {
    throw new Error('Set WEATHER_LAT and WEATHER_LON in your .env file.');
  }

  const params = new URLSearchParams({
    latitude:  lat,
    longitude: lon,
    current:   [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'pressure_msl',
      'cloud_cover',
      'is_day',
    ].join(','),
    timezone: 'auto',
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Open-Meteo error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const c = data.current;
  const weatherCode = c.weather_code;

  return {
    location:             process.env.WEATHER_CITY || `${lat},${lon}`,
    temperature_c:        c.temperature_2m,
    apparent_temperature: c.apparent_temperature,
    humidity_pct:         c.relative_humidity_2m,
    wind_speed_kmh:       c.wind_speed_10m,
    pressure_hpa:         c.pressure_msl,
    cloud_cover_pct:      c.cloud_cover,
    condition:            WMO_CODES[weatherCode] || `weather code ${weatherCode}`,
    is_day:               c.is_day === 1,
    fetched_at:           new Date().toISOString(),
  };
}
