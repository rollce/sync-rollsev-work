import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sanitizeText } from '../lib/sanitize.js';
import { requireAuth } from '../middleware/auth.js';
import { buildBoardState, createBoardSnapshot } from '../modules/board-state.js';
import { canEdit, getBoardAccess } from '../modules/permissions.js';

const paramsSchema = z.object({
  boardId: z.string().min(1)
});

const createListSchema = z.object({
  title: z.string().trim().min(2).max(120)
});

const createCardSchema = z.object({
  listId: z.string().min(1),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4000).optional()
});

const restoreSchema = z.object({
  snapshotId: z.string().min(1)
});

export async function boardRoutes(app: FastifyInstance) {
  app.get('/v1/boards/:boardId', { preHandler: requireAuth }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid boardId' });
    }

    const access = await getBoardAccess(request.user.sub, params.data.boardId);
    if (!access) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const state = await buildBoardState(params.data.boardId);
    if (!state) {
      return reply.status(404).send({ error: 'Board not found' });
    }

    return {
      role: access.role,
      state
    };
  });

  app.post('/v1/boards/:boardId/lists', { preHandler: requireAuth }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = createListSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Invalid payload' });
    }

    const access = await getBoardAccess(request.user.sub, params.data.boardId);
    if (!access || !canEdit(access.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const maxOrder = await prisma.boardList.aggregate({
      where: { boardId: params.data.boardId },
      _max: { order: true }
    });

    const list = await prisma.boardList.create({
      data: {
        boardId: params.data.boardId,
        title: sanitizeText(body.data.title),
        order: (maxOrder._max.order ?? -1) + 1
      }
    });

    return reply.status(201).send({ list });
  });

  app.post('/v1/boards/:boardId/cards', { preHandler: requireAuth }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = createCardSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Invalid payload' });
    }

    const access = await getBoardAccess(request.user.sub, params.data.boardId);
    if (!access || !canEdit(access.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const list = await prisma.boardList.findFirst({
      where: {
        id: body.data.listId,
        boardId: params.data.boardId
      }
    });

    if (!list) {
      return reply.status(404).send({ error: 'List not found' });
    }

    const maxOrder = await prisma.boardCard.aggregate({
      where: {
        boardId: params.data.boardId,
        listId: body.data.listId
      },
      _max: { order: true }
    });

    const card = await prisma.boardCard.create({
      data: {
        boardId: params.data.boardId,
        listId: body.data.listId,
        title: sanitizeText(body.data.title),
        description: body.data.description ? sanitizeText(body.data.description) : null,
        order: (maxOrder._max.order ?? -1) + 1,
        lastEditedBy: request.user.sub
      }
    });

    return reply.status(201).send({ card });
  });

  app.get('/v1/boards/:boardId/history', { preHandler: requireAuth }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const query = z.object({ limit: z.coerce.number().int().positive().max(100).default(20) }).safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.status(400).send({ error: 'Invalid request' });
    }

    const access = await getBoardAccess(request.user.sub, params.data.boardId);
    if (!access) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const [snapshots, activity] = await Promise.all([
      prisma.boardSnapshot.findMany({
        where: { boardId: params.data.boardId },
        orderBy: {
          seq: 'desc'
        },
        take: query.data.limit,
        select: {
          id: true,
          seq: true,
          createdAt: true
        }
      }),
      prisma.activityEvent.findMany({
        where: { boardId: params.data.boardId },
        include: {
          actor: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          seq: 'desc'
        },
        take: query.data.limit
      })
    ]);

    return { snapshots, activity };
  });

  app.post('/v1/boards/:boardId/snapshot', { preHandler: requireAuth }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid boardId' });
    }

    const access = await getBoardAccess(request.user.sub, params.data.boardId);
    if (!access || !canEdit(access.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const board = await prisma.board.findUnique({
      where: { id: params.data.boardId },
      select: { seq: true }
    });

    if (!board) {
      return reply.status(404).send({ error: 'Board not found' });
    }

    const snapshot = await createBoardSnapshot(params.data.boardId, board.seq);
    return reply.status(201).send({ snapshot });
  });

  app.post('/v1/boards/:boardId/restore/:snapshotId', { preHandler: requireAuth }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const restore = restoreSchema.safeParse(request.params);

    if (!params.success || !restore.success) {
      return reply.status(400).send({ error: 'Invalid params' });
    }

    const access = await getBoardAccess(request.user.sub, params.data.boardId);
    if (!access || !canEdit(access.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const snapshot = await prisma.boardSnapshot.findFirst({
      where: {
        id: restore.data.snapshotId,
        boardId: params.data.boardId
      }
    });

    if (!snapshot) {
      return reply.status(404).send({ error: 'Snapshot not found' });
    }

    const state = snapshot.state as {
      lists: Array<{ id: string; title: string; order: number }>;
      cards: Array<{ id: string; listId: string; title: string; description?: string | null; order: number; lastEditedBy: string }>;
      comments: Array<{ id: string; cardId: string; content: string; userId: string; mentions?: unknown; createdAt: string }>;
    };

    await prisma.$transaction(async (tx) => {
      await tx.comment.deleteMany({ where: { boardId: params.data.boardId } });
      await tx.boardCard.deleteMany({ where: { boardId: params.data.boardId } });
      await tx.boardList.deleteMany({ where: { boardId: params.data.boardId } });

      for (const list of state.lists) {
        await tx.boardList.create({
          data: {
            id: list.id,
            boardId: params.data.boardId,
            title: list.title,
            order: list.order
          }
        });
      }

      for (const card of state.cards) {
        await tx.boardCard.create({
          data: {
            id: card.id,
            boardId: params.data.boardId,
            listId: card.listId,
            title: card.title,
            description: card.description ?? null,
            order: card.order,
            lastEditedBy: card.lastEditedBy
          }
        });
      }

      for (const comment of state.comments) {
        await tx.comment.create({
          data: {
            id: comment.id,
            boardId: params.data.boardId,
            cardId: comment.cardId,
            userId: comment.userId,
            content: comment.content,
            mentions: comment.mentions ?? undefined,
            createdAt: new Date(comment.createdAt)
          }
        });
      }

      const board = await tx.board.update({
        where: { id: params.data.boardId },
        data: {
          seq: {
            increment: 1
          }
        },
        select: {
          seq: true,
          workspaceId: true
        }
      });

      await tx.activityEvent.create({
        data: {
          workspaceId: board.workspaceId,
          boardId: params.data.boardId,
          actorId: request.user.sub,
          eventType: 'SNAPSHOT_RESTORED',
          seq: board.seq,
          payload: {
            snapshotId: snapshot.id,
            restoredFromSeq: snapshot.seq
          }
        }
      });
    });

    return { success: true };
  });
}
