# Real-time Architecture

## Stack
- `apps/api`: Fastify + Socket.IO + Prisma + Redis adapter
- `apps/web`: Vite + React + MUI blocks + native drag-and-drop interactions
- `packages/shared`: realtime protocol v1 schemas and types
- Data: PostgreSQL (source of truth), Redis (idempotency keys, reconnect metadata, Socket.IO pub/sub)

## Consistency Model
- Server-authoritative state for all persistent mutations.
- Monotonic `board.seq` sequence generated on the server for sequenced events.
- Client mutations include `mutationId` for deduplication/idempotency.
- Clients apply optimistic updates locally, then reconcile via `MUTATION_ACK` and `LIVE_EVENT`.

## Rooms and Channels
- One socket room per board (`boardId`).
- Presence and cursor/typing are board-scoped ephemeral events.
- Persistent events (`CARD_*`, `COMMENT_ADDED`) are sequenced and stored in `activity_event`.

## Offline / Reconnect Flow
- Client keeps pending mutation queue.
- If socket disconnects, mutations are queued and replayed on reconnect.
- On reconnect client sends `JOIN_BOARD` with `lastServerSeq`.
- If seq gap detected, server/client trigger `REQUEST_SNAPSHOT` and replace local board state.

## Security
- JWT auth for REST and socket handshake.
- Workspace membership check before board join.
- Role-based edit permissions (`OWNER`, `EDITOR`, `VIEWER`).
- Payload validation via Zod.
- Socket event rate limits and sanitized user content.
