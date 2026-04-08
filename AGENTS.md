# AGENTS.md

## Commands
```bash
npm ci
npm run dev
npx eslint src/path/to/file.tsx --max-warnings=0
npx tsc --noEmit
npm run build
docker compose up --build
docker compose -f docker-compose.prod.yml up -d --build
```
- No `test` script, no `*.test.*` / `*.spec.*` files, and no GitHub workflows; do not claim tests passed.
- If `prisma/schema.prisma` changes, run `npx prisma generate` before `npm run build`.

## Architecture
- `src/app/page.tsx` only mounts `src/app/Dashboard.tsx`; most product behavior is in that client component plus `src/app/actions/broadcast.ts`.
- Server mutations live in `src/app/actions/*.ts`; only auth and cron use route handlers: `src/app/api/auth/[...nextauth]/route.ts` and `src/app/api/cron/process-pending/route.ts`.
- `src/lib/auth.ts` and `src/proxy.ts` own access control. If both `ALLOWED_EMAILS` and `ALLOWED_DOMAINS` are empty, any Google account can sign in.
- Google Drive integration is `src/app/actions/gdrive.ts`; it uses `GOOGLE_API_KEY` against public folders, not OAuth or a service account.
- Drive matching lowercases names and replaces non-alphanumerics with `_`; keep recipient parsing and matching rules in sync.

## Env And Ops
- Start from `.env.example`, but code also reads: `EMAIL_PROVIDER`, `EMAIL_DELAY_MS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`, `DRIVE_REQUEST_TIMEOUT_MS`, `GMAIL_DAILY_SAFE_LIMIT`, `GMAIL_PENDING_DELAY_HOURS`, `GMAIL_IMMEDIATE_BATCH_LIMIT`, `PENDING_RETRY_DELAY_MINUTES`, `PENDING_MAX_RETRY`.
- `EMAIL_PROVIDER` defaults to `gmail`; the cron retry route is skipped unless the provider is Gmail.
- `src/proxy.ts` intentionally exempts `/api/cron/process-pending`; access is protected only by `CRON_SECRET` via query param or `x-cron-secret`.
- Dockerized app listens on `3005`; the cron container calls `http://app:3005/api/cron/process-pending`.
- `Dockerfile` starts the container with `prisma db push --accept-data-loss --skip-generate`; if you change schema or deploy flow, update Docker and compose together.

## Data And Styling
- Certificate PDFs are stored in Postgres `Bytes` fields (`Broadcast.certificate`, `PendingEmail.certificate`); check DB and retry-flow impact before changing attachment handling.
- Styling is mostly `src/app/globals.css` plus inline utility classes; `tailwind.config.ts` still points at `./app` and `./components`, so do not use it as the source of truth for the current `src/` layout.
