import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { corsOrigins, env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { redis, redisPub, redisSub } from './lib/redis.js';
import { registerRealtimeServer } from './realtime/server.js';
import { authRoutes } from './routes/auth.js';
import { boardRoutes } from './routes/boards.js';
import { healthRoutes } from './routes/health.js';
import { notificationRoutes } from './routes/notifications.js';
import { workspaceRoutes } from './routes/workspaces.js';

const app = Fastify({
  logger: env.NODE_ENV === 'production' ? true : { transport: { target: 'pino-pretty' } }
});

await app.register(cors, {
  origin: corsOrigins,
  credentials: true
});

await app.register(helmet);
await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute'
});

await app.register(jwt, {
  secret: env.JWT_SECRET
});

await healthRoutes(app);
await authRoutes(app);
await workspaceRoutes(app);
await boardRoutes(app);
await notificationRoutes(app);

registerRealtimeServer(app);

const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

for (const signal of shutdownSignals) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'Shutting down API');
    await app.close();
    await Promise.allSettled([prisma.$disconnect(), redis.quit(), redisPub.quit(), redisSub.quit()]);
    process.exit(0);
  });
}

try {
  await app.listen({
    host: '0.0.0.0',
    port: env.PORT
  });

  app.log.info(`API running on :${env.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
