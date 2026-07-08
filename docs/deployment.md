# Deploy Vi Vi Vu API

## Railway

This repo includes `railway.json` for Railway config-as-code.

Current Railway deployment:

```txt
https://api-production-bbe5.up.railway.app
```

Railway will:

- Build with the root `Dockerfile`.
- Run `npm run deploy:prepare` before the app starts, which applies migrations and seeds default data.
- Start the API with `npm start`.
- Check `/health` before routing traffic to the new deployment.

### Railway Variables

Set these variables in Railway service settings:

```txt
NODE_ENV=production
DATABASE_URL=<supabase-postgres-connection-string>
DATABASE_SSL=true
JWT_SECRET=<long-random-secret>
GOOGLE_CLIENT_IDS=<ios-client-id>,<android-client-id>,<web-client-id>
CORS_ORIGINS=http://localhost:19006,http://localhost:8081,http://localhost:8082,http://localhost:3000,<frontend-web-origin>
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
PUBLIC_BASE_URL=https://<railway-service-domain>
API_PREFIX=/api/v1
PASSWORD_HASH_ROUNDS=12
OTP_LENGTH=6
OTP_TTL_MINUTES=10
OTP_MAX_ATTEMPTS=5
OTP_SECRET=<long-random-otp-secret>
EMAIL_PROVIDER=brevo
BREVO_API_KEY=<brevo-api-key>
BREVO_FROM=Vi Vi Vu <verified-sender-email>
BREVO_API_BASE_URL=https://api.brevo.com/v3
BREVO_TIMEOUT_MS=10000
GEMINI_MODEL=gemini-1.5-flash
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_TIMEOUT_MS=20000
GEMINI_CHAT_API_KEY=<gemini-key-for-chatbot>
GEMINI_RECEIPT_API_KEY=<gemini-key-for-receipt-scan>
AI_RATE_LIMIT_WINDOW_MS=60000
AI_RATE_LIMIT_MAX=30
AI_CHAT_HISTORY_LIMIT=12
AI_RECEIPT_BODY_LIMIT=4mb
AI_RECEIPT_IMAGE_MAX_BYTES=3145728
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<gmail-address>
SMTP_PASS=<gmail-app-password>
SMTP_FROM=Vi Vi Vu <gmail-address>
```

Railway injects `PORT` automatically, and `server.js` already listens on `process.env.PORT`.

### Railway Deploy Options

Using the Railway dashboard:

1. Create a new Railway project.
2. Choose **Deploy from GitHub repo** and select this backend repo.
3. Add the variables above.
4. Generate a Railway public domain for the service.
5. Set `PUBLIC_BASE_URL` to that generated domain.
6. Trigger a deploy.

Using the Railway CLI:

```bash
npx --yes @railway/cli login --browserless
npx --yes @railway/cli init
npx --yes @railway/cli up
```

For non-interactive deploys, set one Railway token before running CLI commands:

```bash
export RAILWAY_TOKEN=<project-token>
# or
export RAILWAY_API_TOKEN=<account-or-workspace-token>
```

After the first successful deploy, open:

```txt
https://<railway-service-domain>/docs
https://<railway-service-domain>/openapi.json
```

## Required Environment Variables

- `DATABASE_URL`: Supabase PostgreSQL connection string.
- `DATABASE_SSL`: `true` for Supabase.
- `JWT_SECRET`: long random secret for backend JWT signing.
- `GOOGLE_CLIENT_IDS`: comma-separated Google OAuth client IDs for Expo iOS/Android/Web.
- `CORS_ORIGINS`: comma-separated frontend origins, for example `http://localhost:19006,http://localhost:8081,http://localhost:8082,http://localhost:3000,<frontend-web-origin>`.
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`: global API rate limit window and request cap per client.
- `PUBLIC_BASE_URL`: deployed backend URL, used in `/openapi.json` server list.
- `OTP_SECRET`: long random secret for hashing OTP codes at rest.
- `EMAIL_PROVIDER`: use `brevo` for production OTP delivery. `smtp` remains available as a fallback.
- `BREVO_API_KEY`, `BREVO_FROM`, `BREVO_API_BASE_URL`, `BREVO_TIMEOUT_MS`: Brevo HTTP API settings for signup OTP delivery. `BREVO_FROM` must use a sender verified in Brevo.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: optional SMTP fallback settings.
- `GEMINI_MODEL`, `GEMINI_API_BASE_URL`, `GEMINI_TIMEOUT_MS`: Gemini routing and request timeout.
- `GEMINI_CHAT_API_KEY`, `GEMINI_RECEIPT_API_KEY`: backend-managed Gemini keys for chatbot and receipt scan. Store them only in environment variables, not in source control.
- `AI_RATE_LIMIT_WINDOW_MS`, `AI_RATE_LIMIT_MAX`, `AI_CHAT_HISTORY_LIMIT`: AI endpoint throttling and bounded chat context.
- `AI_RECEIPT_BODY_LIMIT`, `AI_RECEIPT_IMAGE_MAX_BYTES`: dedicated receipt-scan JSON body and decoded image limits.

## Deployment Commands

```bash
npm ci
npm run migrate
npm run seed
npm start
```

## Health Checks

Before routing mobile traffic to a new deployment, check:

```txt
/health
/health/db
/metrics
```

`/health` verifies the HTTP process. `/health/db` verifies PostgreSQL connectivity. `/metrics` exposes request latency, error rate, status counts, and DB pool usage for basic release observation.

## Rollback Plan

If a deployment fails before migrations complete, redeploy the previous successful Railway/Render release and rerun:

```bash
npm run db:state
```

If a deployment fails after migrations complete, keep the migrated database in place unless the migration itself is the known cause. The migrations are additive/idempotent for MVP tables, so the preferred rollback is:

1. Redeploy the previous application image/release from Railway or Render.
2. Confirm `/health` and `/health/db`.
3. Check `/openapi.json` and a private endpoint with a test token.
4. Inspect recent logs for `INTERNAL_ERROR` and DB connection errors.

If a migration causes a database-level failure, restore the latest Supabase/Postgres backup from before the deployment, then redeploy the previous application release and run `npm run db:state`.

## Public API Docs

After deployment:

- Health: `/health`
- Database health: `/health/db`
- OpenAPI JSON: `/openapi.json`
- Interactive docs: `/docs`

Only APIs currently implemented in code are listed in OpenAPI so frontend can trust the contract.
