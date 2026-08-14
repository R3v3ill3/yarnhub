import { createAdminClient } from "@/lib/supabase/admin";
import { MobileMessageProvider } from "./mobile-message-provider";
import { MockSmsProvider } from "./mock-provider";
import type { SmsProvider } from "./types";

export * from "./types";
export { MobileMessageProvider } from "./mobile-message-provider";
export { MockSmsProvider } from "./mock-provider";

const SETTINGS_KEYS = [
  "sms_provider",
  "mobile_message_api_username",
  "mobile_message_api_password",
  "mobile_message_webhook_secret",
] as const;

// Module-level singleton so dev/test code inspecting recorded sends sees
// the same instance the app used.
let mockProvider: MockSmsProvider | null = null;

export function getMockSmsProvider(): MockSmsProvider {
  if (!mockProvider) mockProvider = new MockSmsProvider();
  return mockProvider;
}

/**
 * Resolve the configured SMS provider.
 *
 * Credential source of truth is `app_settings` (admin-managed) with env
 * fallback — resolving the env-vs-settings split-brain the yabbr card had.
 * Falls back to the mock provider when nothing is configured; throws when
 * `mobile_message` is explicitly selected but credentials are missing.
 */
export async function getSmsProvider(): Promise<SmsProvider> {
  let settings: Record<string, string> = {};
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("app_settings")
      .select("key, value")
      .in("key", [...SETTINGS_KEYS]);
    settings = Object.fromEntries(
      (data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value ?? ""])
    );
  } catch {
    // No admin client (e.g. local tooling) — env fallback below still applies.
  }

  const provider = settings.sms_provider || process.env.SMS_PROVIDER || "";
  const username =
    settings.mobile_message_api_username || process.env.MOBILE_MESSAGE_API_USERNAME || "";
  const password =
    settings.mobile_message_api_password || process.env.MOBILE_MESSAGE_API_PASSWORD || "";

  if (provider === "mobile_message") {
    if (!username || !password) {
      throw new Error(
        "Mobile Message credentials not configured — set them in Administration → Settings"
      );
    }
    return new MobileMessageProvider({
      username,
      password,
      webhookSecret:
        settings.mobile_message_webhook_secret ||
        process.env.MOBILE_MESSAGE_WEBHOOK_SECRET,
    });
  }

  if (provider && provider !== "mock") {
    console.warn(`Unknown sms_provider value "${provider}" — falling back to mock provider`);
  }
  return getMockSmsProvider();
}
