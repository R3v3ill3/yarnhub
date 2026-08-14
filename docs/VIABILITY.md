# Yarnhub — viability spec (standalone SMS product)

**Status:** Analysis only. Not an OA feature plan.  
**Date:** 2026-08-13 (names locked 2026-08-13)  
**Working name:** Yarnhub  
**Production URL:** https://yarnhub.reveille.net.au  
**GitHub:** https://github.com/R3v3ill3/yarnhub  
**Vercel project:** `yarnhub`  
**Supabase project:** `yarnhub`  
**Source of truth for OA SMS:** this repo (`apps/organising-db` SMS module, Phases 0–6 plus later surveys/P2P/episodes).  
**Intent:** seed Yarnhub from the OA SMS blast / inbox / P2P / survey / relay codebase, with its own user accounts, reachable by people who are **not** `oa.uconstruct.app` users, with **no** dependency on the OA Supabase project or OA campaign/worker model.

**Implementation pack (extract + Vercel/Supabase + agent prompt):** [`docs/standalone-sms-app/README.md`](./standalone-sms-app/README.md).

This document is meant to be copied into the Yarnhub repository. It should not drive OA schema or product decisions.

---

## 1. Verdict

**Viable — as a deliberate extract and rewrite of the data/tenancy layer, not as a lift-and-shift of organising-db.**

The SMS *engines* in this repo are already a real product: provider adapter, webhook precedence, blast queue, enduring inbox, P2P boards, reply-native surveys (including one-live-session-per-phone), and attributed relays. The OA “standalone SMS tools” work (hidden `is_sms_episode` campaigns) proved the **UX** can run without a real organising campaign. It did **not** prove the **data model** can: those episodes still live in OA’s `campaigns`, `workers`, and `can_write_to_campaign` world.

A public app is therefore:

| Layer | Reuse | Effort |
|---|---|---|
| Pure engines (survey parse/branch, relay attribution, conversation routing, GSM segments, compliance, blackout, Mobile Message client) | High — copy with light edits | Days to a couple of weeks |
| UI (composer, inbox, survey editor, P2P board, relays, launch warnings) | High — copy then strip OA chrome | 2–4 weeks |
| API routes, crons, RLS, auth | Low — rewrite against a tenant model | 4–8 weeks |
| Identity, contacts, billing, onboarding | New | 4–8 weeks |
| Provider commercial model (BYO vs hosted numbers) | New policy + some code | 2–6 weeks depending on model |

**Do not fork the whole OffshoreAlliance monorepo.** Yarnhub is https://github.com/R3v3ill3/yarnhub. Copy a defined file set into that repo, replace `campaign_id` / `worker_id` / `organisers` with `organisation_id` / `contact_id` / membership. After that, the two products diverge on purpose.

**Recommended commercial shape for v1:** BYO Mobile Message account (user pastes API credentials + dedicated numbers). Optionally add a **hosted credit + number pool** later, sitting in front of *your* Mobile Message account. Do **not** wait for a Mobile Message white-label portal — they state they do not offer one and have no plans to.

---

## 2. What OA already has (the asset)

Implemented in `apps/organising-db`, dispatched from a single webhook and two Vercel crons.

### 2.1 Tools (map 1:1 onto the new product)

| Tool | OA behaviour worth keeping | OA coupling to drop |
|---|---|---|
| **Blast** | Draft → queue → cron drain; GSM/UCS-2 counter; org-name compliance; 09:00–20:00 blackout with recorded override; opt-out re-check at send; delivery webhooks | `sms_lists.campaign_id`, `campaign_comms_drafts`, `workers`, fire-from-wall-chart |
| **Enduring inbox** | Thread key conceptually `(our number, member phone)`; Spoke-style states; soft claim; presence; notes; canned replies; replies never blackout-blocked | Thread uniqueness currently `(our_number_id, phone_e164, campaign_id)`; worker sidebar; assessments → `campaign_activity_ratings` |
| **P2P chat** | Working list, pick rows, send personalised opener, then 1:1 in inbox; reject survey/relay sender numbers | Same list/campaign/worker FKs; campaign-scoped conversations |
| **Surveys** | Linear authoring + branch; invitation+Q1 as one send; session machine; retry ladder; one live session per phone; launch preview of overlap / deferred invites | `sms_surveys.campaign_id`; sessions keyed to `worker_id`; assessment/rating write-back; indicative-ballot FWA framing (OA-specific) |
| **Relays** | Dedicated number; member→target forward with attribution prefix; target replies bridge back; not true CLI spoofing (ACMA) | Optional `campaign_id`; organiser assignment |

