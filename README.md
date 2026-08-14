# Yarnhub

Multi-tenant SMS tools (blast, inbox, P2P, surveys, relays) at
[yarnhub.reveille.net.au](https://yarnhub.reveille.net.au).

v1 sending is **BYO Mobile Message only**. Hosted credits / number pool are not in this phase.

## Phase B

Blasts (queue + 5-minute cron drain) and a three-pane inbox. Quiet-hours
window is 09:00–20:00 in the organisation timezone unless a recorded
blackout override is set. One-to-one inbox replies are never held.

## Local development

```bash
pnpm install
cp .env.example .env.local
```

Required env:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yarnhub Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yarnhub anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhook + credential writes only |
| `SMS_CREDENTIALS_KEY` | AES key for MM passwords (64 hex chars, or any passphrase) |
| `SMS_PROVIDER` | `mock` locally; `mobile_message` in production |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally; `https://yarnhub.reveille.net.au` in production |
| `CRON_SECRET` | Bearer token for `/api/cron/dispatch-sms-queue` |

Apply migrations to the **yarnhub** Supabase project (never OA):

```bash
pnpm dlx supabase db push --linked
# Phase A + B files under supabase/migrations/ — yarnhub project only
```

Auth Site URL must be `https://yarnhub.reveille.net.au` (add `http://localhost:3000/**` to redirect URLs).

```bash
pnpm test
pnpm dev
```

## Mock inbound (no ngrok)

1. Sign up and create an organisation.
2. Settings → save any username/password (mock does not call MM).
3. Register `+61400000001` (the mock sender) or any AU mobile.
4. Send a test SMS.
5. Open the thread and use **Append inbound reply**.

## Real Mobile Message

1. Create an API user in the MM dashboard; copy username + password.
2. Buy a dedicated number in MM (there is no purchase API).
3. Settings → save credentials (Yarnhub calls `listSenders` / balance).
4. Register that number.
5. Paste the displayed webhook URL as both inbound and status URL:

`https://yarnhub.reveille.net.au/api/sms/webhook?org=<org_public_id>`

6. Paste the MM webhook signing secret into Settings.
7. Send a test SMS and reply from a phone.

HMAC is verified per organisation. The inbound `to` number must belong to that org.

```bash
pnpm test   # engine + webhook isolation unit tests
pnpm lint
pnpm build
```
