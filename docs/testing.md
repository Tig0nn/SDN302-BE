# Testing and CI

## Local Commands

Run the fast test suite:

```bash
npm test
```

Run the full verification gate used by CI:

```bash
npm run verify
```

`npm run verify` runs syntax lint and coverage-enforced tests. Coverage is measured with the Node.js test runner against application code in `modules`, `middlewares`, `routes`, and `config`.

Current thresholds:

- Lines: 60%
- Branches: 60%
- Functions: 60%

## Test Database

Most route tests mock repository/database calls so they remain fast and deterministic. CI also provisions a real PostgreSQL test database and runs:

```bash
npm run migrate
npm run seed
npm run db:state
```

This verifies that migrations, schema triggers/indexes, and idempotent seed data work against PostgreSQL before the coverage test suite runs.

For a local PostgreSQL test database, set:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vi_vi_vu_test
DATABASE_SSL=false
JWT_SECRET=test-secret-with-enough-length
OTP_SECRET=test-otp-secret-with-enough-length
NOTIFICATION_JOBS_ENABLED=false
```

Then run:

```bash
npm run migrate
npm run seed
npm run db:state
npm run verify
```

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`.

The workflow runs on pushes to `main`, `master`, and `codex/**`, and on pull requests. It uses Node.js 22 and PostgreSQL 16, then runs:

```bash
npm ci
npm run lint
npm run migrate
npm run seed
npm run db:state
npm run test:coverage
```
