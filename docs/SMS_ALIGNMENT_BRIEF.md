# SMS alignment brief — Yarnhub ↔ Offshore Alliance

**Status:** Decision brief for Yarnhub product work. Not an OA plan.  
**Date:** 2026-08-18  
**Yarnhub:** https://yarnhub.reveille.net.au (`R3v3ill3/yarnhub`)  
**OA source reviewed:** local checkout `/Volumes/DataDrive/cursor_repos/offshoreAlliance/OffshoreAlliance` (`apps/organising-db` SMS module, including work after the 14 Aug extract)  
**Yarnhub seed snapshot:** `seed/from-oa/` from OA commit `ed2da9b` (2026-08-14). **Do not treat the seed as current OA.**  
**How to use this file:** this is the feature/UX target for Yarnhub. `docs/IMPLEMENTATION_PLAN.md` remains the build-order and tenancy contract. When they conflict on *what the product is*, this brief wins for SMS capacity; when they conflict on *data model / tenancy / what not to copy*, the implementation plan and `CLAUDE.md` win.

Read-only comparison. Do **not** add OA as a git remote, submodule, or shared package. Do **not** import `seed/from-oa/` from app code. Port behaviour into Yarnhub types (`organisation_id`, `contact_id`), then rewrite UI here.

---

## 1. Two products, one SMS kernel

| | Offshore Alliance | Yarnhub |
|---|---|---|
| What it is | Single-tenant organising CRM. SMS is a channel next to phone/email/wall chart. | Multi-tenant SMS product. Anyone can sign up. |
| Audience | Campaign **workers** | Org **contacts** |
| Auth | OA staff + `can_write_to_campaign` | Org membership (`owner` / `admin` / `member`) |
| Provider | One Mobile Message account in `app_settings` | **BYO** credentials per org (encrypted). Hosted pipe is Yarnhub Phase E, not OA. |
| Thread key | `(our_number, phone, campaign_id)` | `(organisation_id, our_number_id, phone_e164)` |
| Legal sender on SMS | Hardcoded “Offshore Alliance” | Tenant `organisations.name` |
| Production | `oa.uconstruct.app` | `yarnhub.reveille.net.au` |

Yarnhub already has the **five tools** (blast, inbox, P2P, surveys, relays), the **routing rules**, and a working BYO path. OA is ahead on **operator UX**: how a human actually runs those tools at volume.

The job is not a lift-and-shift. It is: keep OA’s SMS *capacity* (what you can do, and the design patterns that make it usable), adapted for a standalone org with contacts, lists, and their own MM numbers.

---

## 2. Kernel already aligned — do not reopen

These are production rules in both codebases. Yarnhub has the correct standalone versions.

### Inbound order

Yarnhub (`src/lib/sms/inbound.ts`):

1. STOP (provider `unsubscribe` **or** in-app keyword `stop|unsubscribe|opt out`)
2. Live survey session **by member phone** (`invited` / `active`), scoped to the org
3. Live relay on the **to-number** (`purpose=relay`)
4. Else inbox thread on `(org, our number, phone)`

OA inserts an extra step 3: **ballot post-completion revote**. Yarnhub should **not** add that unless we later ship a generic poll mode (see §6).

STOP is **per organisation**, not platform-wide and not OA-union-wide.

### Sender purpose

- Blast, P2P, test send, inbox reply: refuse `purpose=survey|relay`.
- Surveys: prefer `purpose=survey`; warn on inbox/spare; refuse relay.
- Relays: require `purpose=relay`. One live relay per number (`active`/`paused`).
- Relays never create inbox conversations.

### Other invariants to keep

