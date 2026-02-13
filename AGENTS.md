# AGENTS.md

Guidance for coding agents working in this repository.

## Project Snapshot

- Stack: Next.js 16 (App Router), React 19, TypeScript (strict), Prisma, NextAuth.
- Package manager: npm (`package-lock.json` present).
- Runtime: Node 20+ recommended (Dockerfile uses `node:20-alpine`).
- Styling: Tailwind CSS v4 + custom CSS in `src/app/globals.css`.
- Data store: PostgreSQL via Prisma (`prisma/schema.prisma`).
- Primary app code: `src/app` and `src/lib`.

## Source Layout

- `src/app`: routes, server actions, UI components.
- `src/app/actions`: server actions (`'use server'` modules).
- `src/lib`: reusable server/client utilities (auth, prisma, validation, email, AI).
- `prisma/schema.prisma`: data models and database schema.
- `docker-compose.yml` and `docker-compose.prod.yml`: local/prod orchestration.

## Build / Lint / Test Commands

Run commands from repo root: `C:\Users\yudhiar\Downloads\oprek\Dev\bece`.

### Install

- `npm ci` - install exact dependency tree from lockfile.

### Dev / Build / Run

- `npm run dev` - start Next.js dev server.
- `npm run build` - production build.
- `npm run start` - start production server (after build).

### Lint

- `npm run lint` - run ESLint (`eslint.config.mjs`, Next core-web-vitals + TS).
- `npx eslint src --max-warnings=0` - stricter lint gate for CI-style checks.

### Tests (Current State)

- There is currently **no test script** in `package.json`.
- There are currently **no test files** (`*.test.*` / `*.spec.*`) in the repo.
- Do not invent test results; state clearly when tests cannot be run.

### Single-Test Command (Important)

- Not available yet because no test runner is configured.
- If a runner is added later, use that runner's single-test command, e.g.:
  - Vitest: `npx vitest run path/to/file.test.ts -t "test name"`
  - Jest: `npx jest path/to/file.test.ts -t "test name"`

## Prisma / Database Commands

- `npx prisma generate` - regenerate Prisma client.
- `npx prisma migrate dev` - create/apply local migrations.
- `npx prisma db push` - push schema without migration files (use cautiously).
- `npx prisma studio` - open Prisma Studio.

## Docker Commands

- `docker compose up --build` - local stack (app + db).
- `docker compose -f docker-compose.prod.yml up -d --build` - prod-like stack.

## Environment Setup

- Copy `.env.example` to `.env.local` (or `.env`) and fill values.
- Required integrations include OpenAI, Google OAuth, Google Drive API key, email creds.
- Key vars referenced by app:
  - `DATABASE_URL`, `AUTH_SECRET`
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `OPENAI_API_KEY` (+ optional base/model vars)
  - `GMAIL_USER`/`GMAIL_APP_PASSWORD` or Resend SMTP vars

## Code Style Rules

### Formatting

- Follow existing file style first; avoid large formatting-only diffs.
- In `src/**`, style is mostly:
  - single quotes,
  - semicolons,
  - trailing commas in multiline literals,
  - 4-space indentation in many files.
- Keep lines readable; split long chained calls/objects over multiple lines.

### Imports

- Prefer absolute alias imports via `@/*` for internal modules.
- Keep import groups ordered:
  1) framework/external packages,
  2) internal alias imports,
  3) relative imports.
- Avoid unused imports; remove dead symbols while editing.

### TypeScript and Types

- `tsconfig` has `strict: true`: preserve strict typing.
- Prefer explicit interfaces/types for object shapes at boundaries.
- Avoid `any`; if unavoidable, keep it localized and documented in code review notes.
- Use `unknown` + narrowing for caught errors when practical.
- Reuse shared validation/types from `src/lib/validations.ts` where possible.

### Naming Conventions

- React components: `PascalCase` (e.g., `Dashboard`, `Providers`).
- Functions/variables: `camelCase`.
- Constants/env-derived config: `UPPER_SNAKE_CASE` when module-level constants.
- Server actions: verb-based names, often suffixed with `Action` in action modules.
- File names:
  - route files follow Next conventions (`page.tsx`, `layout.tsx`, `route.ts`),
  - utility/action modules are typically lowercase/kebab-like.

### React / Next.js Patterns

- Add `'use client'` only for client components using hooks/browser APIs.
- Add `'use server'` in server action modules.
- Keep auth-sensitive behavior on server side where possible.
- Use `revalidatePath` after server mutations when UI cache invalidation is needed.

### Validation and Input Handling

- Validate external/input data with Zod (`safeParse`) before side effects.
- Sanitize untrusted text that is interpolated into HTML/email templates.
- Enforce URL/domain checks for user-provided links.
- Keep recipient/email constraints aligned with validation schemas.

### Error Handling and Logging

- Fail fast for auth/permission issues in server actions.
- Throw actionable `Error` messages from server-side boundaries.
- Catch operational failures around external services (SMTP, Drive, OpenAI, DB writes).
- Log failures with enough context (email/operation), but never leak secrets.
- In UI, convert low-level errors into user-friendly messages.

### Security Practices

- Never commit `.env*` or credentials.
- Preserve security headers and middleware auth redirects in `src/middleware.ts` / `next.config.ts`.
- Keep allowlist checks for login restrictions (`ALLOWED_EMAILS`, `ALLOWED_DOMAINS`).
- Treat HTML email content as sensitive to injection; sanitize and validate inputs.

### Prisma and Data Access

- Use shared Prisma singleton from `src/lib/prisma.ts` (do not instantiate ad hoc clients).
- Keep DB writes explicit and scoped; record success/failure status consistently.
- Update `prisma/schema.prisma` and regenerate client after schema changes.

## Agent Workflow Expectations

- Before finalizing, run what is available: `npm run lint` and/or `npm run build`.
- If a command cannot run (missing env/service), report why and what is needed.
- Keep changes focused; avoid unrelated refactors.
- Prefer small, reviewable patches and preserve existing behavior unless asked.

## Cursor / Copilot Rules

- `.cursorrules`: not present.
- `.cursor/rules/`: not present.
- `.github/copilot-instructions.md`: not present.
- Therefore, no repository-specific Cursor/Copilot instruction files currently apply.

## Notes for Future Test Setup

- Recommended: add `test` and `test:watch` scripts and pick Vitest or Jest.
- Ensure at least one documented single-test command in `package.json` scripts.
- Once added, update this file so agents can run one test file and one test case quickly.
