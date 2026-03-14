# Event Lifecycle (v1)

## 1) Client Mutation
- Client emits `client_event` with `protocolVersion=1`, `type`, `boardId`, `mutationId`, and payload.

## 2) Server Validation
- Protocol and payload validated with shared Zod schemas.
- Membership and role permissions verified.
- Rate limit check performed.

## 3) Idempotency
- Redis `SET NX EX` on `mutation:{boardId}:{mutationId}`.
- Existing key => `MUTATION_ACK` with `DUPLICATE`.

## 4) Commit
- Prisma transaction increments `board.seq`.
- Mutation applied to persistent models.
- `activity_event` row stored with resulting payload.
- Snapshot created every `SNAPSHOT_EVERY` sequence steps.

## 5) Broadcast
- Emitter sends `MUTATION_ACK` to actor.
- `LIVE_EVENT` with `seq` and payload broadcast to room.

## 6) Client Reconcile
- Client drops duplicate/old seq.
- On seq gap, client requests `SYNC_STATE` snapshot.
- Pending mutation removed on `MUTATION_ACK`.