- Quiet hours 09:00–20:00 in the **org timezone**, recorded override (≥8 characters) for bulk. **1:1 inbox replies never blackout-blocked.**
- Org name in the body is a **warning + confirm**, not a hard server fail.
- Opt-out re-checked at send time.
- Conversation unique `(organisation_id, our_number_id, phone_e164)`.
- One live survey session per `(organisation_id, phone_e164)`.
- P2P cap **50** per send (`P2P_SEND_CAP`).
- Invitation + question 1 as **one SMS**; survey retry ladder; session TTL / nudge / reminders in the engine.
- Relay = attributed forward from a dedicated number. **Not** CLI spoofing (ACMA).
- Crons: dispatch every 5 min; survey timers (+ queued relay forwards) every 10 min; `CRON_SECRET`; Node runtime for webhook HMAC.
- Mobile Message: account-level webhooks, multiplex BYO with `?org=<org_public_id>`.

### Pure engines (port fixes from **current OA**, not from the seed)

Keep and maintain in `src/lib/sms/`:

`provider/*`, `survey-engine.ts`, `relay-engine.ts`, `segments.ts`, `blackout.ts`, `compliance.ts` (already parameterised), `sender-purpose.ts`, `conversation-routing.ts`, `p2p.ts`, `phone/normalise-phone.ts`.

Worth copying **from current OA** when we implement the matching Yarnhub UI (these were not in the 14 Aug seed, or have moved on):

| OA module | Why Yarnhub wants it |
|---|---|
| `lib/sms/emoji.ts` + `SmsEmojiPicker` | One emoji UCS-2s the whole blast; composer must warn. |
| `lib/sms/sender-inbound.ts` | Dedicated vs handset vs alphanumeric. Chat/surveys need inbound-capable numbers. |
| `lib/sms/chat-rail-state.ts` | P2P workspace rail colours (desaturated conversation state, not rating colours). Drop rating chips. |

---

## 3. Explicitly out of Yarnhub

Do not port. If an OA file only exists to serve these, leave it.

| OA concept | Why it stays in OA |
|---|---|
| `campaigns`, `workers`, `organisers`, `can_write_to_campaign` | Yarnhub tenancy is orgs + contacts |
| Hidden `is_sms_episode` campaigns / `SmsToolsPage` | Compatibility shim. Yarnhub already hangs tools off the org. |
| Wall chart, Build List purpose `sms`, `fire/sms`, `CreateSmsOrchestrator` / pathway picker | Organising CRM chrome. Yarnhub nav is already the five tools. |
| Assessments, `record_assessment_event`, `trg_sms_to_rating`, source taxonomy, `SmsAssessmentPanel`, `SmsPinnedAssessment` | Ratings CRM. Contact pane is name / phone / opt-out / notes. |
| Indicative ballot FWA/AEC/FWC copy, `sms_ballot_roll`, receipt hashing | Industrial-law product. Optional later: generic “poll with receipts”, no AEC banner. |
| Campaign merge fields (employer, agreement, worksite, organiser, `staff_*`) | Slim to `first_name`, `last_name`, `org_name` |
| AI “Draft reply” that reads worker ratings / activity | Optional later as a generic thread summariser; not v1, not OA-coupled |
| Sequences / `sms_blast` activity kind | OA automations |
| `app_settings` singleton MM credentials | Already replaced by `getSmsProviderForOrg` |
| Organiser-assigned numbers as staff HR | Numbers are org inventory with a purpose |

---

## 4. Feature matrix

Legend: **Keep** = Yarnhub already matches the intent. **Port (adapt)** = OA has the capacity; rebuild against contacts/org. **Skip** = OA-only.

### 4.1 Contacts and audience

