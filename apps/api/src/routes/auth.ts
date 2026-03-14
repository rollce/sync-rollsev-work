import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { sanitizeText } from '../lib/sanitize.js';
import { requireAuth } from '../middleware/auth.js';

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(128)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid payload', issues: parsed.error.issues });
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        name: sanitizeText(parsed.data.name),
        passwordHash
      }
    });

    const token = await signAccessToken(app, { sub: user.id, email: user.email, name: user.name });

    return reply.status(201).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  });

  app.post('/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid payload', issues: parsed.error.issues });
    }

    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = await signAccessToken(app, { sub: user.id, email: user.email, name: user.name });

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  });

  app.get('/v1/auth/me', { preHandler: requireAuth }, async (request) => {
    return {
      user: request.user
    };
  });
}
