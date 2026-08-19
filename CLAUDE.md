# Yarnhub — agent context

You are implementing **Yarnhub**, not Offshore Alliance (OA) organising-db.

| | Yarnhub (this repo) | OA (do not touch) |
|---|---|---|
| GitHub | https://github.com/R3v3ill3/yarnhub | OffshoreAlliance |
| Production URL | https://yarnhub.reveille.net.au | oa.uconstruct.app |
| Vercel | project `yarnhub` | OA organising-db |
| Supabase | project `yarnhub` | OA DEV/PROD |

This repo was scaffolded with Next.js and seeded with SMS **engines** copied from OA. Do not add OA as a git remote, submodule, or shared package.

Read in this order: this file → `docs/IMPLEMENTATION_PLAN.md` → `docs/SMS_ALIGNMENT_BRIEF.md` → `docs/SMS_CATCHUP_PLAN.md` → `docs/VIABILITY.md` (if present) → `seed/from-oa/MANIFEST.md`.

---

## What this product is

A multi-tenant web app at **https://yarnhub.reveille.net.au** where **anyone** can sign up, connect **their own Mobile Message** API + dedicated numbers, and run:

1. **Blasts** — queued bulk SMS, compliance, quiet hours  
2. **Inbox** — enduring 1:1 threads  
3. **P2P chat** — pick people from a list, send a personalised opener, then 1:1  
4. **Surveys** — reply-native, session machine, one live session per org+phone  
5. **Relays** — attributed forward through a dedicated number (not CLI spoofing)

**v1 sending model is BYO only.** Users paste Mobile Message credentials and register numbers they bought in MM’s dashboard. A guided wizard is required. Hosted/white-label credits on *our* MM account is Phase E — do not build it now.

Mobile Message has **no reseller portal**. Number purchase has **no API**. Account-level webhooks (one inbound URL per MM account) are multiplexed with `?org=<org_public_id>` for BYO. Production webhook base:

`https://yarnhub.reveille.net.au/api/sms/webhook?org=<org_public_id>`

---

## What was copied from OA

| Path | Treat as |
|---|---|
| `src/lib/sms/provider/mobile-message-provider.ts`, `types.ts`, `mock-provider.ts` | Kernel — keep |
| `src/lib/sms/survey-engine.ts`, `relay-engine.ts`, `segments.ts`, `blackout.ts`, `sender-purpose.ts`, `conversation-routing.ts` | Kernel — keep; drop `campaign_id` from routing types when you rewrite webhook |
| `src/lib/sms/compliance.ts` | Kernel — **must** take tenant org name, not `/offshore alliance/i` |
| `src/lib/sms/p2p.ts`, `src/lib/comms/template-variables.ts` | Kernel + temporary OA merge-field list — slim to contact fields |
| `src/lib/phone/normalise-phone.ts` | Kernel |
| `seed/from-oa/` | **Reference only.** Still full of `campaign_id` / `worker_id`. Never import from `app/` or `src/app/` |

There is **no** usable `getSmsProvider()` in `src/` yet (OA’s version reads global `app_settings` via a service-role client). You must write per-org lookup.

Do **not** apply OA `supabase/migrations/*sms*.sql`. Write new migrations for the schema in `docs/IMPLEMENTATION_PLAN.md`.

---

## Hard rules

- No `campaigns`, `workers`, `organisers`, `can_write_to_campaign`, assessments, wall chart, or `is_sms_episode`.
- Auth: Supabase Auth on project **`yarnhub`**. Org membership in a table; never authorize from `user_metadata`.
- RLS on every exposed table. Service role only for webhook + cron after verifying HMAC or `CRON_SECRET`.
- Conversation unique: `(organisation_id, our_number_id, phone_e164)`.
- Live survey unique: `(organisation_id, phone_e164)` where state is invited/active.
- Inbound order: STOP → START/UNSTOP → live survey by **member phone** → live relay by **to-number** → inbox.
- Blast/P2P: reject sender `purpose` `survey` or `relay`.
- Encrypt MM passwords (`SMS_CREDENTIALS_KEY`). Never `NEXT_PUBLIC_` the service role.
- Node runtime (not Edge) for webhook HMAC.
- Independent of `oa.uconstruct.app`. No shared JWT, no shared numbers, no shared webhook token. App URL is `https://yarnhub.reveille.net.au`.

---

## Stack

- Next.js App Router (`src/app`), TypeScript, Tailwind, shadcn, TanStack Query, Vitest  
- Vercel project **`yarnhub`** (Fluid/Node, Sydney if possible, crons on production only)  
- Domain **yarnhub.reveille.net.au**  
- Supabase project **`yarnhub`** (Postgres + Auth + later Realtime)  
- Provider: Mobile Message via `SmsProvider`; mock for tests/dev  

---

## Build order

Follow `docs/IMPLEMENTATION_PLAN.md`. **Start at Phase A.** Do not port survey UI before a test SMS round-trips.

Phase A exit: signup → org → BYO credentials → register number → test send → inbound webhook creates/attaches a thread.

Then B (blast + inbox), C (P2P, surveys, relays), D (invites/reporting). Phase E (hosted MM) is forbidden until the user asks.

---

## Git

- This is https://github.com/R3v3ill3/yarnhub. Normal feature commits on the default branch unless the user says otherwise.
- Do not commit `.env.local`, service role keys, or MM passwords.
- Do not copy more files from OA unless the user points at a specific bugfix.

---

## Product copy

Do not hardcode “Offshore Alliance” or “Yarnhub” as the SMS sender identity. Each tenant organisation has a `name` used in compliance checks. STOP must still work (provider + keyword belt). The product brand is Yarnhub; the legal sender on a blast is the tenant.
