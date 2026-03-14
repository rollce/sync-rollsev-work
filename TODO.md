# Sync Rollsev Work — TODO

## 1. Scope
- [x] Формат: `kanban board + comments + presence` (server-authoritative realtime)
- [x] Live-события: joined/left, cursor, typing, card updated/moved, comment added
- [x] Consistency model: server-authoritative events + versioned sequence + idempotency keys
- [x] Комнаты/каналы: per-workspace + per-board rooms
- [x] Offline/reconnect: local pending queue + resync snapshot

## 2. Data model
- [x] user
- [x] workspace
- [x] board/document
- [x] board member
- [x] section/list
- [x] card/block
- [x] comment
- [x] presence session
- [x] activity event
- [x] snapshots/version history

## 3. Backend foundation
- [x] API + auth
- [x] PostgreSQL
- [x] Redis
- [x] Workspace membership + permissions
- [x] REST initial state
- [x] WebSocket server + room auth + reconnect
- [x] heartbeat + disconnect cleanup

## 4. Real-time layer
- [x] Event protocol + message versioning
- [x] join/leave room
- [x] live updates broadcast
- [x] presence map + active users
- [x] typing + cursors
- [x] optimistic update + server ack
- [x] retry/re-sync/out-of-order/dedup/idempotency
- [x] snapshot recovery

## 5. Collaboration features
- [x] live editable board
- [x] drag-and-drop cards
- [x] live comments + mentions + notifications
- [x] activity feed + last edited by
- [x] conflict handling + autosave
- [x] revision history + restore

## 6. Frontend
- [x] app shell
- [x] workspace switcher
- [x] board list
- [x] board page
- [x] realtime presence/cursor UI
- [x] comments panel
- [x] reconnect/unsaved/synced indicators
- [x] history modal + conflict UI

## 7. Performance
- [x] debounce + batching
- [x] presence rate limit
- [x] rerender optimizations
- [x] list virtualization strategy
- [x] websocket throughput profiling notes

## 8. Security
- [x] socket auth
- [x] room authorization
- [x] socket payload validation
- [x] socket rate limiting
- [x] content sanitization
- [x] workspace isolation checks

## 9. Testing
- [x] socket tests
- [x] room auth tests
- [x] presence tests
- [x] reconnect/conflict tests
- [x] smoke e2e with 2 users

## 10. Deploy architecture (Railway)
- [x] Services: web/api/postgres/redis
- [x] env vars + healthchecks
- [x] prod websocket URL
- [x] smoke test in prod

## 11. Domain sync.rollsev.work (last)
- [ ] custom domain bind (post-deploy)
- [ ] SSL + CORS + WSS checks

## 12. Portfolio amplification
- [x] README architecture + event lifecycle
- [x] reconnect/conflict handling docs
- [x] GIF placeholder/instructions
- [x] scaling section (Redis pubsub, room sharding, sticky/stateless)
