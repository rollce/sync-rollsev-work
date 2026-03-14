# Sync Rollsev Work

Realtime collaboration platform for boards, comments, presence, cursors, typing, history and reconnect-safe sync.

Planned domain: `sync.rollsev.work` (custom DNS bind intentionally left as final manual step).

## Features
- Realtime kanban board with drag-and-drop cards.
- Live comments with mentions.
- Presence map, active participants list, cursor sync, typing indicators.
- Server-authoritative consistency with sequenced events.
- Optimistic UI + mutation ack + idempotency keys.
- Snapshot/revision history and restore.
- Reconnect queue and snapshot re-sync on sequence gaps.

## Monorepo
- `apps/api` — Fastify REST + Socket.IO realtime service.
- `apps/web` — React frontend (MUI component blocks).
- `packages/shared` — protocol schemas/types shared by backend/frontend.

## Data Model
Implemented core entities:
- `user`
- `workspace`
- `workspace_member`
- `board`
- `board_list`
- `board_card`
- `comment`
- `presence_session`
- `activity_event`
- `board_snapshot`
- `notification`

## Local Run
1. Start infra:
```bash
docker compose up -d
```
2. Install deps:
```bash
npm install
```
3. Configure env:
```bash
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```
4. Run DB migration + seed:
```bash
npm run prisma:migrate --workspace @sync/api -- --name init
npm run prisma:seed --workspace @sync/api
```
5. Start apps:
```bash
npm run dev
```

Web: `http://localhost:5173`
API: `http://localhost:3001`
WS: `ws://localhost:3001/ws`

Demo account:
- email: `demo@rollsev.work`
- password: `demo12345`

## Protocol (WebSocket)
Transport events:
- client emits `client_event`
- server emits `server_event`

Main client events:
- `JOIN_BOARD`
- `LEAVE_BOARD`
- `CURSOR_MOVED`
- `TYPING_STATUS`
- `CARD_CREATED`
- `CARD_UPDATED`
- `CARD_MOVED`
- `COMMENT_ADDED`
- `REQUEST_SNAPSHOT`
- `PONG`

Main server events:
- `SYNC_STATE`
- `LIVE_EVENT`
- `MUTATION_ACK`
- `ROOM_USERS`
- `PING`
- `ERROR`

## Reconnect and Conflict Handling
- Client stores pending mutation queue when offline.
- Queue is replayed automatically on reconnect.
- `board.seq` monotonic ordering detects gaps/out-of-order updates.
- `REQUEST_SNAPSHOT` recovers from missed events or conflicts.
- Duplicate mutations are deduplicated with Redis keys.

## Testing
```bash
npm run build
npm run test
```

Included tests:
- protocol schema validation
- socket rate-limit helper
- frontend smoke sanity test

## Deployment (Railway)
Target architecture:
- `api` service
- `web` service
- managed `postgres`
- managed `redis`

Deployment was executed via Railway CLI for this repo. Domain binding to `sync.rollsev.work` is intentionally deferred until DNS records are added.

## Portfolio Notes
- FigJam realtime architecture diagram: https://www.figma.com/online-whiteboard/create-diagram/ac198eb1-4cf2-41e0-8c97-fe20ae0f5081?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=9d1847c1-2e24-4c05-8d83-2051f4cbb3f8
- Architecture details: `docs/architecture.md`
- Event lifecycle: `docs/event-lifecycle.md`
- Scale strategy: `docs/scaling.md`
- Add a GIF demo after deploy (see `docs/demo-gif.md`).
