# AGENTS.md

Guidance for coding agents operating in this repository.

## Project Snapshot

- Framework: Next.js 16 App Router + React 19.
- Language: TypeScript with `strict: true`.
- Auth: NextAuth (Google provider).
- Data: Prisma + PostgreSQL.
- Styling: Tailwind CSS v4 + `src/app/globals.css`.
- Package manager: npm (`package-lock.json` present).
- Runtime target: Node 20+ (`node:20-alpine` in Dockerfile).

## Repository Layout

- `src/app`: routes, pages, layouts, providers, and UI modules.
- `src/app/actions`: server actions (`'use server'`).
- `src/lib`: shared utilities (auth, prisma, validation, email, AI, rate-limit).
- `prisma/schema.prisma`: database schema and models.
- `src/middleware.ts`: auth redirect middleware.
- `next.config.ts`: Next config + security headers.

## Setup and Environment

- Run commands from repo root: `C:\Users\yudhiar\Downloads\oprek\Dev\bece`.
- Install dependencies with `npm ci`.
- Copy `.env.example` to `.env.local` (or `.env`) and provide required values.
- Frequently used env vars:
  - `DATABASE_URL`, `AUTH_SECRET`
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `OPENAI_API_KEY` (plus optional model/base vars)
  - `GMAIL_USER`, `GMAIL_APP_PASSWORD` or SMTP alternatives
  - optional auth allowlists: `ALLOWED_EMAILS`, `ALLOWED_DOMAINS`

## Build, Lint, and Test Commands

### Core scripts

- `npm run dev`: start dev server.
- `npm run build`: production build.
- `npm run start`: run built app.
- `npm run lint`: run ESLint using `eslint.config.mjs`.

### Lint variants

- `npx eslint src --max-warnings=0`: strict lint gate on source files.
- `npx eslint .`: lint entire workspace if needed.

### Tests (current state)

- No `test` script exists in `package.json`.
- No test files currently exist (`*.test.*` / `*.spec.*`).
- Do not claim tests passed; explicitly state tests are not configured.

### Single-test execution (important)

- Not available right now because no test runner is configured.
- If tests are introduced, prefer runner-native single-test commands:
  - Vitest file: `npx vitest run path/to/file.test.ts`
  - Vitest case: `npx vitest run path/to/file.test.ts -t "case name"`
  - Jest file: `npx jest path/to/file.test.ts`
  - Jest case: `npx jest path/to/file.test.ts -t "case name"`

## Database and Prisma Commands

- `npx prisma generate`: regenerate Prisma client.
- `npx prisma migrate dev`: create/apply local migration.
- `npx prisma db push`: sync schema without migration files (use cautiously).
- `npx prisma studio`: inspect data locally.

## Docker Commands

- `docker compose up --build`: local app + db stack.
- `docker compose -f docker-compose.prod.yml up -d --build`: prod-like stack.

## Coding Guidelines

### Formatting and diffs

- Follow existing style in the edited file; avoid formatting-only churn.
- Existing TS/TSX style is commonly single quotes, semicolons, and trailing commas.
- Many source files use 4-space indentation; keep consistency per file.
- Keep lines readable; wrap long objects/chains thoughtfully.

### Imports

- Prefer `@/*` alias imports for internal modules (`@/lib/...`, `@/app/...`).
- Keep imports grouped in this order:
  1) framework/external packages,
  2) internal alias imports,
  3) relative imports.
- Remove unused imports and dead symbols while editing.

### TypeScript and typing

- Preserve strict typing (`strict: true` in `tsconfig.json`).
- Prefer explicit types/interfaces at module boundaries.
- Avoid `any`; use `unknown` + narrowing when possible.
- Reuse shared schemas and inferred types from `src/lib/validations.ts`.
- Keep function return types clear when behavior is non-trivial.

### Naming conventions

- Components and React modules: `PascalCase`.
- Variables/functions: `camelCase`.
- Constants and env-derived flags: `UPPER_SNAKE_CASE`.
- Server actions: verb-based names, commonly ending in `Action`.
- Next route files must follow conventions (`page.tsx`, `layout.tsx`, `route.ts`).

### React and Next.js patterns

- Use `'use client'` only when hooks/browser APIs are required.
- Keep server actions in `'use server'` modules.
- Keep auth-sensitive and secret-dependent logic server-side.
- After server mutations, use cache invalidation (e.g. `revalidatePath`) where needed.

### Validation and security

- Validate external input with Zod before side effects (`safeParse`).
- Sanitize untrusted content rendered into HTML/email templates.
- Enforce URL/domain checks for user-provided links.
- Preserve auth allowlist behavior (`ALLOWED_EMAILS`, `ALLOWED_DOMAINS`).
- Never commit secrets, credentials, or `.env*` files.

### Error handling and logging

- Fail fast on auth/permission checks in server boundaries.
- Throw actionable errors with useful context.
- Wrap external IO (SMTP, OpenAI, Google APIs, DB writes) in try/catch as needed.
- Log operational failures with context, but never leak secrets/tokens.
- Surface user-friendly messages in UI paths.

### Prisma and persistence

- Use shared Prisma singleton from `src/lib/prisma.ts`.
- Do not instantiate ad hoc `PrismaClient` instances.
- Keep writes explicit and track success/failure states consistently.
- If schema changes, update `prisma/schema.prisma` and run `npx prisma generate`.

## Agent Workflow Expectations

- Keep edits focused; avoid unrelated refactors.
- Before finalizing, run available checks (`npm run lint`, and `npm run build` when meaningful).
- If checks cannot run (env/services unavailable), report exactly why.
- Do not invent command outputs or test results.
- Prefer small, reviewable patches.

## Cursor and Copilot Rules

- `.cursorrules`: not present.
- `.cursor/rules/`: not present.
- `.github/copilot-instructions.md`: not present.
- No repository-specific Cursor/Copilot rule files currently apply.

## If Test Runner Is Added Later

- Add scripts such as `test`, `test:watch`, and (optionally) `test:ci` to `package.json`.
- Document exact single-test commands in this file immediately.
- Keep this file updated so agents can execute one file and one test case directly.