### 2.2 Hard-won routing rules (keep)

Inbound webhook precedence (already production logic):

1. STOP / unsubscribe (provider + in-app keyword belt)  
2. Live survey session **by member phone** (not by destination number)  
3. Ballot revote (OA-specific; optional in the new app)  
4. Live relay on the **to-number** (`purpose=relay`)  
5. Inbox thread on `(our_number, phone, …)`

Blast/chat must not send from `purpose=survey|relay` or replies never reach Inbox. Surveys prefer `purpose=survey` numbers; organiser numbers work with a warning.

Mobile Message is **account-level webhooks** (one inbound URL, one status URL). OA already routes internally off the payload `to` field. That design is exactly what a **hosted multi-tenant** pool needs. BYO tenants instead point *their* MM account webhook at a URL that identifies *their* tenant.

### 2.3 What “standalone SMS” in OA is *not*

Hidden campaigns (`campaigns.is_sms_episode`) were a compatibility shim so existing NOT NULL `campaign_id` FKs and conversation uniqueness did not have to be torn up. A new app should **not** copy that pattern. Contacts, lists, blasts, surveys, relays, and conversations should hang off an **organisation**, not a fake campaign.

---

## 3. What a public app must add (the actual product)

OA is a **single-tenant organising CRM** with staff logins. Yarnhub is a **multi-tenant messaging product**.

Must exist before any non-OA user can use it:

1. **Organisations (workspaces)** with roles (owner / admin / member).  
2. **Public signup** (email/password + magic link or OAuth). No OA staff table, no `oa.uconstruct.app` session.  
3. **Contacts** (name, mobile E.164, opt-out, custom fields) — not `workers`.  
4. **Contact lists** the user owns — CSV/paste is enough for v1; no match-against-OA-membership.  
5. **Per-tenant SMS credentials and numbers** (see §5).  
6. **Tenant isolation** on every table (RLS or equivalent). A webhook for tenant A must never write tenant B’s inbox.  
7. **STOP scoped to that tenant’s sending identity** (and, for hosted, to your platform).  
8. **Terms, Spam Act / ACMA posture, acceptable-use, kill-switch** for abusive tenants.

Nice-to-have later (do not block v1): tags, custom fields UI, team inbox assignment, usage billing, alphanumeric sender IDs, non-AU destinations, AI categorisation of open-text survey answers.

OA features that should **not** ship in v1 of the public app:

- Campaign assessments / wall chart / sequences  
- Indicative ballots framed as FWA industrial ballots (keep a generic “poll” mode if you want receipts + freeze-roll; drop AEC/FWC copy)  
- Organiser-assigned numbers as a staff HR concept  
- Hidden episode campaigns  

---

## 4. Coupling map — why you cannot “just point at a new Supabase”

These are structural, not cosmetic.

| Coupling | Where | Why it blocks a public app |
|---|---|---|
| `campaign_id` NOT NULL on `sms_lists`, `sms_surveys` | schema + almost every SMS route | Public users have no campaigns |
| Conversation UNIQUE `(our_number_id, phone_e164, campaign_id)` | `sms_conversations` | Splits one human thread per campaign; new app wants one thread per (org, number, phone) |
| `worker_id` on list items, sessions, messages | schema + populate + webhook | Audience is OA’s membership graph |
| `can_write_to_campaign` RLS | all SMS policies | Authorisation is campaign staff, not org membership |
| `sms_numbers.organiser_id` → `organisers` | foundations migration | Numbers belong to OA staff, not tenants |
| Single `app_settings` Mobile Message username/password | `getSmsProvider()` | One provider account for the whole app |
| `getSmsProvider()` singleton | `lib/sms/provider/index.ts` | Must become `getSmsProviderForOrg(orgId)` (or for a number) |
| Assessments / `trg_sms_to_rating` | surveys + inbox sidebar | Writes OA campaign ratings |
| Auth | Supabase Auth users who are OA staff | Public users must not enter the OA project |
| Cron + webhook on OA Vercel project | `vercel.json`, `/api/sms/webhook` | New hostname, new secrets, new DB |

