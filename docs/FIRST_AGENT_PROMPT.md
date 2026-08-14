# First prompt — paste this in a **new** Cursor chat

**Workspace:** the **Yarnhub** repo — https://github.com/R3v3ill3/yarnhub — not OffshoreAlliance.  
**If the folder on the left is still `OffshoreAlliance`, stop and File → Open Folder on the Yarnhub clone** (suggested path `/Volumes/DataDrive/cursor_repos/yarnhub`).

---

You are implementing **Yarnhub** (https://yarnhub.reveille.net.au) in this repository. GitHub is `R3v3ill3/yarnhub`. Hosting is Vercel project **`yarnhub`**. Database/auth is Supabase project **`yarnhub`**. Do not use any Offshore Alliance Supabase project.

Read `CLAUDE.md`, then `docs/IMPLEMENTATION_PLAN.md`, then `docs/VIABILITY.md` if it exists, then `seed/from-oa/MANIFEST.md`. Follow those docs; do not invent a campaign/worker model.

**v1 is BYO Mobile Message only** (guided connect: paste API credentials, register dedicated numbers the user bought in the Mobile Message dashboard, show them the webhook URL). Production webhook base:

`https://yarnhub.reveille.net.au/api/sms/webhook?org=<org_public_id>`

Do not build hosted credits, Stripe, or a number pool.

**Start with Phase A only** from the implementation plan:

1. Make the copied engines usable: `getSmsProviderForOrg` (env mock + per-org decrypted credentials — OA’s `provider/index.ts` in seed is the wrong shape), parameterise `validateSmsBody(body, orgName)`, slim merge fields so `p2p.ts` does not depend on OA campaign tokens. `pnpm test` should run the engine unit tests.
2. New Supabase migrations **on project yarnhub** (do not apply OA SMS SQL): organisations, members, contacts, provider_accounts, sms_numbers, conversations/messages enough for a single thread. RLS everywhere.
3. Auth (email) + first-org-on-signup. Auth Site URL is `https://yarnhub.reveille.net.au`.
4. Settings UI: save BYO MM credentials (encrypted with `SMS_CREDENTIALS_KEY`), verify via `listSenders` / balance, attach a number, display webhook URLs using `NEXT_PUBLIC_APP_URL` (default `https://yarnhub.reveille.net.au`).
5. `POST /api/sms/webhook` — HMAC per org, isolate by `org` query param + inbound `to` number, STOP → opt-out, else append to `(organisation_id, our_number_id, phone_e164)`.
6. A test-send control and a minimal thread view proving inbound.

Do not port blast/survey/relay/P2P UI until a test SMS has been sent and a reply has landed in a thread (mock provider is enough in dev).

Never import from `seed/from-oa/` in app code; that tree is reference for later phases.

When Phase A’s exit criteria are met, stop and summarise what to run locally (env vars, webhook URL, MM dashboard steps). Wait for me before Phase B.
