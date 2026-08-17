# Next prompt — paste this in a **new** Cursor chat

**Workspace:** the **Yarnhub** repo — https://github.com/R3v3ill3/yarnhub — not OffshoreAlliance.  
**If the folder on the left is still `OffshoreAlliance`, stop and File → Open Folder** on `/Volumes/DataDrive/cursor_repos/yarnhub`.

You are continuing **Yarnhub** (https://yarnhub.reveille.net.au). GitHub `R3v3ill3/yarnhub`. Vercel project **`yarnhub`**. Supabase project **`yarnhub`** (ref `tycqjkghdmizgbqgbkgg`, Sydney). Never use OA DEV/PROD Supabase, never add OA as a remote, never import `seed/from-oa/` from app code.

Read in this order: `CLAUDE.md` → `docs/IMPLEMENTATION_PLAN.md` → `docs/VIABILITY.md` → `seed/from-oa/MANIFEST.md` → this file. Then inspect the tree; do not rebuild Phase A/B.

User git rules: do not run git commands unless they agree to that specific command; commit/push only when they ask.

---

## Goal of this session

Bring Yarnhub to **full BYO product functionality**: all five tools working for one organisation that pastes its own Mobile Message credentials.

That is **Phase C**, then **Phase D** if C’s exit is met and the user wants polish. **Phase E (hosted MM / Stripe / number pool) is forbidden** until the user explicitly asks.

Phase C exit (`docs/IMPLEMENTATION_PLAN.md`): P2P + surveys + relays + existing blast + inbox, for one BYO org. Inbound order must be: **STOP → live survey by member phone → live relay by to-number → inbox**.

---

## What is already done (do not re-scaffold)

`main` as of 2026-08-14. Latest commit **`4637449`** (`ed2cc4b` was Phase B + signup pgcrypto fix).

### Phase A — live

Signup/login (Supabase Auth) → first org → BYO credentials (encrypted `SMS_CREDENTIALS_KEY`) → register dedicated number → test SMS → `POST /api/sms/webhook?org=<org_public_id>` (Node, HMAC) creates/attaches thread unique on `(organisation_id, our_number_id, phone_e164)`. Mock provider for local/CI.

### Phase B — on `main`, schema applied on yarnhub

- Contacts: add, CSV paste, snapshot as `contact_lists` / `contact_list_members`
- Blasts: `/blasts`, compose (inbox/spare senders only, `{{first_name}}` `{{last_name}}` `{{org_name}}`, segment counter, org-name **warning**, blackout override + ≥8 char reason) → `sms_blasts` / `sms_blast_items` → cron `GET|POST /api/cron/dispatch-sms-queue` every 5 minutes (`vercel.json`, `CRON_SECRET`, no empty-secret bypass)
- Inbox: three-pane (thread list, messages + reply never blackout-blocked, contact pane: name, phone, opt-out, notes)
- Status webhooks: `sms_send_log` + `sms_delivery_events`; monotonic `sent` → `delivered`|`failed`
- `proxy.ts` treats `/api/sms/webhook` and `/api/cron/` as public (cron still checks Bearer)

### Signup bugs already fixed in production DB

1. `private.create_organisation` uses `extensions.gen_random_bytes` (pgcrypto lives in `extensions` on hosted Supabase).
2. `GRANT EXECUTE` on `private.user_is_org_member(uuid)` and `private.user_has_org_role(uuid, text[])` **to authenticated** — without this, org create succeeded then membership embed 403’d (`permission denied for function user_is_org_member`; Next digest looked like `ERROR 2203002760@E394`).
3. Auth callback default next is `/` (home routes to onboarding vs inbox). Members SELECT policy includes `user_id = auth.uid()`.

**Existing org:** `Reveille Test` / owner `troy@reveille.net.au`. Do not delete it.

Migrations on yarnhub (filenames must stay; never rewrite applied files; `supabase migration new` for follow-ups):

- `20260814010000_phase_a_foundations.sql`
- `20260814061927_phase_b_blasts.sql`
- `20260814063116_phase_b_send_log_grants.sql`
- `20260814064754_create_organisation_pgcrypto.sql`
- `20260814073159_rls_helper_grants.sql`

Align `supabase_migrations.schema_migrations.version` to the filename timestamp if MCP stamps a different version.

### Intentionally not in B (do not treat as regressions)

Soft claim, Realtime on `sms_messages`, blast pause/cancel/draft UI, canned replies, P2P/survey/relay **UI and runtime**. Kernels `src/lib/sms/{p2p,survey-engine,relay-engine}.ts` already exist and are tested.

---

## Commercial shape (context only — do not implement extra products)

Troy’s four use cases (Reveille):

1. **OA-style campaign app** (`oa.uconstruct.app`) — per-client MM account, assisted setup. **Different repo.** Do not touch OA.
2. **Yarnhub self-serve** — blast, survey, P2P, inbox (later maybe SMS chat agent). Individual signup, guided BYO MM. **This repo, Phases C–D.**
3. **Fee-for-service hosted** — Reveille’s MM account, several clients, route inbound on `to`. **Phase E.**
4. **Internal Reveille SMS** — dedicated number + Reveille alpha sender (alpha is outbound-only). Same Reveille MM account as (3), hosted routing.

**Ops plan (do not execute against OA):** OA will get its **own** MM account and move production connections there. The **existing Reveille MM account** is for Yarnhub/dev/FFS/internal. Hard part is **dedicated number transfer** (members have numbers saved) and whether STOP lists follow the number — flag it, don’t migrate OA yourself.

Until OA is off that account: test Yarnhub **outbound** with a spare API user + a number OA does not use; inbound via **mock** or a quiet webhook cutover. Never point production OA webhooks at Yarnhub. Never register OA’s live senders in Yarnhub.

Mobile Message (confirmed by their support, 2026-08-17): **one inbound URL and one status URL per account**; extra API keys share those URLs. BYO tenants each have their own MM account → `?org=` is correct. Distinct dedicated numbers split OA vs Yarnhub traffic via payload **`to`**, not `original_message_id` / `original_custom_ref` (those correlate a reply to an outbound inside one app). Yarnhub currently **400**s if `to` is not registered on that org — a fan-out proxy must not fail MM when the event is for someone else’s number.

---

## What to build (Phase C, in order)

Port behaviour from `seed/from-oa/` (UI + cron + webhook contracts). Rewrite all data keys to `organisation_id` + `contact_id`. No `campaign_id`, `worker_id`, `organiser`, assessments, wall chart, `is_sms_episode`.

### C1. P2P

- Working list of contacts, select subset, personalised opener, cap per send (OA was 50).
- Same sender-purpose belt as blast (`inboxUnsafePurposeError` / reject `survey`|`relay`).
- After send, conversation is normal inbox 1:1. Do not add `mode=p2p` on `sms_blasts` unless you must; prefer a small `sms_p2p_sends` (or equivalent) over overloading blasts.
- Reuse merge fields + `sendBatch` + opt-out re-check. Blackout: follow blast rules for the opener if you queue; 1:1 replies stay exempt.

Reference: `seed/from-oa/` p2p UI/hooks; kernel `src/lib/sms/p2p.ts`.

### C2. Surveys (largest)

- New tables/runtime for definitions, questions, invitations, **one live session per `(organisation_id, phone_e164)`** while state is invited/active.
- Keep: linear questions, invitation+Q1 as one send, retry ladder, launch overlap warning, deferred live-phone toast.
- Drop: campaign assessments, FWA ballot copy.
- Sender picker: prefer `purpose=survey`; warn on inbox; exclude relay.
- Cron: `/api/cron/sms-survey-timers` every 10 minutes, `CRON_SECRET`, Node, `proxy.ts` already allows `/api/cron/`.
- **Rewrite inbound** in `process-inbound.ts`: after STOP, consult live survey by **member phone** before inbox. Do not skip this or replies steal survey answers.

Kernel already in `src/lib/sms/survey-engine.ts`. Runtime in seed is the contract, not importable.

### C3. Relays

- One live relay per dedicated number. Attribution prefix; no CLI spoofing.
- Inbound: after STOP and live survey, live relay by **to-number**, then inbox.
- Moderation only if seed has it and time allows; else v1.1.

Kernel: `src/lib/sms/relay-engine.ts`.

### After C (only if user asks, or C exit is done and they say continue)

**Phase D:** invites, roles on destructive actions, canned replies, send/survey funnel reporting, audit of credential changes, org timezone default. Soft claim / Realtime can land here.

**Phase E (forbidden now):** webhook without `?org=` dispatching on `to` across orgs, Stripe, number pool, global send semaphore.

---

## Engineering constraints

- RLS on every exposed table; `private.user_is_org_member` — **keep EXECUTE granted to authenticated** (Phase B bug).
- Service role only for webhook + cron after HMAC / `CRON_SECRET`.
- Encrypt MM passwords. Never `NEXT_PUBLIC_` the service role.
- Node runtime for webhook HMAC (not Edge).
- Blast/P2P must not send from `purpose=survey|relay`.
- Org name in compliance is the **tenant** name, not “Yarnhub” or “Offshore Alliance”.
- New SQL: `pnpm dlx supabase migration new <name>`, apply to **yarnhub** only (MCP `apply_migration` project `tycqjkghdmizgbqgbkgg` is OK). Do not rewrite shipped migrations.
- `pnpm test` must stay green; add tests for survey uniqueness, inbound precedence, P2P sender belt, cron auth.
- UI: existing app chrome (`src/app/(app)/layout.tsx`, `src/components/app-page.tsx`, shadcn). Add nav items for P2P / Surveys / Relays.
- Next.js in this repo may differ from training data — read `node_modules/next/dist/docs/` / `AGENTS.md` before new routing APIs. `src/proxy.ts` is the auth gate (not `middleware.ts`).

---

## Dashboard / soak (Troy — do not block C on these, but mention in the summary)

Vercel Production should have: `NEXT_PUBLIC_SUPABASE_URL`, anon key, `SUPABASE_SERVICE_ROLE_KEY`, `SMS_CREDENTIALS_KEY`, `SMS_PROVIDER=mobile_message` for real sends, `NEXT_PUBLIC_APP_URL=https://yarnhub.reveille.net.au`, **`CRON_SECRET`**. Auth Site URL + redirects already documented in README. Cron only runs on production.

Chrome-extension console errors (`chrome-extension://…`) are the browser, not Yarnhub.

---

## How to work

1. Confirm you are in the Yarnhub repo and on current `main`.
2. Map seed survey/P2P/relay files to new schema; write migrations first.
3. Implement C1 → C2 (inbound precedence) → C3. Wire webhook once for the full STOP → survey → relay → inbox belt, with tests, before building all three UIs if that is safer.
4. Stop at Phase C exit. Summarise: what was added, how to run locally, MM webhook URL, what Troy must click in Vercel/MM, what was left (D/E, Realtime, hosted `to` router).
5. Do not start Phase E. Do not “fix” OA. Do not share numbers/JWT/webhook secrets with `oa.uconstruct.app`.

If something in A/B is actually broken (signup 403, cron, webhook HMAC), fix that first with a **new** migration or a small patch — then continue C.
