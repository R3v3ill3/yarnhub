<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Yarnhub is a single-package Next.js 16 (App Router, Turbopack) app. See `CLAUDE.md` for product scope/build order and `docs/IMPLEMENTATION_PLAN.md` for phases.

- Package manager is **pnpm** (pinned via `packageManager`), Node 22. The startup update script runs `pnpm install --frozen-lockfile`; you do not need to reinstall.
- Run/lint/build commands live in `package.json` scripts: `pnpm dev` (dev server on http://localhost:3000), `pnpm lint`, `pnpm build`, `pnpm start`.
- There is **no `test` script**. Run unit tests with `pnpm exec vitest run` (Vitest is installed but there is no `vitest.config.*`, so tests rely on relative imports and the `@/*` alias is not resolved).
- `main` is currently an early scaffold: `pnpm build`, `pnpm lint`, and some Vitest files fail on incomplete code, and these are expected until Phase A lands — they are not environment problems:
  - `seed/from-oa/**` is **reference-only** (never imported by the app) but is still type-checked by `next build`, so it contributes build errors. Do not "fix" it as part of unrelated work; the real product lives under `src/`.
  - A few `src/lib/sms/*` files import not-yet-created modules (e.g. `@/types/sms`, `@/lib/sms/assessment-mapping`); the 40 tests in the passing engine test files (`blackout`, `compliance`, `segments`, provider webhook parse) run green.
- No `.env` is required to run the current scaffold. Later phases need Supabase (project `yarnhub`) and Mobile Message credentials per `CLAUDE.md`; add those as secrets rather than committing them.
