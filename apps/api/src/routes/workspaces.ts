import { WorkspaceRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sanitizeText } from '../lib/sanitize.js';
import { requireAuth } from '../middleware/auth.js';
import { getWorkspaceRole } from '../modules/permissions.js';

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(80)
});

const createBoardSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(4000).optional()
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/v1/workspaces', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.sub;

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          include: {
            boards: {
              select: {
                id: true,
                title: true,
                updatedAt: true
              },
              orderBy: {
                updatedAt: 'desc'
              }
            }
          }
        }
      },
      orderBy: {
        joinedAt: 'asc'
      }
    });

    return {
      workspaces: memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        role: membership.role,
        boards: membership.workspace.boards
      }))
    };
  });

  app.post('/v1/workspaces', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid payload', issues: parsed.error.issues });
    }

    const name = sanitizeText(parsed.data.name);
    const baseSlug = slugify(name);
    const slug = `${baseSlug}-${Math.floor(Math.random() * 9999)}`;

    const workspace = await prisma.workspace.create({
      data: {
        name,
        slug,
        ownerId: request.user.sub,
        members: {
          create: {
            userId: request.user.sub,
            role: WorkspaceRole.OWNER
          }
        }
      }
    });

    return reply.status(201).send({ workspace });
  });

  app.get('/v1/workspaces/:workspaceId/boards', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid workspaceId' });
    }

    const role = await getWorkspaceRole(request.user.sub, params.data.workspaceId);
    if (!role) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const boards = await prisma.board.findMany({
      where: { workspaceId: params.data.workspaceId },
      orderBy: {
        updatedAt: 'desc'
      },
      select: {
        id: true,
        title: true,
        description: true,
        seq: true,
        updatedAt: true,
        createdAt: true
      }
    });

    return { boards, role };
  });

  app.post('/v1/workspaces/:workspaceId/boards', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1) }).safeParse(request.params);
    const body = createBoardSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Invalid payload' });
    }

    const role = await getWorkspaceRole(request.user.sub, params.data.workspaceId);
    if (!role || role === WorkspaceRole.VIEWER) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const board = await prisma.board.create({
      data: {
        workspaceId: params.data.workspaceId,
        title: sanitizeText(body.data.title),
        description: body.data.description ? sanitizeText(body.data.description) : null,
        createdById: request.user.sub,
        lists: {
          create: [
            { title: 'Todo', order: 0 },
            { title: 'In Progress', order: 1 },
            { title: 'Done', order: 2 }
          ]
        }
      }
    });

    return reply.status(201).send({ board });
  });
}
