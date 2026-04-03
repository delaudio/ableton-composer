/**
 * Aggregate fetcher — collects all available context data.
 * Add new fetchers here as the project grows.
 */

import { fetchWeather } from './weather.js';

/**
 * Fetch context based on which sources are requested.
 * @param {object} opts
 * @param {boolean} [opts.weather]
 * @returns {Promise<object>} Combined context object
 */
export async function fetchContext({ weather = false } = {}) {
  const context = {};

  if (weather) {
    try {
      context.weather = await fetchWeather();
    } catch (err) {
      console.warn(`⚠ Weather fetch failed: ${err.message}`);
    }
  }

  // Add more fetchers here:
  // if (opts.finance) context.finance = await fetchFinance();
  // if (opts.health)  context.health  = await fetchHealth();

  return context;
}
