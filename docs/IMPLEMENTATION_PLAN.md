# Implementation plan — Yarnhub (recommended approach)

**Product:** Yarnhub — multi-tenant SMS tools (blast, enduring inbox, P2P chat, surveys, relays).  
**Production URL:** https://yarnhub.reveille.net.au  
**GitHub:** https://github.com/R3v3ill3/yarnhub  
**Vercel project:** `yarnhub`  
**Supabase project:** `yarnhub`  
**v1 commercial model:** BYO Mobile Message (guided connect). Hosted numbers/credits are **out of scope** until Phase E.  
**Runtime:** Next.js on Vercel, Postgres+Auth+Realtime on the **yarnhub** Supabase project (not OA).  
**Code origin:** engines copied from Offshore Alliance organising-db; data model and auth are new.

Read `docs/VIABILITY.md` (copied from OA) for why. This file is the original build order (A–E). **Catch-up work to match current OA SMS operator UX** is `docs/SMS_ALIGNMENT_BRIEF.md` + `docs/SMS_CATCHUP_PLAN.md` — do that instead of re-scaffolding A–C.

---

## Non-negotiables

1. No `campaign_id`, `worker_id`, `organisers`, `can_write_to_campaign`, or hidden `is_sms_episode` campaigns.
2. No connection to OA Supabase projects (Yarnhub uses project `yarnhub` only).
3. Conversation uniqueness: `(organisation_id, our_number_id, phone_e164)`.
4. One live survey session per `(organisation_id, phone_e164)`, not global-by-phone.
5. Blast/chat senders cannot use `purpose=survey|relay`.
6. Inbound precedence: STOP → live survey (by phone) → live relay (by to-number) → inbox.
7. Org name in blast bodies is **that tenant’s name**, not “Offshore Alliance”.
8. Provider credentials are **per organisation**, encrypted at rest. `getSmsProvider(orgId)` (or by number), never a process-wide `app_settings` singleton.
9. Do not import `seed/from-oa/` from application code. Port, then delete seed when a tool has been rewritten.
10. Independent git history from OA after the extract commit.

---

## Phase A — Foundations (target: first send + first reply)

**Exit:** A signed-in user in an organisation can save BYO Mobile Message credentials, register a dedicated number, send a test SMS, and see an inbound reply attached to a thread. Mock provider works in dev without MM.

### A1. Auth + organisations

- Email signup/login (Supabase Auth).
- `organisations`, `organisation_members` (`owner` | `admin` | `member`).
- First login creates an org or join-via-invite later.
- Helper `requireOrgMember()` on every API route. RLS using `organisation_id IN (select … where user_id = auth.uid())`.
- Service-role client **only** for webhook + cron, after HMAC/`CRON_SECRET`.

### A2. Contacts

- `contacts`: `organisation_id`, name, `phone_e164` unique per org, `sms_opt_out` + source/timestamp.
- Manual add + CSV import (reuse ideas from `seed/from-oa` audience-import; match on E.164 only, no OA worker wash).
- STOP webhook sets `sms_opt_out` for every contact on that phone **in that org**.

### A3. BYO provider + numbers (guided connect)

Wizard (can be ugly):

1. Paste MM API username + password + optional webhook HMAC secret.
2. Encrypt and store on `provider_accounts` (`mode='byo'`).
3. Call `listSenders()` / credit balance to verify.
4. User picks a dedicated number they already bought in the MM dashboard; you insert `sms_numbers` (`purpose` default `inbox`).
5. Show the webhook URLs to paste in MM:

   `https://yarnhub.reveille.net.au/api/sms/webhook?org=<org_public_id>`  
   (inbound and status can be the same route, as OA.)

HMAC must be verified per org’s secret. Query `org` is how BYO accounts multiplex one app URL. Reject if the inbound `to` number is not owned by that org.

### A4. Kernel wiring

- `getSmsProviderForOrg(orgId)` using decrypted BYO creds; fallback `SMS_PROVIDER=mock`.
- Parameterise `validateSmsBody(body, orgName)`.
- Slim merge fields to `first_name`, `last_name`, `org_name` (drop OA campaign tokens from the composer).
- Webhook: parse → STOP → create/attach conversation on `(org, number, phone)` → append message.
- Test-send API.

**Skip in A:** blast queue, surveys, relays, P2P, billing, assessments.

---

## Phase B — Blast + enduring inbox

