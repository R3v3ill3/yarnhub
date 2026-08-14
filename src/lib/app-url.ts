const DEFAULT_APP_URL = "https://yarnhub.reveille.net.au";

export function appUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return DEFAULT_APP_URL;
  return raw.replace(/\/$/, "");
}

export function smsWebhookUrl(orgPublicId: string): string {
  return `${appUrl()}/api/sms/webhook?org=${encodeURIComponent(orgPublicId)}`;
}
