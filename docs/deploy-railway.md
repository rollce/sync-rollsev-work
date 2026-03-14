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
Custom domains are already attached in Railway and waiting for DNS propagation.

Add these DNS records:
1. `sync.rollsev.work` -> CNAME `9n8lomgv.up.railway.app`
2. `api.sync.rollsev.work` -> CNAME `nzetrq16.up.railway.app`

Add these ownership TXT records:
1. `_railway-verify.sync.rollsev.work` -> `railway-verify=3b7ef5dc0bbd6f002ece95a5faf3306709d218107011a8900d8b5c3a1414ee73`
2. `_railway-verify.api.sync.rollsev.work` -> `railway-verify=488ce212b24873e19775ea625256282a262c78f019100021c057187cfd6c392e`

After DNS is live:
1. Set API vars:
   - `CORS_ORIGINS=https://sync.rollsev.work`
2. Set Web vars:
   - `VITE_API_URL=https://api.sync.rollsev.work`
   - `VITE_WS_URL=https://api.sync.rollsev.work`
3. Redeploy `api` and `web`.
4. Re-run smoke with 2-3 tabs and 2 accounts.