**Independent development is only real after those FKs are gone.** Sharing a database “but hiding OA tables” still couples releases, RLS, and incident response. Use a **separate Supabase project** (or other DB) from day one.

---

## 5. How users get an SMS pipe — three approaches

Mobile Message (current provider) facts that constrain the design:

- REST API, dedicated numbers, inbound + status webhooks, HMAC, STOP handled platform-side, batch send up to 10 000, **5 concurrent HTTP requests per account**.  
- **No number-provisioning API** — numbers are bought in their dashboard (first often free with credit purchase; extras ~$100+GST/year).  
- **One inbound webhook URL and one status URL per MM account.**  
- **No white-label / reseller portal, and they say there are no plans to add one** ([help centre FAQ](https://help.mobilemessage.com.au/faqs/do-you-have-a-whitelabel-reseller-service)).  
- They **do** market a “software platforms” pattern: you integrate the API once, give *your* customers dedicated numbers or sender names, and keep your own UI ([software platforms](https://mobilemessage.com.au/sms-for/software-platforms)). That is hosted-by-you, not a cloned MM dashboard.

`SmsProvider` in OA already exists so a second provider (Twilio, MessageMedia, ClickSend, etc.) is an adapter, not a rewrite of surveys/inbox.

### 5.1 BYO — user brings their own Mobile Message (or other) API + numbers

**How it works:** At signup, the org pastes API username/password (or API key) and a webhook secret. They buy dedicated numbers in the provider dashboard. In your app they register those numbers and set purpose (inbox / survey / relay / spare). They set the provider’s webhook URLs to:

`https://yarnhub.reveille.net.au/api/sms/webhook?org={org_public_id}`

(plus HMAC). You store credentials encrypted per org. `getSmsProviderForOrg` uses those creds. Inbound `to` must match a number owned by that org.

**Pros**

- Lowest legal/operational load on you: they hold the carrier account, credits, and ACMA sender registration.  
- Concurrency limit (MM’s 5 in-flight requests) is **per tenant**, so noisy neighbours do not stall everyone.  
- Webhook isolation is natural (their account → their URL).  
- You are not a reseller; you sell software.  
- Matches how OA works today (one account, credentials in settings) — smallest code change to the provider layer.  
- Easy to add “connect Twilio” later without changing billing.

**Cons**

- Onboarding friction: leave the app, sign up with MM, buy a number, paste keys, paste webhook URL.  
- Number purchase cannot be completed inside your UI (no MM number API).  
- Support burden: “why isn’t my webhook firing?”  
- You cannot easily meter or mark up SMS.  
- Some users will refuse to create a second vendor account.  
- You must encrypt credentials (KMS or Supabase Vault), never store MM passwords in `app_settings`-style plaintext like OA.

**Fit:** Best **default for v1**. Unions, NGOs, agencies, and small orgs who already have (or can get) an MM account.

### 5.2 In-app setup — connect or provision numbers through your UI

Two different things are often conflated:

**A. Guided connect (still BYO)**  
Wizard: create MM account (link out) → create API key → buy number in MM → paste number → `GET /v1/senders` to verify it belongs to those credentials → show the exact webhook URL to paste. This is still 5.1, with better UX. **Do this in v1.**

**B. True in-app provisioning**  
Your backend calls a provider API to purchase a number and attach it to the tenant. **Mobile Message cannot do this today.** Options:

- Stay on MM and accept a **human ops step** (you or the user buy the number in MM, then attach).  
- Add a provider that *has* a Numbers API (Twilio, some aggregators). That is a second adapter + AU delivery/pricing work.  
- Hosted pool (5.3): you pre-buy numbers on *your* MM account and assign them in the UI. That *looks* like in-app setup to the user.

**Pros of aiming at in-app provisioning later**

- Activation in minutes; higher conversion.  
- You control the inventory of 2-way numbers.  
- Purpose assignment (inbox vs survey vs relay) stays in-app — OA already has this UX.

**Cons**

- Not available on MM without you in the middle.  
- If you switch to Twilio-class APIs: higher AU cost, more compliance surface, rewrite of webhook signatures (adapter is ready; ops is not).  
- If you fake it with manual MM dashboard work, it does not scale past a handful of tenants.

**Fit:** Ship **guided connect** immediately. Treat **automatic number purchase** as a phase-2 provider decision, not a v1 blocker.

### 5.3 Subscription that “white-labels” Mobile Message (hosted credits + numbers)

**Reality check:** You cannot resell the Mobile Message *product UI*. You *can* sell *your* product and send through **your** MM account, assigning dedicated numbers from a pool you bought, and charging a subscription and/or per-message markup. MM’s own “software platforms” page describes that pattern (“numbers for your clients”, “let your users send their own marketing from inside your product”).

**How it works:**

- You hold one (or a few) MM accounts.  
- You buy a pool of dedicated numbers; `sms_numbers.organisation_id` assigns them.  
- Single webhook URL (as OA has now); dispatch on `to` → number → org.  
- You sell plans (e.g. included credits + overage). You top up MM; you bill Stripe.  
- KYC / ABN / acceptable-use before a number is assigned.  
- Instant suspend: retire the number and stop `sendBatch` for that org.

**Pros**

- Lowest friction for non-technical users.  
- One relationship to MM; you keep the margin.  
- Matches OA’s current webhook architecture almost exactly.  
- You can productise “inbox number / survey number / relay number” as SKUs.  
- Branding is entirely yours.

**Cons**

- **You** are the MM account holder. Spam, STOP failures, or a tenant blasting purchased lists can get **your** account shut down. You need aggressive rate limits, content checks, and a panic switch.  
- MM **5 concurrent requests is account-wide**. All hosted tenants share one throttle. This is the main technical reason not to put *all* volume on one MM account. Mitigations: several MM accounts (pool by plan), a send queue with a global semaphore (OA already has an in-process semaphore — that becomes a **Redis/DB lease** in multi-instance), or BYO for heavy users.  
- No MM subaccounts: credits, logs, and webhooks are mixed; **your** DB is the source of truth for who sent what.  
- Number purchase remains manual/ops unless you staff it.  
- ACMA / Spam Act: you must document that the **tenant is the sender**; you are the intermediary. Get legal advice before charging for hosted sends.  
- You float GST, failed-payment risk, and credit expiry (MM credits do not expire — good — but your Stripe invoices do).  
- Support becomes “SMS not delivering” for people who never heard of Mobile Message.

**Fit:** Strong **paid tier after** BYO is stable. Do not make hosted-only v1 unless you are staffed for abuse ops and have legal cover.

### 5.4 Recommendation

| Phase | Model |
|---|---|
| **MVP** | BYO MM + guided connect wizard + purpose assignment. Optional mock provider for demos. |
| **v1.1** | Hybrid: hosted starter (you assign one inbox number from a small pool, prepaid credits) **or** BYO for volume users. |
| **Later** | Second provider adapter if you need API number purchase or non-AU. Still no dependency on an MM reseller portal. |

Do not build a fake “Mobile Message dashboard clone.” The value is blast + inbox + P2P + survey + relay, which MM does not offer as one product.

---

## 6. Target architecture (Yarnhub)

```
[Browser] → https://yarnhub.reveille.net.au  (Vercel project yarnhub)
                │
                ├─ Auth: Supabase Auth (project yarnhub)
                ├─ DB:  Postgres + RLS (project yarnhub)
                ├─ Realtime: inbox messages / presence
                └─ Crons: dispatch-sms-queue, sms-survey-timers
                          (Vercel cron on production)
[Provider]
   BYO:  per-org Mobile Message account
         webhook https://yarnhub.reveille.net.au/api/sms/webhook?org=
   Hosted (later): Yarnhub MM account(s), webhook dispatch on `to` number
```

### 6.1 Suggested schema (conceptual)

- `organisations`, `organisation_members` (user_id, role)  
- `contacts` (org_id, phone_e164 unique per org, sms_opt_out, name, fields jsonb)  
- `contact_lists`, `contact_list_members`  
- `provider_accounts` (org_id, provider, encrypted credentials, webhook secret, mode=`byo`|`hosted`)  
- `sms_numbers` (org_id, phone_e164 unique **global**, purpose, provider_account_id)  
- `sms_blasts` / `sms_blast_items` (no campaign_id; body on the blast row, not `campaign_comms_drafts`)  
- `sms_conversations` UNIQUE `(organisation_id, our_number_id, phone_e164)`  
- `sms_messages`, notes, canned replies (org-scoped)  
- `sms_surveys`, questions, sessions (`contact_id`), answers  
- `sms_relays`, targets, moderation queue  
- `sms_send_log`, `sms_delivery_events` (keep idempotency unique keys)

**One live survey session per phone** should be **per organisation** (partial unique on `(organisation_id, phone_e164)` where live). OA’s current unique is global-by-phone because OA is one org. In a public app, two charities must be able to survey the same mobile.

**Relay:** keep “one live relay per number” (already number-scoped).

### 6.2 Auth

- Auth on Supabase project **`yarnhub`**. OA users who want both products get **two accounts** (or a later optional SSO). Do not share JWT audience with `oa.uconstruct.app`. Site URL: `https://yarnhub.reveille.net.au`.  
- Invite links for team members of an org.  
- Service role only for webhook + crons, same house pattern as OA.

### 6.3 Database: Supabase vs alternatives

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Supabase project `yarnhub`** | Same stack as the code you are copying (RLS, Auth, Realtime presence); team already operates Supabase; inbox already assumes `postgres_changes` | Another project to run; two products to migrate | **Default. Best fit.** |
| Neon / RDS Postgres + Clerk/Auth.js | Fine Postgres; Auth.js if you want to leave Supabase Auth | You must replace Realtime (inbox presence) and RLS tooling; more glue | Only if you are exiting Supabase on purpose |
| PlanetScale / MySQL | Unfamiliar; no PG partial unique indexes as used for live survey sessions | Would force session-lock redesign | No |
| Firebase | Auth/hosting easy; SMS session state and SQL reporting are a poor fit | Fight the engines you already wrote | No |
| Multi-tenant schema in **OA** DB | Tempting | Couples incidents, backups, RLS, and GDPR/erasure to the union CRM | **Hard no** |

User-facing “no database setup” is satisfied by **you** hosting Supabase. Tenants never see SQL.

### 6.4 Hosting

Yarnhub: Vercel project **`yarnhub`**, domain **yarnhub.reveille.net.au**, Fluid/Node, crons, 300s function budget for survey open. Database: Supabase project **`yarnhub`**. Keep `SmsProvider.sendBatch` timeouts; hosted mode needs a **distributed** semaphore, not only the in-module one in `mobile-message-provider.ts`.

---

## 7. How to access this code and start Yarnhub

Yarnhub lives at https://github.com/R3v3ill3/yarnhub (private). The SMS module in OA is not a package; it is woven through `apps/organising-db`. Follow [`docs/standalone-sms-app/EXTRACT_GUIDE.md`](./standalone-sms-app/EXTRACT_GUIDE.md) for the exact clone / `create-next-app` / extract commands.

### 7.1 Do not

- Fork the OA monorepo and delete the rest (history, secrets patterns, turbo, OA apps, scraper, employer-matching).  
- `git submodule` OA into Yarnhub (forces coupled clones and leaky imports).  
- Publish `@oa/sms` from this monorepo on day one (premature; the types still say `worker_id`).  
- Copy `supabase/migrations` wholesale (they `ALTER workers` and `REFERENCES campaigns`).  
- Copy `.env`, `app_settings` production credentials, or webhook tokens.

### 7.2 Do

1. Clone **https://github.com/R3v3ill3/yarnhub** (already created). MIT or proprietary — same owner as OA; keep a `NOTICE` listing files copied from OffshoreAlliance.  
2. Scaffold **Next.js App Router + TypeScript + Tailwind + shadcn** in that clone (see extract guide).  
3. Create Supabase project **`yarnhub`**; write **new** migrations from the conceptual schema in §6.1. Use OA migrations only as a **checklist of columns and indexes**, not as files to apply.  
4. Run `docs/standalone-sms-app/extract-sms-seed.sh` pointed at the Yarnhub clone. Search-replace remaining `worker_id` → `contact_id`, drop `campaign_id`, replace `can_write_to_campaign` with `is_org_member`.  
5. Bring tests that are **pure** (`survey-engine`, `relay-engine`, `conversation-routing`, `segments`, `compliance`, `blackout`, `p2p` render, webhook parse). Rewrite fixtures that insert workers.  
6. Point a sandbox Mobile Message account at `https://yarnhub.reveille.net.au/api/sms/webhook?org=…`. Do not reuse OA’s production sender numbers.  
7. After the first green send+reply in Yarnhub, **stop reading OA for implementation details** except when porting a specific bugfix. Dual maintenance is copy-by-hand, not a shared branch.

### 7.3 File inventory (copy vs rewrite vs leave)

**Copy almost as-is** (engines — the IP):

- `apps/organising-db/src/lib/sms/provider/types.ts`  
- `apps/organising-db/src/lib/sms/provider/mobile-message-provider.ts`  
- `apps/organising-db/src/lib/sms/provider/mock-provider.ts`  
- `apps/organising-db/src/lib/sms/survey-engine.ts`  
- `apps/organising-db/src/lib/sms/relay-engine.ts`  
- `apps/organising-db/src/lib/sms/segments.ts`  
- `apps/organising-db/src/lib/sms/compliance.ts`  
- `apps/organising-db/src/lib/sms/blackout.ts`  
- `apps/organising-db/src/lib/sms/p2p.ts` (render helpers)  
- `apps/organising-db/src/lib/sms/sender-purpose.ts`  
- `apps/organising-db/src/lib/sms/conversation-routing.ts` (then drop campaign from the decision type)  
- `apps/organising-db/src/lib/phone/normalise-phone.ts`  
- Matching `__tests__` next to those files  

**Copy then rewrite I/O** (keep control flow, new queries):

- `survey-runtime.ts`, `survey-invitation-dispatch.ts`, `survey-concurrency.ts`  
- `relay-runtime.ts`, `relay-route-helpers.ts`  
- `webhook/route.ts` (precedence is the spec)  
- `cron/dispatch-sms-queue`, `cron/sms-survey-timers`  
- `populate-sms-list.ts` → populate from `contacts`  

**Copy UI, strip OA:**

- `components/sms/SmsComposer.tsx`  
- `components/sms/inbox/*` (drop or stub `SmsAssessmentPanel`)  
- `components/sms/surveys/*` (drop assessment linking; keep launch overlap warnings)  
- `components/sms/p2p/*`  
- `components/sms/relays/*`  
- Audience picker **only** if you generalise it off `worker_lists`; otherwise a simpler CSV/list picker  

**Do not copy:**

- `sms-episode.ts`, episode API, hidden campaigns  
- `assessment-mapping.ts`, ballot FWA banners (optional generic poll later)  
- `fire/sms` wall-chart route  
- `can_write_to_campaign` usage, campaign layouts, worker record SMS history as OA page  
- Admin MM settings that write global `app_settings`  
- TestSprite, OA product spec, `.claude/`  

### 7.4 Practical copy command (for the human doing the extract)

From a clone of OffshoreAlliance, after Yarnhub is cloned and scaffolded:

```bash
./docs/standalone-sms-app/extract-sms-seed.sh /Volumes/DataDrive/cursor_repos/yarnhub
```

Full sequence: [`docs/standalone-sms-app/EXTRACT_GUIDE.md`](./standalone-sms-app/EXTRACT_GUIDE.md). Prefer a tracked `seed/from-oa/MANIFEST.md` (OA git SHA). You do not need `git filter-repo`.

### 7.5 Ongoing independence

| | OA (`oa.uconstruct.app`) | Yarnhub (`yarnhub.reveille.net.au`) |
|---|---|---|
| Git | `OffshoreAlliance` `main` / `develop` | https://github.com/R3v3ill3/yarnhub |
| DB | OA DEV/PROD Supabase | Supabase project `yarnhub` |
| Hosting | OA Vercel project | Vercel project `yarnhub` |
| Users | Organising staff | Anyone who signs up |
| SMS numbers | OA’s MM account | Tenant BYO and/or later a Yarnhub pool |
| Bugfixes | Cherry-pick by hand if the engine is still shared in spirit | No submodule |

If, six months in, the engines are still identical, *then* consider a private npm package `@yourorg/sms-engines` used by both. Creating that package **first** would slow both products. OA should keep shipping on its campaign model without waiting for the public app.

---

## 8. Establishing process (phases)

Assumes one small team that already knows this codebase. Calendar time, not person-weeks stacked.

### Phase A — Foundations (≈ 2–3 weeks)

Empty Yarnhub repo (after extract), auth, orgs, contacts, encrypted `provider_accounts`, guided MM connect, `sms_numbers` with purposes, mock + real `sendBatch` test page, webhook HMAC + `to` → org routing, STOP → contact opt-out.

**Exit:** You can send an SMS from a BYO number and see the reply in a thread.

### Phase B — Blast + inbox (≈ 2–3 weeks)

Port composer, queue, dispatch cron, blackout, delivery events, three-pane inbox, claims. No campaigns.

**Exit:** CSV list → blast → replies land in an enduring inbox.

### Phase C — P2P, surveys, relays (≈ 3–5 weeks)

Port P2P board, survey engine + runtime + timers cron + launch overlap UX, relays. Per-org live-session unique. No assessment write-back.

**Exit:** All five tools work for a single BYO org.

### Phase D — Multi-user polish (≈ 2 weeks)

Invites, roles, canned replies, reporting (delivered / replied / survey funnel), audit log of sends.

### Phase E — Hosted pipe (optional, ≈ 3–6 weeks)

Stripe, credit ledger, number pool assignment, global send semaphore, abuse limits, legal review. Only after Phase C is boringly stable.

### Parallel (non-code)

- Talk to Mobile Message as a “software platform” (hosted numbers for your clients) even though they have no reseller UI. Confirm webhook, concurrency, and number-ops expectations at your volume.  
- Legal: Spam Act (consent, STOP, identification), ACMA SMS Sender ID, who is the “sender” on hosted, Privacy Act / APP for contact lists, acceptable use.  
- Name, domain, and positioning (this is not OA and must not scrape OA members).

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Treating extract as “copy the Next app and change the URL” | High | New schema first; OA FKs never exist in the new DB |
| Hosted tenants share one MM 5-request cap | High | BYO for volume; multiple MM accounts; distributed queue |
| Hosted tenant burns your MM reputation | High | KYC, caps, content policy, instant suspend |
| Conversation unique still includes a campaign-like column | Medium | Thread key `(org, number, phone)` from migration 1 |
| Live survey unique still global-by-phone | Medium | Unique `(org_id, phone)` for live states |
| Copying OA plaintext credential pattern | Medium | Encrypt at rest; never log provider passwords |
| Dual-running engines drift (survey parse bug fixed in one repo only) | Medium | `EXTRACT.md` + occasional manual port; package later if painful |
| Number provisioning bottleneck | Medium | Guided BYO; hosted pool sized ahead of sales |
| Scope creep (full CRM, email, calling) | High | Five SMS tools + contacts only for v1 |
| OA production numbers/webhooks pointed at the new app | High | Separate MM sandbox; never share `sms_webhook_token` |

---

## 10. What success looks like

A person with no OA login can, at https://yarnhub.reveille.net.au:

1. Create an account and an organisation.  
2. Connect Mobile Message (or be assigned a hosted number).  
3. Import contacts.  
4. Send a blast, hold a 1:1 inbox conversation, run a P2P board, launch a survey, and stand up a relay.  
5. Have STOP respected for **their** org without affecting OA or other tenants.  
6. Never touch Supabase, never see `campaigns` or `workers`.

OA continues on `oa.uconstruct.app` with its own MM account, workers, and campaigns. Yarnhub continues on `yarnhub.reveille.net.au`. The two codebases share ancestry, not a runtime.

---

## 11. Bottom line

The SMS module here is **good enough to be the kernel of a standalone product**. The engines and UI are the asset. The OA database, auth, campaigns, workers, and single global provider account are the liability.

**v1:** Yarnhub repo, Supabase project `yarnhub`, Vercel project `yarnhub`, BYO Mobile Message, five tools, contacts + lists.  
**v1.1:** optional hosted numbers/credits on *your* MM account (software-platform pattern, not a white-label MM).  
**Never:** one database for both products, or waiting for Mobile Message to ship a reseller portal.
