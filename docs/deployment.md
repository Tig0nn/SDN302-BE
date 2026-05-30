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
CORS_ORIGINS=<expo-dev-origin>,<frontend-web-origin>
PUBLIC_BASE_URL=https://<railway-service-domain>
API_PREFIX=/api/v1
PASSWORD_HASH_ROUNDS=12
OTP_LENGTH=6
OTP_TTL_MINUTES=10
OTP_MAX_ATTEMPTS=5
OTP_SECRET=<long-random-otp-secret>
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
- `CORS_ORIGINS`: comma-separated frontend origins.
- `PUBLIC_BASE_URL`: deployed backend URL, used in `/openapi.json` server list.
- `OTP_SECRET`: long random secret for hashing OTP codes at rest.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: Gmail SMTP/app-password settings for signup OTP delivery.

## Deployment Commands

```bash
npm ci
npm run migrate
npm run seed
npm start
```

## Public API Docs

After deployment:

- Health: `/health`
- Database health: `/health/db`
- OpenAPI JSON: `/openapi.json`
- Interactive docs: `/docs`

Only APIs currently implemented in code are listed in OpenAPI so frontend can trust the contract.
