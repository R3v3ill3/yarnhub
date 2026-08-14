import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgSmsProviderLookup, ProviderAccountRow } from "@/lib/sms/provider";

export function providerAccountLookup(
  admin: SupabaseClient,
): OrgSmsProviderLookup {
  return {
    async getProviderAccount(orgId: string): Promise<ProviderAccountRow | null> {
      const { data, error } = await admin
        .from("provider_accounts")
        .select("credentials_ciphertext, webhook_secret_ciphertext")
        .eq("organisation_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
