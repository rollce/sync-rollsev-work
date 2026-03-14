import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  SNAPSHOT_EVERY: z.coerce.number().int().positive().default(20),
  SOCKET_PING_INTERVAL_MS: z.coerce.number().int().positive().default(20000),
  SOCKET_PING_TIMEOUT_MS: z.coerce.number().int().positive().default(15000)
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
