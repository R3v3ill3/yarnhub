# SMS operator port — Yarnhub

**Status:** Landed in this change. Operator workflows that already fit Yarnhub’s org and contact model.  
**Source of behaviour:** Offshore Alliance `main` through commit `0f52969` (9 September 2026), read only. Do not add that repo as a remote, submodule, or import.  
**Tenancy:** `docs/IMPLEMENTATION_PLAN.md` and `CLAUDE.md` still win on data model. Legal sender remains `organisations.name`.

Apply `supabase/migrations/20260924052738_sms_operator_port.sql` on the Yarnhub Supabase project before relying on archive, the survey test flag, or the test roster.

## In this change

| Surface | What lands |
|---|---|
| Contacts | First and last name required. Consent attestation on add and CSV/XLSX import, stored as `sms_consent_source`. Per-row reject reasons. Open a list and add or remove members. |
| Inbox | Queue tabs: Needs reply, Mine, Unclaimed, All. New conversation. Close and reopen. In-thread staff notes. Staff opt-out and lift. iOS/Android tapbacks fold onto the quoted outbound instead of opening a new “needs reply”. |
| Blasts | Pause, resume, cancel. Pausing returns in-flight `sending` items to the queue, and the dispatcher drops a claimed batch if the blast is no longer queued or sending. Save as draft, then queue. Emoji insert with a UCS-2 warning. CSV of items. Create a contact list from replied, delivered-with-no-reply, or failed. Archive once the blast is finished or cancelled. |
| Surveys | Yes/no branch targets. Structure chart on the editor and the survey page, including a straight line when nothing branches. Participation and per-question pies. Retry, timeout, and session TTL on create. Live preview of the invitation. Test mode sends only to an org test roster (cap 25). Answer table and wide CSV. Create a list from completed, started, or non-responders. Archive after close. |
| P2P | After send, stay on `/p2p/[sendId]`: rail by conversation state, open the same thread in Inbox. |
| Relays | Every member→target forward includes the member’s mobile and tells the target to reply on this number. |

## Still to port

These are real Offshore Alliance behaviours. They need their own schema and UI pass, and they are not in this change.

1. Survey definition versions and a high-risk edit warning before changing a live survey.
2. Printable Word copy of a survey.
3. Relay launch texts (a blast that may send from the relay number, and must not send while the relay is paused).
4. Organiser-written reply back to the member, instead of automatic bridging.
5. A single actions list with archive rules across blasts, chats, surveys, and relays (the hub). Email and call rows stay in Offshore Alliance.

## Leave in Offshore Alliance

Assessments and wall-chart ratings, Build List fire-into-SMS, hidden `is_sms_episode` campaigns, indicative ballots, campaign fact write-back, and the weekly membership-file import.