| Capacity | OA | Yarnhub today | Yarnhub target |
|---|---|---|---|
| Contact record | `workers` (union-wide) | `contacts` per org, unique phone | **Keep** |
| Manual add | Name + AU mobile + consent source | Add form, E.164 match | **Port:** require first **and** last name for new people (OA decided bare numbers are not a supported input). Keep E.164-only match. |
| CSV / spreadsheet | Parse → match → review → consent **attestation** (`sms_import` / `sms_manual_entry`) | Paste/CSV import, skip invalid, no consent step | **Port (adapt):** review unmatched rows; explicit consent basis stored on the contact (`sms_consent_source`). No “wash against OA membership”. |
| Lists | Saved worker lists; compose audience in the blast picker; **create list from** blast/survey outcomes | Snapshot **all** current contacts into a named list; cannot edit membership; cannot build from replies | **Port (adapt):** editable lists (add/remove contacts); pick a subset; “create list from” blast replied / delivered-no-reply / failed and survey completed / started / non-responders. |
| Opt-out | Union-wide; STOP + provider unsubscribe + START/UNSTOP restore; staff lift | STOP / unsubscribe **sets** opt-out in that org; relay copy mentions START but **inbound START is not implemented**; no staff lift | **Port:** START/UNSTOP clears `sms_opt_out` in that org only (preserve `sms_opt_out_at` / source history). Staff opt-out and lift on the contact pane. |
| Suppression | Audience build **and** send time | Send time + audience load skips opted-out | **Keep**, plus START path above |

### 4.2 Blasts

| Capacity | OA | Yarnhub today | Yarnhub target |
|---|---|---|---|
| Compose | `SmsComposer`: merge fields, GSM/UCS-2 counter, worst-case merge expansion, emoji picker, org-name confirm, test-send-to-self | Merge chips, worst-case counter, org-name confirm, blackout override | **Port:** emoji picker + UCS-2 warning; test-send-to-self; `sender-inbound` so handset/alpha senders cannot be chosen for a 2-way blast. |
| Audience | Whole campaign, saved list, or build (manual/CSV) | All opted-in contacts **or** a saved snapshot list | See §4.1 lists |
| Lifecycle | Draft → queue → **pause / resume / cancel** | Queue on submit. Schema has `paused`/`cancelled`; **no UI** | **Port:** save draft; pause / resume / cancel from the blast detail. |
| Dispatch | Cron 5 min, blackout, opt-out recheck, purpose belt, mirror to inbox | Same | **Keep** |
| Outcomes | Funnel sent → delivered → failed; export CSV; create list from cohorts; reply rate **against delivered**; per-sender median latency | Item table + status counts; `/reports` is org-wide counts | **Port (adapt):** per-blast funnel with **delivered** as reply-rate denominator; CSV export; create list from. Latency / rollup cards after the workspace (lower priority). |

### 4.3 Inbox (enduring 1:1)

OA’s inbox is a **work queue**. Yarnhub’s inbox is a **chronological thread list**. That is the main design gap.

| Capacity | OA | Yarnhub today | Yarnhub target |
|---|---|---|---|
| Layout | Three-pane: queue \| `SmsThreadView` \| member sidebar. Mobile: list ↔ thread, sidebar as sheet | Three-pane on large screens: list \| thread \| contact. Mobile hides list when a thread is open | **Keep layout.** Raise the list to a **queue** (tabs), not only recency. |
| Queue tabs | Mine / Needs response / Unassigned / Triage / Escalated / All | Flat list by `last_message_at`, unread badge | **Port (adapt):** **Needs reply** (unread inbound) / **Mine** (claimed by me) / **Unclaimed** / **All**. Skip Escalated and campaign attach. **Triage** = inbound phone with no `contact_id` — keep, plus a “save as contact” action. |
| Conversation state | Spoke machine: `needs_message → messaged → needs_response → convo → closed` + `triage`. Inbound reopens closed → needs_response | `state` defaults to `'open'` and stays there | **Port (adapt):** add a small state enum Yarnhub can filter on (`open` / `needs_reply` / `closed` is enough). Do not copy campaign-scoped states. |
| New chat | `SmsNewChatDialog` (inbox-safe sender) | No UI; threads appear from test send / blast / P2P / inbound | **Port:** “New conversation” from inbox: pick contact (or paste number → create contact) + inbox-safe sender. |
| Composer | Shared `SmsComposer`, canned insert, emoji | Textarea + canned chips. Copy: replies never held for quiet hours | **Port:** share one composer component across inbox / blast / P2P (segment counter on bulk; emoji; canned on inbox). |
| Notes | Whisper notes **in the thread** (`sms_conversation_notes`) | Notes on `contacts.notes` in the sidebar | **Port:** in-thread staff notes (distinct colour). Contact-level notes can stay on the person. |
| Claim | Soft TTL claim RPC; presence/typing pills; **warn, don’t block** | Claim/release columns; **does not block**; no presence; no TTL | **Keep soft claim.** Add a visible “also viewing” later if collisions happen. Do not hard-lock. |
| Realtime | Per-open-thread messages + presence; list polls ~30s | Per-open-thread `sms_messages` INSERT → refresh. **List is SSR**, no live unread | **Port:** refresh/poll the **list** unread badges (30s is fine). Presence is optional. |
| Opt-out in thread | Staff opt-out / lift; START copy | Badge only | **Port:** staff opt-out / lift on the contact pane. |
| Close / reopen | Yes | No | **Port:** close hides from Needs reply; inbound reopens. |
| Assessments, escalate, campaign/activity attach, AI draft | Yes | No | **Skip** (AI later, generic) |

