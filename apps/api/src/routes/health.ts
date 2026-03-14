import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    const [dbResult, redisResult] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      redis.ping()
    ]);

    return {
      status: dbResult.status === 'fulfilled' && redisResult.status === 'fulfilled' ? 'ok' : 'degraded',
      postgres: dbResult.status === 'fulfilled' ? 'ok' : 'down',
      redis: redisResult.status === 'fulfilled' ? 'ok' : 'down',
      timestamp: new Date().toISOString()
    };
  });
}
