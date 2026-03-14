import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export const userRoleSchema = z.enum(['OWNER', 'EDITOR', 'VIEWER']);

export const liveEventTypeSchema = z.enum([
  'USER_JOINED',
  'USER_LEFT',
  'CURSOR_MOVED',
  'TYPING_STATUS',
  'CARD_CREATED',
  'CARD_UPDATED',
  'CARD_MOVED',
  'CARD_DELETED',
  'COMMENT_ADDED',
  'SNAPSHOT_AVAILABLE'
]);

export const cursorPayloadSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewport: z.string().max(64).default('board')
});

export const typingPayloadSchema = z.object({
  cardId: z.string().min(1).max(64).optional(),
  active: z.boolean()
});

export const moveCardPayloadSchema = z.object({
  cardId: z.string().min(1),
  fromListId: z.string().min(1),
  toListId: z.string().min(1),
  toOrder: z.number().int().nonnegative()
});

export const updateCardPayloadSchema = z.object({
  cardId: z.string().min(1),
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(8000).optional()
}).refine((input) => input.title !== undefined || input.description !== undefined, {
  message: 'At least one field must be provided'
});

export const addCommentPayloadSchema = z.object({
  cardId: z.string().min(1),
  content: z.string().trim().min(1).max(4000)
});

export const createCardPayloadSchema = z.object({
  listId: z.string().min(1),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(8000).optional()
});

export const clientEventSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('JOIN_BOARD'),
    boardId: z.string().min(1),
    lastServerSeq: z.number().int().nonnegative().default(0)
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('LEAVE_BOARD'),
    boardId: z.string().min(1)
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('CURSOR_MOVED'),
    boardId: z.string().min(1),
    payload: cursorPayloadSchema
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('TYPING_STATUS'),
    boardId: z.string().min(1),
    payload: typingPayloadSchema
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('CARD_CREATED'),
    boardId: z.string().min(1),
    mutationId: z.string().uuid(),
    payload: createCardPayloadSchema
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('CARD_UPDATED'),
    boardId: z.string().min(1),
    mutationId: z.string().uuid(),
    payload: updateCardPayloadSchema
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('CARD_MOVED'),
    boardId: z.string().min(1),
    mutationId: z.string().uuid(),
    payload: moveCardPayloadSchema
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('COMMENT_ADDED'),
    boardId: z.string().min(1),
    mutationId: z.string().uuid(),
    payload: addCommentPayloadSchema
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('REQUEST_SNAPSHOT'),
    boardId: z.string().min(1)
  }),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('PONG'),
    boardId: z.string().min(1).optional()
  })
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;

export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SYNC_STATE'),
    boardId: z.string(),
    seq: z.number().int().nonnegative(),
    snapshot: z.unknown()
  }),
  z.object({
    type: z.literal('LIVE_EVENT'),
    boardId: z.string(),
    seq: z.number().int().nonnegative(),
    eventType: liveEventTypeSchema,
    actorId: z.string(),
    at: z.string(),
    payload: z.unknown()
  }),
  z.object({
    type: z.literal('MUTATION_ACK'),
    boardId: z.string(),
    mutationId: z.string().uuid(),
    seq: z.number().int().nonnegative(),
    status: z.enum(['APPLIED', 'DUPLICATE', 'REJECTED']),
    reason: z.string().optional()
  }),
  z.object({
    type: z.literal('ROOM_USERS'),
    boardId: z.string(),
    activeUsers: z.array(z.object({
      userId: z.string(),
      name: z.string(),
      cursor: cursorPayloadSchema.optional(),
      typing: typingPayloadSchema.optional(),
      lastSeenAt: z.string()
    }))
  }),
  z.object({
    type: z.literal('PING'),
    at: z.string()
  }),
  z.object({
    type: z.literal('ERROR'),
    code: z.string(),
    message: z.string(),
    recoverable: z.boolean().default(false)
  })
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;

export const boardPermissionSchema = z.object({
  workspaceId: z.string(),
  boardId: z.string(),
  role: userRoleSchema
});

export type BoardPermission = z.infer<typeof boardPermissionSchema>;