### 4.4 P2P chat — largest UX gap

OA no longer uses the old `SmsP2pBoard` sheet (Yarnhub seed still has that file). Current OA is a **dedicated 3-pane workspace**.

**OA workflow (keep this, strip CRM):**

1. Load a working list.
2. Compose a shared opener (merge fields); optional **per-row body override**.
3. Select people (cap 50). Soft blackout **warning** only (not a hard block). Opt-out hard-skip.
4. Send live.
5. Work 1:1 in `/campaigns/[id]/sms/chat/[listId]`: **rail** (colour by conversation state, pulse on unread) \| **thread** (reuses `SmsThreadView`) \| **member card**.
6. “Needs reply” filter, select-next-N, add people, close board.
7. Enduring inbox remains the org-wide queue for everything else.

**Yarnhub today:** `/p2p` is a contact checklist + one opener → `sms_p2p_sends` → immediate dispatch + cron → then the user is sent to **inbox**. Kernel already has `p2pItemTemplate` / `p2pBodyOverrideToStore`; **no per-row UI**. Board types still say `worker_name` / `employer_name`.

**Yarnhub target:**

- Treat a P2P send (or a named working list) as a **session**, not a fire-and-forget blast.
- New route e.g. `/p2p/[sendId]`: rail \| thread \| contact pane (reuse inbox thread + contact pane; **no** pinned assessment).
- Port `deriveRailState` from OA `chat-rail-state.ts`. Palette stays desaturated. There are **no** rating chips.
- Per-row opener override.
- After send, stay in the workspace; inbox still shows the same threads (same uniqueness key).
- Blackout: keep Yarnhub’s recorded override for queued P2P (stricter than OA’s warning-only). Document that 1:1 replies after the opener are never window-blocked.
- Drop: nominate-a-campaign, pinned assessments, `WorkerChatCard` campaign tabs, episode boards.

### 4.5 Surveys

The **engine** in Yarnhub already includes branching, retry ladder, invitation+Q1, `freetext_on_choice`, handoff. The **authoring and reporting UI** is a thin form.

| Capacity | OA | Yarnhub today | Yarnhub target |
|---|---|---|---|
| Authoring | Linear + per-answer branch; live phone preview; **flow chart**; soft cap 5 | Linear questions; types yes_no / choice / scale / open_text; no branch editor; no preview; no flowchart | **Port:** branch UI + flowchart + live preview. Engine already reads `branching` jsonb. |
| Settings | Retry limit, question timeout, session TTL, reminder offsets, `is_test` + promote | Columns exist with defaults; **not in the editor** | **Port:** expose retry / timeout / TTL / reminders on create. Optional later: draft “test” vs promote. |
| Launch | Same audience picker as blasts; overlap warning; deferred busy-phone; pause soft/hard; close | Audience all/list; overlap confirm; blackout override; pause soft/hard; close | **Keep** launch/pause. Audience follows §4.1. |
| Inbound / timers | Parse, retry, nudge, remind, expire, handoff to inbox | Runtime + `/api/cron/sms-survey-timers` | **Keep** |
| Reporting | Funnel, per-question drop-off / invalid-reply rate, pie dashboard, **export CSV**, create list from cohorts | Session-state counts on detail; `/reports` aggregates. **No answer table, no CSV** | **Port:** per-survey answer viewer + CSV; question stats (invalid-reply rate); create list from. Skip rating write-back. |
| Versions / integrity | Pin version; retire edited questions; high-risk edit warnings | Not ported | **Later.** Needed once live surveys are edited in the field. |
| Ballots | Indicative FWA framing | Not present | **Skip** for v1. Optional generic poll later. |

