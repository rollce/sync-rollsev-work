# Railway Deployment Status

## Project
- Railway project: `sync-rollsev-work`
- Environment: `production`

## Services
- `api`
- `web`
- `Postgres`
- `Redis`

## Active public URLs
- API: `https://api-production-f1da.up.railway.app`
- Web: `https://web-production-c9c26.up.railway.app`

## Production smoke results
- `GET /health` => `{"status":"ok","postgres":"ok","redis":"ok"}`
- Demo login OK (`demo@rollsev.work / demo12345`)
- `GET /v1/boards/demo-board` OK
- WebSocket join room OK (`ROOM_USERS` received)

## Custom domain (deferred by request)
Manual next step for final domain binding:
1. Add custom domain in Railway:
   - web: `sync.rollsev.work`
   - optional api split: `api.sync.rollsev.work`
2. Railway returns DNS target records.
3. Add DNS records in your DNS provider.
4. Wait for SSL provisioning.
5. Update env:
   - `CORS_ORIGINS=https://sync.rollsev.work`
   - `VITE_API_URL=https://api.sync.rollsev.work` (or shared host if single domain)
   - `VITE_WS_URL=https://api.sync.rollsev.work`
6. Re-deploy `api` and `web`.
7. Verify with 2-3 tabs and 2 accounts.
