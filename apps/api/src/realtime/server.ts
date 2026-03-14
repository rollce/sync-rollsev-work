import { Prisma, WorkspaceRole } from '@prisma/client';
import {
  PROTOCOL_VERSION,
  addCommentPayloadSchema,
  clientEventSchema,
  createCardPayloadSchema,
  cursorPayloadSchema,
  moveCardPayloadSchema,
  typingPayloadSchema,
  updateCardPayloadSchema
} from '@sync/shared';
import { FastifyInstance } from 'fastify';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { env, corsOrigins } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { redis, redisPub, redisSub } from '../lib/redis.js';
import { sanitizeRichText, sanitizeText } from '../lib/sanitize.js';
import { buildBoardState, createBoardSnapshot } from '../modules/board-state.js';
import { extractMentions } from '../modules/mentions.js';
import { canEdit, getBoardAccess } from '../modules/permissions.js';

type SocketUser = {
  id: string;
  email: string;
  name: string;
};

type BoardPresence = {
  userId: string;
  name: string;
  cursor?: { x: number; y: number; viewport?: string };
  typing?: { cardId?: string; active: boolean };
  lastSeenAt: string;
};

type SocketData = {
  user: SocketUser;
  sessionId: string;
  joinedBoards: Set<string>;
  lastPongAt: number;
};

type MutationHandlerResult = {
  seq: number;
  eventPayload: unknown;
  eventType: 'CARD_CREATED' | 'CARD_UPDATED' | 'CARD_MOVED' | 'COMMENT_ADDED';
  workspaceId: string;
};

const SOCKET_EVENT = 'client_event';
const SERVER_EVENT = 'server_event';

const RATE_LIMITS: Record<string, number> = {
  CURSOR_MOVED: 20,
  TYPING_STATUS: 8,
  CARD_CREATED: 10,
  CARD_UPDATED: 12,
  CARD_MOVED: 12,
  COMMENT_ADDED: 8,
  REQUEST_SNAPSHOT: 4
};

const socketRateBucket = new Map<string, { ts: number; counters: Record<string, number> }>();

function nowIso() {
  return new Date().toISOString();
}