### 4.6 Relays

| Capacity | OA | Yarnhub today | Yarnhub target |
|---|---|---|---|
| Mechanism | Dedicated number; prefix/suffix; created paused; one live per number; quiet hours on member→target; target replies to last forwarded member; no inbox threads | Same kernel + UI to create/activate/pause/end, edit prefix, targets, last 50 messages | **Keep** |
| Merge in prefix | `first_name`, `last_name`, `employer_name` | `first_name`, `last_name` | **Keep Yarnhub fields.** Optional later: `{{org_name}}`. |
| Moderation | Queue approve/reject; pause beats moderation | Column exists; `moderation_required` always false; no UI | **v1.1** unless a tenant asks. |
| Opted-out auto-reply | Hardcoded “Offshore Alliance” | Parameterised with tenant name; mentions START | **Keep** copy; wire START inbound (§4.1). |

### 4.7 Team, settings, reporting (Yarnhub-native)

These have no OA equivalent in the same shape. Keep them; they are the standalone product.

| Surface | Keep / change |
|---|---|
| Settings wizard (BYO creds → register number → webhook URL → test send) | **Keep.** Filter test-send to inbox-safe numbers (today survey/relay fail on submit). Warn on handset/alpha via `sender-inbound`. |
| Team (invites, roles, timezone, canned replies, audit) | **Keep.** Canned replies stay org-wide (OA also has campaign-scoped; skip that). |
| Reports | Replace count dumps with the funnels in §4.2 / §4.5. Add a simple P2P line: openers sent / replies / response rate. |
| Phase E hosted pipe (`/platform`, Stripe, KYC, number pool) | **Out of this brief.** Already sketched in-repo; do not expand it while catching up SMS capacity. BYO is the v1 sending model. |

---

## 5. Design language (what “feels like OA SMS” without being OA)

Port these **patterns**, not the campaign chrome.

1. **One composer** for blast / P2P / inbox variants: plain text, `{{tokens}}`, live segment counter (worst-case on merge fields), org-name confirm dialog, emoji with UCS-2 warning. Inbox variant omits the counter requirement and never applies blackout.
2. **Three panes** everywhere volume work happens: queue or rail \| thread \| person. Desktop first; mobile is list ↔ thread, person in a sheet.
3. **Spoke-style work queues** for inbox and P2P rail: colour means *conversation state*, unread pulses, “next person who needs a reply”.
4. **Soft collision control:** claim is advisory. Presence is nice-to-have.
5. **Create list from outcomes** closes the loop (blast and survey). This replaces OA’s wall-chart fire path.
6. **Launch warnings, not silent failure:** org name, overlap (survey), blackout override reason, dedicated-number vs handset.
7. **Quiet hours on bulk and survey prompts; never on a human 1:1 reply.**
8. **Attribution, not spoofing** for relays.

Visual system: Yarnhub chrome (product name in the header, tenant name as legal sender). Do not restyle to look like organising-db. Do reuse the *information architecture* of OA’s SMS panels.

---

## 6. Recommended Yarnhub workstreams

Priority is **capacity the user can feel**, using current OA as the reference implementation. Schema stays Yarnhub. Copy files from **current OA**, then rewrite types — not from `seed/from-oa/` (P2P board there is stale).

