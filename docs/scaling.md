# How It Scales

## Horizontal API Scaling
- Socket.IO Redis adapter fan-outs room events across instances.
- Persistent state remains in PostgreSQL, ephemeral state in Redis/Presence table.

## Room Sharding
- Split heavy boards by workspace/board affinity.
- Route hot rooms to dedicated service pools.

## Pub/Sub
- Redis channels propagate events for multi-instance consistency.
- Mutation idempotency keys remain globally visible across replicas.

## Sticky vs Stateless Auth
- Current model is stateless JWT with server-side membership checks.
- Sticky sessions are optional (for reduced reconnect churn), not required for correctness.

## Throughput Controls
- Cursor/typing rate limits.
- Optimistic local updates to reduce round trips.
- Snapshot sync for quick recovery instead of replaying long event logs.