**Exit:** CSV/list → compose (segment counter, org-name compliance, blackout override with reason) → queue → cron drain → delivery status → replies in a three-pane inbox. Soft claim optional.

### B1. Blasts

Port OA `sms_lists` behaviour onto `sms_blasts` / `sms_blast_items` keyed by `contact_id` + `organisation_id`. Body lives on the blast (no `campaign_comms_drafts`). Reuse blackout + `sendBatch` + idempotency keys. Re-check opt-out at send. 409 if sender purpose is survey/relay.

Cron: `/api/cron/dispatch-sms-queue` every 5 minutes, `CRON_SECRET`.

### B2. Inbox

Port three-pane UI from seed. Drop assessment sidebar and worker CRM. Contact pane: name, phone, opt-out, notes. Thread key without campaign. Replies never blackout-blocked. Realtime on `sms_messages` when ready.

---

## Phase C — P2P, surveys, relays

**Exit:** All five tools work for one BYO org.

### C1. P2P

Working list of contacts, select subset, personalised opener, cap per send (OA: 50). Then 1:1 in inbox. Same sender-purpose belt as blast.

### C2. Surveys

Port `survey-engine` (already in `src/`). Rewrite `survey-runtime` / invitation dispatch / timers cron against `contact_id` + `organisation_id`. Keep: linear questions, invitation+Q1, retry ladder, one live session per org+phone, launch overlap warning, deferred live-phone toast. Drop: campaign assessments, FWA ballot copy (optional generic “poll” later).

Survey sender picker: prefer `purpose=survey`; warn on inbox numbers; exclude relay.

Cron: `/api/cron/sms-survey-timers` every 10 minutes.

### C3. Relays

Port engine + runtime. One live relay per number. Attribution prefix; no CLI spoofing. Moderation if the seed has it and time allows; otherwise v1.1.

---

## Phase D — Multi-user polish

Invites, roles on destructive actions, canned replies, send/survey funnel reporting, audit of credential changes, timezone default per org. Public marketing site can wait.

---

## Phase E — Hosted pipe (explicitly later)

Your MM account, number pool, Stripe credits, global send semaphore, KYC, panic suspend. Do not start this until BYO is boring. See viability spec §5.3 for why MM has no reseller portal and why the 5-request cap is account-wide.

---

## Suggested week map (one familiar developer)

| Week | Phase | Outcome |
|---|---|---|
| 1 | A1–A2 | Sign in, org, contacts |
| 2 | A3–A4 | BYO connect, test send, inbound thread |
| 3–4 | B | Blast + inbox |
| 5–7 | C | P2P + surveys + relays |
| 8 | D | Invites, reporting, harden webhook/cron |

Slip is expected on surveys (session machine + cron). Do not steal time from A/B to start E.

---

## Schema sketch (Phase A–C)

Write **new** migrations. OA SMS migrations alter `workers` / `campaigns` — they will not apply.

```
organisations (id, name, slug, public_id, timezone, created_at)
organisation_members (organisation_id, user_id, role)

contacts (id, organisation_id, first_name, last_name, phone_e164, sms_opt_out, …)
contact_lists / contact_list_members

provider_accounts (id, organisation_id, provider, credentials_ciphertext, webhook_secret_ciphertext, mode)
sms_numbers (id, organisation_id, provider_account_id, phone_e164 UNIQUE, purpose, status, label)

sms_conversations UNIQUE (organisation_id, our_number_id, phone_e164)
sms_messages, sms_conversation_notes, sms_canned_replies

sms_blasts, sms_blast_items, sms_send_log, sms_delivery_events

sms_surveys, sms_survey_questions, sms_survey_sessions, sms_survey_answers
  live session unique (organisation_id, phone_e164) WHERE state IN ('invited','active')

sms_relays, sms_relay_targets, …
```

RLS on every public table. Views `security_invoker`. Webhook writes via service role after org resolution.

---

## Testing

- Keep copied unit tests for engines; fix imports until `pnpm test` passes on `src/lib/sms`.
- Add tests for webhook org isolation (tenant A inbound never writes tenant B).
- Add tests for sender-purpose belts.
- Sandbox MM for A4; mock for CI.

---

## Done when (v1)

A person with no OA login can: sign up at https://yarnhub.reveille.net.au → connect MM → import contacts → blast, inbox, P2P, survey, relay → STOP respected for **their** org only.
