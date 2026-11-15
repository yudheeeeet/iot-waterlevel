import type { FastifyPluginAsync } from 'fastify';
import type { WeatherService } from './service.js';

/** GET /api/weather — every logged-in user. Shape = src/services/weather/weatherService.js (direct mode). */
export const weatherRoutes =
  (service: WeatherService): FastifyPluginAsync =>
  async (app) => {
    app.get('/weather', async () => service.get());
  };