| # | Workstream | Outcome | OA files to read (adapt, don’t import) |
|---|---|---|---|
| **W0** | Consent loop | START/UNSTOP inbound; staff opt-out/lift; consent source on import | OA `sms_foundations` STOP/START trigger; `useSmsOptOut.ts` |
| **W1** | P2P workspace | `/p2p/[sendId]` 3-pane rail; stay in session after send; per-row override; rail states | `components/sms/workspace/*`, `chat-rail-state.ts`, `useSmsP2p.ts` |
| **W2** | Inbox as a queue | Needs reply / Mine / Unclaimed / All; new chat; close/reopen; in-thread notes; list unread refresh | `SmsInboxPanel`, `SmsThreadView`, `SmsNewChatDialog`, `sms-inbox-shared.ts` |
| **W3** | Blast operator | Draft/pause/resume/cancel; CSV export; create list from; emoji; inbound-capable sender check | `InlineSmsOpsPanel` blast tab, `SmsComposer`, `emoji.ts`, `sender-inbound.ts` |
| **W4** | Survey authoring + answers | Branch + flowchart + preview; settings fields; answer table + CSV; create list from | `SmsSurveyEditor`, `SmsSurveyFlowChart`, `SmsSurveyReportDashboard`, `survey-report.ts` |
| **W5** | Lists | Editable membership; blast/survey/P2P pick a list; consent attestation on CSV | OA `AudiencePicker` *idea* only (no worker matching) |
| **W6** | Shared composer | One component used by blast, P2P, inbox | `SmsComposer.tsx`, `SmsOrgNameWarningDialog.tsx`, `SmsEmojiPicker.tsx` |

Do **not** steal time from W0–W2 to polish Phase E or to port ballots/assessments.

Suggested order: **W0 → W1 → W2**, then W3/W5 in parallel, then W4, then W6 if composer duplication is hurting.

---

## 7. Yarnhub as-built snapshot (2026-08-18)

So this brief is not confused with older prompts (`docs/NEXT_AGENT_PROMPT.md` still describes a world where Phase C was unfinished).

**In product:** signup → org → BYO MM → numbers → test send → webhook; contacts + CSV; blasts queued + cron; three-pane inbox + canned + soft claim + thread realtime; P2P opener send (cap 50); surveys launch/pause/close + engine + timers; relays; team invites; reports counts; hosted pipe schema/UI exists.

**Known leftovers (clean up when touching the file):** `P2pBoardItemLike.worker_name` / `employer_name`; `sender-purpose` comment `'organiser'`; `relay-runtime` field `member_worker_id`; `types/sms.ts` `activity_id` / `write_rating`; timezone default Sydney on org vs Perth in `blackout.ts`.

**Do not use `seed/from-oa/` as OA current.** In particular `SmsP2pBoard.tsx` was deleted in OA and replaced by the workspace route.

---

## 8. How to compare again later

From a Yarnhub chat, OA is readable on disk at:

`/Volumes/DataDrive/cursor_repos/offshoreAlliance/OffshoreAlliance/apps/organising-db/`

Useful roots:

- Engines: `src/lib/sms/`
- UI: `src/components/sms/` (inbox, p2p, surveys, relays, **workspace**)
- Operator how-to: OA `docs/SMS_MODULE_HOWTO.md`
- Original research: OA `docs/SMS_MODULE_BRIEF.md` (patterns, not OA schema)

For a side-by-side Cursor session: File → Add Folder to Workspace (Yarnhub + that `OffshoreAlliance` folder) and keep the chat **read-only / no copy unless a workstream above names the file**.

---

## 9. Done when

A Yarnhub org (no OA login) can:

1. Import or add contacts with a recorded consent basis; STOP and START work **for that org only**.
2. Blast with draft/pause/cancel, segment-safe compose, and “create list from” outcomes.
3. Work replies from an inbox **queue** (not only a recency list), including new chat and close.
4. Run P2P as a **workspace**: pick people, send a personalised opener, work many 1:1 threads from a rail, same threads visible in inbox.
5. Author a short branched survey, launch with overlap warning, read answers / export, handoff to inbox on retry exhaustion.
6. Run a relay on a dedicated number with attribution, without spoofing.

That is OA SMS **capacity**, on Yarnhub’s tenant model.
