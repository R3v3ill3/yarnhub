import { decryptMobileMessageCredentials, decryptSecret } from "@/lib/sms/credentials";
import { MobileMessageProvider } from "./mobile-message-provider";
import { MockSmsProvider } from "./mock-provider";
import type { SmsProvider } from "./types";

export * from "./types";
export { MobileMessageProvider } from "./mobile-message-provider";
export { MockSmsProvider } from "./mock-provider";

let mockProvider: MockSmsProvider | null = null;

export function getMockSmsProvider(): MockSmsProvider {
  if (!mockProvider) mockProvider = new MockSmsProvider();
  return mockProvider;
}

export function resetMockSmsProvider(): MockSmsProvider {
  mockProvider = new MockSmsProvider();
  return mockProvider;
}

export function isMockSmsProvider(): boolean {
  const value = process.env.SMS_PROVIDER;
  if (value === "mobile_message") return false;
  if (value === "mock") return true;
  return process.env.NODE_ENV !== "production";
}

export interface ProviderAccountRow {
  credentials_ciphertext: string;
  webhook_secret_ciphertext: string | null;
}

export interface OrgSmsProviderLookup {
  getProviderAccount(orgId: string): Promise<ProviderAccountRow | null>;
}

/**
 * Resolve the SMS provider for an organisation.
 *
 * `SMS_PROVIDER=mock` (default) always returns the in-memory mock.
 * Otherwise BYO Mobile Message credentials are decrypted from
 * `provider_accounts` for that org.
 */
export async function getSmsProviderForOrg(
  orgId: string,
  lookup?: OrgSmsProviderLookup,
): Promise<SmsProvider> {
  if (isMockSmsProvider()) {
    return getMockSmsProvider();
  }

  if (!lookup) {
    throw new Error("Provider account lookup is required when SMS_PROVIDER is not mock");
  }

  const account = await lookup.getProviderAccount(orgId);
  if (!account) {
    throw new Error("No Mobile Message credentials saved for this organisation");
  }

  const creds = decryptMobileMessageCredentials(account.credentials_ciphertext);
  const webhookSecret = account.webhook_secret_ciphertext
    ? decryptSecret(account.webhook_secret_ciphertext)
    : undefined;

  return new MobileMessageProvider({
    username: creds.username,
    password: creds.password,
    webhookSecret,
  });
}

/** Provider used only to verify/parse webhooks (needs the org HMAC secret). */
export function webhookProviderFromSecrets(args: {
  webhookSecret: string | null;
}): SmsProvider {
  if (isMockSmsProvider()) {
    return getMockSmsProvider();
  }
  return new MobileMessageProvider({
    username: "webhook",
    password: "webhook",
    webhookSecret: args.webhookSecret ?? undefined,
  });
}