function getBucket(socketId: string) {
  const ts = Math.floor(Date.now() / 1000);
  const existing = socketRateBucket.get(socketId);
  if (!existing || existing.ts !== ts) {
    const fresh: { ts: number; counters: Record<string, number> } = { ts, counters: {} };
    socketRateBucket.set(socketId, fresh);
    return fresh;
  }

  return existing;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hitRateLimit(socketId: string, eventType: string): boolean {
  const limit = RATE_LIMITS[eventType] ?? 15;
  const bucket = getBucket(socketId);
  bucket.counters[eventType] = (bucket.counters[eventType] ?? 0) + 1;
  return bucket.counters[eventType] > limit;
}

async function markMutation(boardId: string, mutationId: string): Promise<boolean> {
  const key = `mutation:${boardId}:${mutationId}`;
  const marked = await redis.set(key, '1', 'EX', 60 * 60 * 24, 'NX');
  return marked === 'OK';
}

async function emitRoomUsers(io: Server, boardId: string) {
  const sessions = await prisma.presenceSession.findMany({
    where: { boardId },
    include: {
      user: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      lastSeenAt: 'desc'
    }
  });

  const unique = new Map<string, BoardPresence>();
  for (const session of sessions) {
    if (unique.has(session.user.id)) {
      continue;
    }

    unique.set(session.user.id, {
      userId: session.user.id,
      name: session.user.name,
      cursor: session.cursorX !== null && session.cursorY !== null
        ? {
            x: session.cursorX,
            y: session.cursorY,
            viewport: session.viewport ?? undefined
          }
        : undefined,
      typing: session.typingActive
        ? {
            cardId: session.typingCardId ?? undefined,
            active: session.typingActive
          }
        : undefined,
      lastSeenAt: session.lastSeenAt.toISOString()
    });
  }

  io.to(boardId).emit(SERVER_EVENT, {
    type: 'ROOM_USERS',
    boardId,
    activeUsers: Array.from(unique.values())
  });
}

async function authSocket(app: FastifyInstance, socket: Socket): Promise<SocketUser | null> {
  try {
    const tokenFromHandshake =
      typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : typeof socket.handshake.headers.authorization === 'string'
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
          : null;

    if (!tokenFromHandshake) {
      return null;
    }

    const payload = await app.jwt.verify<SocketUser & { sub?: string }>(tokenFromHandshake);
    const userId = payload.sub ?? payload.id;

    if (!userId || !payload.email || !payload.name) {
      return null;
    }

    return {
      id: userId,
      email: payload.email,
      name: payload.name
    };
  } catch {
    return null;
  }
}

async function sendSyncState(socket: Socket, boardId: string) {
  const state = await buildBoardState(boardId);
  if (!state) {
    socket.emit(SERVER_EVENT, {
      type: 'ERROR',
      code: 'BOARD_NOT_FOUND',
      message: 'Board not found',
      recoverable: false
    });
    return;
  }

  socket.emit(SERVER_EVENT, {
    type: 'SYNC_STATE',
    boardId,
    seq: state.board.seq,
    snapshot: state
  });
}

async function createMentionNotifications(tx: Prisma.TransactionClient, params: {
  workspaceId: string;
  boardId: string;
  actorId: string;
  commentId: string;
  mentions: string[];
}) {
  if (params.mentions.length === 0) {
    return;
  }

  const users = await tx.user.findMany({
    where: {
      email: {
        in: params.mentions.map((mention) => `${mention}@rollsev.work`)
      }
    },
    select: {
      id: true
    }
  });

  const mentionUserIds = users.map((user) => user.id).filter((id) => id !== params.actorId);

  if (mentionUserIds.length === 0) {
    return;
  }

  await tx.notification.createMany({
    data: mentionUserIds.map((userId) => ({
      userId,
      workspaceId: params.workspaceId,
      boardId: params.boardId,
      commentId: params.commentId,
      type: 'MENTION',
      metadata: {
        actorId: params.actorId
      }
    })),
    skipDuplicates: true
  });
}

async function applyMutation(params: {
  boardId: string;
  userId: string;
  mutationId: string;
  eventType: MutationHandlerResult['eventType'];
  mutate: (tx: Prisma.TransactionClient, seq: number) => Promise<unknown>;
}): Promise<{ status: 'APPLIED' | 'DUPLICATE'; result?: MutationHandlerResult; seq: number }> {
  const firstSeen = await markMutation(params.boardId, params.mutationId);

  if (!firstSeen) {
    const board = await prisma.board.findUnique({
      where: { id: params.boardId },
      select: { seq: true }
    });

    return {
      status: 'DUPLICATE',
      seq: board?.seq ?? 0
    };
  }

  const mutationResult = await prisma.$transaction(async (tx) => {
    const board = await tx.board.update({
      where: { id: params.boardId },
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

    const eventPayload = await params.mutate(tx, board.seq);

    await tx.activityEvent.create({
      data: {
        workspaceId: board.workspaceId,
        boardId: params.boardId,
        actorId: params.userId,
        eventType: params.eventType,
        seq: board.seq,
        payload: toJsonValue(eventPayload)
      }
    });

    return {
      seq: board.seq,
      workspaceId: board.workspaceId,
      eventPayload
    };
  });

  if (mutationResult.seq % env.SNAPSHOT_EVERY === 0) {
    await createBoardSnapshot(params.boardId, mutationResult.seq);
  }

  return {
    status: 'APPLIED',
    seq: mutationResult.seq,
    result: {
      seq: mutationResult.seq,
      workspaceId: mutationResult.workspaceId,
      eventPayload: mutationResult.eventPayload,
      eventType: params.eventType
    }
  };
}

export function registerRealtimeServer(app: FastifyInstance): Server {
  const io = new Server(app.server, {
    path: '/ws',
    cors: {
      origin: corsOrigins,
      credentials: true
    },
    pingInterval: env.SOCKET_PING_INTERVAL_MS,
    pingTimeout: env.SOCKET_PING_TIMEOUT_MS
  });

  io.adapter(createAdapter(redisPub, redisSub));

  io.use(async (socket, next) => {
    const user = await authSocket(app, socket);

    if (!user) {
      return next(new Error('Unauthorized socket')); 
    }

    const sessionId =
      typeof socket.handshake.auth?.sessionId === 'string' && socket.handshake.auth.sessionId.length > 4
        ? socket.handshake.auth.sessionId
        : randomUUID();

    socket.data = {
      user,
      sessionId,
      joinedBoards: new Set<string>(),
      lastPongAt: Date.now()
    } satisfies SocketData;

    await redis.hset(`reconnect:${user.id}`, sessionId, String(Date.now()));
    await redis.expire(`reconnect:${user.id}`, 60 * 60 * 24 * 7);

    next();
  });

  const heartbeatTicker = setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      const data = socket.data as SocketData;
      if (!data) {
        continue;
      }

      if (Date.now() - data.lastPongAt > env.SOCKET_PING_INTERVAL_MS + env.SOCKET_PING_TIMEOUT_MS) {
        socket.emit(SERVER_EVENT, {
          type: 'ERROR',
          code: 'PING_TIMEOUT',
          message: 'Heartbeat timeout',
          recoverable: true
        });
        socket.disconnect(true);
        continue;
      }

      socket.emit(SERVER_EVENT, {
        type: 'PING',
        at: nowIso()
      });
    }
  }, env.SOCKET_PING_INTERVAL_MS);

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    logger.info({ userId: data.user.id, socketId: socket.id }, 'Socket connected');

    socket.emit(SERVER_EVENT, {
      type: 'MUTATION_ACK',
      boardId: 'system',
      mutationId: randomUUID(),
      seq: 0,
      status: 'APPLIED',
      reason: `session:${data.sessionId};protocol:${PROTOCOL_VERSION}`
    });

    socket.on(SOCKET_EVENT, async (raw, callback?: (response: unknown) => void) => {
      const parsed = clientEventSchema.safeParse(raw);
      if (!parsed.success) {
        socket.emit(SERVER_EVENT, {
          type: 'ERROR',
          code: 'INVALID_EVENT',
          message: 'Invalid client event payload',
          recoverable: true
        });
        return;
      }

      const event = parsed.data;

      if (hitRateLimit(socket.id, event.type)) {
        socket.emit(SERVER_EVENT, {
          type: 'ERROR',
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded for ${event.type}`,
          recoverable: true
        });
        return;
      }

      try {
        if (event.type === 'PONG') {
          data.lastPongAt = Date.now();
          return;
        }

        if (event.type === 'JOIN_BOARD') {
          const access = await getBoardAccess(data.user.id, event.boardId);
          if (!access) {
            socket.emit(SERVER_EVENT, {
              type: 'ERROR',
              code: 'FORBIDDEN_ROOM_JOIN',
              message: 'You are not a member of this board workspace',
              recoverable: false
            });
            return;
          }

          data.joinedBoards.add(event.boardId);
          socket.join(event.boardId);

          await prisma.presenceSession.upsert({
            where: {
              boardId_userId_socketId: {
                boardId: event.boardId,
                userId: data.user.id,
                socketId: socket.id
              }
            },
            update: {
              lastSeenAt: new Date(),
              typingActive: false,
              typingCardId: null
            },
            create: {
              boardId: event.boardId,
              userId: data.user.id,
              socketId: socket.id,
              typingActive: false
            }
          });

          const board = await prisma.board.findUnique({
            where: { id: event.boardId },
            select: { seq: true }
          });

          if (!board) {
            socket.emit(SERVER_EVENT, {
              type: 'ERROR',
              code: 'BOARD_NOT_FOUND',
              message: 'Board not found',
              recoverable: false
            });
            return;
          }

          if (event.lastServerSeq < board.seq) {
            await sendSyncState(socket, event.boardId);
          }

          io.to(event.boardId).emit(SERVER_EVENT, {
            type: 'LIVE_EVENT',
            boardId: event.boardId,
            seq: 0,
            eventType: 'USER_JOINED',
            actorId: data.user.id,
            at: nowIso(),
            payload: {
              userId: data.user.id,
              name: data.user.name
            }
          });

          await emitRoomUsers(io, event.boardId);

          callback?.({ ok: true });
          return;
        }

        if (event.type === 'LEAVE_BOARD') {
          data.joinedBoards.delete(event.boardId);
          socket.leave(event.boardId);

          await prisma.presenceSession.deleteMany({
            where: {
              boardId: event.boardId,
              socketId: socket.id
            }
          });

          const board = await prisma.board.findUnique({
            where: { id: event.boardId },
            select: { seq: true }
          });

          io.to(event.boardId).emit(SERVER_EVENT, {
            type: 'LIVE_EVENT',
            boardId: event.boardId,
            seq: 0,
            eventType: 'USER_LEFT',
            actorId: data.user.id,
            at: nowIso(),
            payload: {
              userId: data.user.id,
              name: data.user.name
            }
          });

          await emitRoomUsers(io, event.boardId);
          callback?.({ ok: true });
          return;
        }

        const access = await getBoardAccess(data.user.id, event.boardId);
        if (!access) {
          socket.emit(SERVER_EVENT, {
            type: 'ERROR',
            code: 'FORBIDDEN',
            message: 'No board access',
            recoverable: false
          });
          return;
        }

        if (!data.joinedBoards.has(event.boardId) && event.type !== 'REQUEST_SNAPSHOT') {
          socket.emit(SERVER_EVENT, {
            type: 'ERROR',
            code: 'NOT_IN_ROOM',
            message: 'Join board room first',
            recoverable: true
          });
          return;
        }

        if (event.type === 'CURSOR_MOVED') {
          const payload = cursorPayloadSchema.parse(event.payload);

          await prisma.presenceSession.updateMany({
            where: {
              boardId: event.boardId,
              socketId: socket.id
            },
            data: {
              cursorX: payload.x,
              cursorY: payload.y,
              viewport: payload.viewport,
              lastSeenAt: new Date()
            }
          });

          socket.to(event.boardId).emit(SERVER_EVENT, {
            type: 'LIVE_EVENT',
            boardId: event.boardId,
            seq: 0,
            eventType: 'CURSOR_MOVED',
            actorId: data.user.id,
            at: nowIso(),
            payload
          });
          return;
        }

        if (event.type === 'TYPING_STATUS') {
          const payload = typingPayloadSchema.parse(event.payload);

          await prisma.presenceSession.updateMany({
            where: {
              boardId: event.boardId,
              socketId: socket.id
            },
            data: {
              typingActive: payload.active,
              typingCardId: payload.cardId ?? null,
              lastSeenAt: new Date()
            }
          });

          socket.to(event.boardId).emit(SERVER_EVENT, {
            type: 'LIVE_EVENT',
            boardId: event.boardId,
            seq: 0,
            eventType: 'TYPING_STATUS',
            actorId: data.user.id,
            at: nowIso(),
            payload
          });

          await emitRoomUsers(io, event.boardId);
          return;
        }

        if (event.type === 'REQUEST_SNAPSHOT') {
          await sendSyncState(socket, event.boardId);
          return;
        }

        if (!canEdit(access.role)) {
          socket.emit(SERVER_EVENT, {
            type: 'ERROR',
            code: 'READ_ONLY',
            message: 'You do not have edit permission on this board',
            recoverable: false
          });
          return;
        }

        if (event.type === 'CARD_CREATED') {
          const payload = createCardPayloadSchema.parse(event.payload);

          const mutation = await applyMutation({
            boardId: event.boardId,
            userId: data.user.id,
            mutationId: event.mutationId,
            eventType: 'CARD_CREATED',
            mutate: async (tx, seq) => {
              const list = await tx.boardList.findFirst({
                where: {
                  id: payload.listId,
                  boardId: event.boardId
                },
                select: {
                  id: true
                }
              });

              if (!list) {
                throw new Error('LIST_NOT_FOUND');
              }

              const maxOrder = await tx.boardCard.aggregate({
                where: {
                  boardId: event.boardId,
                  listId: payload.listId
                },
                _max: { order: true }
              });

              const card = await tx.boardCard.create({
                data: {
                  boardId: event.boardId,
                  listId: payload.listId,
                  title: sanitizeText(payload.title),
                  description: payload.description ? sanitizeRichText(payload.description) : null,
                  order: (maxOrder._max.order ?? -1) + 1,
                  lastEditedBy: data.user.id
                }
              });

              return {
                seq,
                mutationId: event.mutationId,
                card: {
                  ...card,
                  lastEditedAt: card.lastEditedAt.toISOString(),
                  createdAt: card.createdAt.toISOString(),
                  updatedAt: card.updatedAt.toISOString()
                }
              };
            }
          });

          socket.emit(SERVER_EVENT, {
            type: 'MUTATION_ACK',
            boardId: event.boardId,
            mutationId: event.mutationId,
            seq: mutation.seq,
            status: mutation.status
          });

          if (mutation.status === 'APPLIED' && mutation.result) {
            io.to(event.boardId).emit(SERVER_EVENT, {
              type: 'LIVE_EVENT',
              boardId: event.boardId,
              seq: mutation.result.seq,
              eventType: mutation.result.eventType,
              actorId: data.user.id,
              at: nowIso(),
              payload: mutation.result.eventPayload
            });
          }

          return;
        }

        if (event.type === 'CARD_UPDATED') {
          const payload = updateCardPayloadSchema.parse(event.payload);

          const mutation = await applyMutation({
            boardId: event.boardId,
            userId: data.user.id,
            mutationId: event.mutationId,
            eventType: 'CARD_UPDATED',
            mutate: async (tx, seq) => {
              const card = await tx.boardCard.findFirst({
                where: {
                  id: payload.cardId,
                  boardId: event.boardId
                }
              });

              if (!card) {
                throw new Error('CARD_NOT_FOUND');
              }

              const updated = await tx.boardCard.update({
                where: { id: card.id },
                data: {
                  title: payload.title ? sanitizeText(payload.title) : undefined,
                  description: payload.description !== undefined ? sanitizeRichText(payload.description) : undefined,
                  lastEditedBy: data.user.id,
                  lastEditedAt: new Date()
                }
              });

              return {
                seq,
                mutationId: event.mutationId,
                card: {
                  ...updated,
                  lastEditedAt: updated.lastEditedAt.toISOString(),
                  createdAt: updated.createdAt.toISOString(),
                  updatedAt: updated.updatedAt.toISOString()
                }
              };
            }
          });

          socket.emit(SERVER_EVENT, {
            type: 'MUTATION_ACK',
            boardId: event.boardId,
            mutationId: event.mutationId,
            seq: mutation.seq,
            status: mutation.status
          });

          if (mutation.status === 'APPLIED' && mutation.result) {
            io.to(event.boardId).emit(SERVER_EVENT, {
              type: 'LIVE_EVENT',
              boardId: event.boardId,
              seq: mutation.result.seq,
              eventType: mutation.result.eventType,
              actorId: data.user.id,
              at: nowIso(),
              payload: mutation.result.eventPayload
            });
          }

          return;
        }

        if (event.type === 'CARD_MOVED') {
          const payload = moveCardPayloadSchema.parse(event.payload);

          const mutation = await applyMutation({
            boardId: event.boardId,
            userId: data.user.id,
            mutationId: event.mutationId,
            eventType: 'CARD_MOVED',
            mutate: async (tx, seq) => {
              const card = await tx.boardCard.findFirst({
                where: {
                  id: payload.cardId,
                  boardId: event.boardId
                }
              });

              if (!card) {
                throw new Error('CARD_NOT_FOUND');
              }

              const targetList = await tx.boardList.findFirst({
                where: {
                  id: payload.toListId,
                  boardId: event.boardId
                }
              });

              if (!targetList) {
                throw new Error('LIST_NOT_FOUND');
              }

              await tx.boardCard.updateMany({
                where: {
                  boardId: event.boardId,
                  listId: payload.toListId,
                  order: {
                    gte: payload.toOrder
                  }
                },
                data: {
                  order: {
                    increment: 1
                  }
                }
              });

              const moved = await tx.boardCard.update({
                where: { id: card.id },
                data: {
                  listId: payload.toListId,
                  order: payload.toOrder,
                  lastEditedBy: data.user.id,
                  lastEditedAt: new Date()
                }
              });

              return {
                seq,
                mutationId: event.mutationId,
                card: {
                  ...moved,
                  lastEditedAt: moved.lastEditedAt.toISOString(),
                  createdAt: moved.createdAt.toISOString(),
                  updatedAt: moved.updatedAt.toISOString()
                },
                fromListId: payload.fromListId,
                toListId: payload.toListId,
                toOrder: payload.toOrder
              };
            }
          });

          socket.emit(SERVER_EVENT, {
            type: 'MUTATION_ACK',
            boardId: event.boardId,
            mutationId: event.mutationId,
            seq: mutation.seq,
            status: mutation.status
          });

          if (mutation.status === 'APPLIED' && mutation.result) {
            io.to(event.boardId).emit(SERVER_EVENT, {
              type: 'LIVE_EVENT',
              boardId: event.boardId,
              seq: mutation.result.seq,
              eventType: mutation.result.eventType,
              actorId: data.user.id,
              at: nowIso(),
              payload: mutation.result.eventPayload
            });
          }

          return;
        }

        if (event.type === 'COMMENT_ADDED') {
          const payload = addCommentPayloadSchema.parse(event.payload);

          const mutation = await applyMutation({
            boardId: event.boardId,
            userId: data.user.id,
            mutationId: event.mutationId,
            eventType: 'COMMENT_ADDED',
            mutate: async (tx, seq) => {
              const card = await tx.boardCard.findFirst({
                where: {
                  id: payload.cardId,
                  boardId: event.boardId
                }
              });

              if (!card) {
                throw new Error('CARD_NOT_FOUND');
              }

              const content = sanitizeRichText(payload.content);
              const mentions = extractMentions(content);

              const comment = await tx.comment.create({
                data: {
                  boardId: event.boardId,
                  cardId: payload.cardId,
                  userId: data.user.id,
                  content,
                  mentions
                }
              });

              await createMentionNotifications(tx, {
                workspaceId: access.workspaceId,
                boardId: event.boardId,
                actorId: data.user.id,
                commentId: comment.id,
                mentions
              });

              return {
                seq,
                mutationId: event.mutationId,
                comment: {
                  ...comment,
                  createdAt: comment.createdAt.toISOString(),
                  authorName: data.user.name
                }
              };
            }
          });

          socket.emit(SERVER_EVENT, {
            type: 'MUTATION_ACK',
            boardId: event.boardId,
            mutationId: event.mutationId,
            seq: mutation.seq,
            status: mutation.status
          });

          if (mutation.status === 'APPLIED' && mutation.result) {
            io.to(event.boardId).emit(SERVER_EVENT, {
              type: 'LIVE_EVENT',
              boardId: event.boardId,
              seq: mutation.result.seq,
              eventType: mutation.result.eventType,
              actorId: data.user.id,
              at: nowIso(),
              payload: mutation.result.eventPayload
            });
          }

          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown realtime error';
        socket.emit(SERVER_EVENT, {
          type: 'ERROR',
          code: 'REALTIME_ERROR',
          message,
          recoverable: true
        });
      }
    });

    socket.on('disconnect', async () => {
      const boards = Array.from(data.joinedBoards);
      await prisma.presenceSession.deleteMany({
        where: {
          socketId: socket.id
        }
      });

      for (const boardId of boards) {
        io.to(boardId).emit(SERVER_EVENT, {
          type: 'LIVE_EVENT',
          boardId,
          seq: 0,
          eventType: 'USER_LEFT',
          actorId: data.user.id,
          at: nowIso(),
          payload: {
            userId: data.user.id,
            name: data.user.name
          }
        });

        await emitRoomUsers(io, boardId);
      }

      socketRateBucket.delete(socket.id);
      logger.info({ userId: data.user.id, socketId: socket.id }, 'Socket disconnected');
    });
  });

  io.engine.on('close', () => {
    clearInterval(heartbeatTicker);
  });

  return io;
}
