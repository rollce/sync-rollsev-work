import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/v1/notifications', { preHandler: requireAuth }, async (request) => {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: request.user.sub
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50
    });

    return { notifications };
  });

  app.post('/v1/notifications/:notificationId/read', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ notificationId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid notificationId' });
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id: params.data.notificationId,
        userId: request.user.sub
      }
    });

    if (!notification) {
      return reply.status(404).send({ error: 'Not found' });
    }

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        isRead: true
      }
    });

    return { success: true };
  });
}
