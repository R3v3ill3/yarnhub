# Yarnhub SMS catch-up plan

**Status:** Active build plan.  
**Date:** 2026-08-18  
**Product target:** [`docs/SMS_ALIGNMENT_BRIEF.md`](./SMS_ALIGNMENT_BRIEF.md)  
**Tenancy / what not to copy:** [`CLAUDE.md`](../CLAUDE.md) and [`docs/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)

This plan brings Yarnhub’s **operator UX** up to Offshore Alliance SMS capacity, on Yarnhub’s org / contact / BYO model. It does not merge the repos, add OA as a remote, or port campaigns, workers, assessments, wall chart, episode campaigns, or FWA ballots.

Yarnhub already has the five tools and the routing kernel. Catch-up is workflow, not a greenfield SMS stack.

---

## Outcome

A Yarnhub org can:

1. Import contacts with a recorded consent basis; STOP and **START** work for **that org only**; staff can opt out / lift.
2. Blast with draft / pause / resume / cancel, CSV export, and “create list from” outcomes.
3. Work an inbox **queue** (needs reply / mine / unclaimed / all), start a new chat, close / reopen, leave in-thread notes.
4. Run P2P as a **workspace**: pick people, send a personalised opener, work many 1:1 threads from a rail. Same threads appear in inbox.
5. Author a short branched survey, read answers / export CSV, create a list from cohorts.

---

## What we will not build in this plan

- Assessments, wall chart, `campaign_id`, `worker_id`, hidden SMS episodes
- Indicative / FWA ballots
- Hosted MM / Stripe / Phase E expansion
- AI draft-reply tied to OA worker ratings
- Copying files from `seed/from-oa/` (stale). Read **current OA** on disk only, then rewrite here.

OA reference root (read-only):

`/Volumes/DataDrive/cursor_repos/offshoreAlliance/OffshoreAlliance/apps/organising-db/`

---

## Multi-agent approach

One **coordinator** (this Yarnhub chat) owns schema, inbound kernel, shared libraries, integration, and review. **Feature agents** own disjoint file trees so they can run in parallel without colliding.

### Rules for every agent

- Yarnhub types only: `organisation_id`, `contact_id`. Never `campaign_id` / `worker_id`.
- Do not import `seed/from-oa/`.
- Do not add OA as a git remote.
- Reuse existing UI primitives (`Button`, `Card`, `Input`, `Label`, `Textarea`, `Alert`). Do not add shadcn packages unless the coordinator asks.
- Legal sender on SMS is `organisations.name`, not “Yarnhub” or “Offshore Alliance”.
- Destructive blast / list-delete / survey launch already use `destructiveRoleError` (owner/admin). Inbox reply and P2P send stay open to any member.
- After TSX edits, keep components small; client components only where they use state/hooks.
- Do not commit or run git unless the user asks.

### Wave 0 — coordinator (must finish first)

Shared contract everyone else depends on.

| Deliverable | Files |
|---|---|
| This plan + alignment brief in agent read order | `docs/SMS_CATCHUP_PLAN.md`, `CLAUDE.md` |
| Migration | `supabase/migrations/*sms_operator_catchup.sql` applied to Supabase project **yarnhub** (`tycqjkghdmizgbqgbkgg`) |
| START/UNSTOP inbound leg | `src/lib/sms/survey-engine.ts`, `inbound.ts`, `process-inbound.ts`, tests |
| Conversation states `open` / `needs_reply` / `closed` | `thread-write.ts`, inbound bump |
| P2P item → conversation link | `sms_p2p_send_items.conversation_id`, `dispatch-p2p.ts` |
| Shared helpers | `contact-lists.ts`, `chat-rail-state.ts`, `emoji.ts`, `sender-inbound.ts` |

**Exit:** `pnpm test` passes. START is a first-class inbound leg (after STOP, before survey). Migration applied on yarnhub.

### Wave 1 — three agents in parallel (disjoint trees)

| Agent | Owns (only these paths) | Builds | Exit |
|---|---|---|---|
| **Contacts** | `src/app/(app)/contacts/**` | Consent on add/CSV; editable lists; staff opt-out/lift on the contacts table | Add requires first+last name + consent; CSV attests consent; open a list and add/remove members |
| **Inbox** | `src/app/(app)/inbox/**` | Queue tabs; new chat; close/reopen; in-thread notes; START copy on opted-out; staff opt-out on contact pane | Filter Needs reply / Mine / Unclaimed / All; new conversation from a contact or number |
| **Blasts** | `src/app/(app)/blasts/**` | Draft/pause/resume/cancel; CSV export; create list from replied / delivered-no-reply / failed; emoji + UCS-2 warning | Pause a queued blast; export items; create a list from failed rows |

Coordinator also wires `src/lib/sms/contact-lists.ts` so Blasts can create lists without editing Contacts files.

### Wave 2 — after Wave 1 lands

| Agent | Owns | Builds | Depends on |
|---|---|---|---|
| **P2P workspace** | `src/app/(app)/p2p/**` | `/p2p/[sendId]` rail \| thread \| contact; redirect after send; per-row opener later if time | Wave 0 rail + `conversation_id`; Inbox thread patterns (copy, do not edit inbox files) |
| **Surveys** | `src/app/(app)/surveys/**` | Branch fields + live preview if cheap; answer table + CSV; create list from completed / started / non-responders; expose retry/TTL | Wave 0 `insertContactList` |

### Wave 3 — coordinator polish

Shared composer across blast / P2P / inbox if duplication hurts. Survey flowchart (`SmsSurveyFlowChart` from current OA, stripped). Sender-inbound check in Settings test-send.

---

## Schema (Wave 0)

```
contacts.sms_consent_source  text  null | manual | import | legacy

sms_conversations.state      check (open | needs_reply | closed)
  inbound with new message → needs_reply (reopens closed)
  outbound reply            → open
  staff close               → closed

sms_conversation_notes (
  id, organisation_id, conversation_id, author_user_id, body, created_at
)
  RLS: org members, same pattern as sms_messages

sms_p2p_send_items.conversation_id  uuid null references sms_conversations
```

---

## Inbound order (updated)

1. STOP (provider unsubscribe or keyword) — opt out in **this org**, terminate live surveys, still append to inbox  
2. **START / UNSTOP** (whole-body keyword) — clear `sms_opt_out` in this org; keep `sms_opt_out_at` / source as history; skip survey parse and relay forward; append to inbox  
3. Live survey by member phone  
4. Live relay by to-number  
5. Inbox  

---

## File map (who may touch what)

```
docs/SMS_CATCHUP_PLAN.md          coordinator
src/lib/sms/**                    coordinator (Wave 0 + review). Feature agents IMPORT only.
src/app/(app)/contacts/**         Contacts agent
src/app/(app)/inbox/**            Inbox agent
src/app/(app)/blasts/**           Blasts agent
src/app/(app)/p2p/**              P2P agent (Wave 2)
src/app/(app)/surveys/**          Surveys agent (Wave 2)
supabase/migrations/**            coordinator only
```

OA files to **read** (not copy wholesale):

| Yarnhub work | Current OA |
|---|---|
| START | `supabase/migrations/20260810100000_sms_foundations.sql` STOP/START trigger; `useSmsOptOut.ts` |
| Inbox queue | `components/sms/inbox/SmsInboxPanel.tsx`, `SmsNewChatDialog.tsx` |
| P2P workspace | `components/sms/workspace/*`, `lib/sms/chat-rail-state.ts` |
| Blast lifecycle | `InlineSmsOpsPanel.tsx` blast tab |
| Emoji / inbound sender | `lib/sms/emoji.ts`, `lib/sms/sender-inbound.ts` |
| Survey answers | `SmsSurveyReportDashboard.tsx`, `lib/sms/survey-report.ts` |

---

## Session log

| Wave | When | Result |
|---|---|---|
| 0 | 2026-08-18 | In progress in this chat |
| 1 | 2026-08-18 | Parallel Contacts / Inbox / Blasts agents |
| 2 | after Wave 1 | P2P workspace + survey answers |
