# OA SMS seed

Copied from OffshoreAlliance `ed2da9b` on 2026-08-14T00:29Z.

- **`src/lib/sms` + `src/lib/phone`** in this repo are the engines. Treat them as the starting kernel.
- **This `seed/from-oa/` tree is reference only.** It still mentions `campaign_id`, `worker_id`, `can_write_to_campaign`, assessments, and episodes. Do not import it from app code. Port behaviour into new routes/schema.
- Do **not** copy OA `supabase/migrations/*sms*` and apply them. Write new migrations (see CLAUDE.md).
- `compliance.ts` still requires the string "Offshore Alliance". Parameterise org name per tenant before any public send.
- `p2p.ts` imports `@/lib/comms/template-variables` (OA campaign merge fields). A stub or slim contact-only merge-field helper is required before that file typechecks here.
- `provider/index.ts` in the seed uses OA `createAdminClient` + `app_settings`. Replace with per-org credentials (BYO).

Do not copy from OA again unless you are porting a specific bugfix. After Phase A, this product diverges.
