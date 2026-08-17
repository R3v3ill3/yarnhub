import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgSmsProviderLookup, ProviderAccountRow } from "@/lib/sms/provider";

export function providerAccountLookup(
  admin: SupabaseClient,
): OrgSmsProviderLookup {
  return {
    async getProviderAccount(orgId: string): Promise<ProviderAccountRow | null> {
      const { data, error } = await admin
        .from("provider_accounts")
        .select("mode, credentials_ciphertext, webhook_secret_ciphertext")
        .eq("organisation_id", orgId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.mode === "hosted") {
        const { data: platform, error: platformError } = await admin
          .from("platform_sms_accounts")
          .select("credentials_ciphertext, webhook_secret_ciphertext")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (platformError) throw platformError;
        if (!platform) {
          return {
            mode: "hosted",
            credentials_ciphertext: null,
            webhook_secret_ciphertext: null,
          };
        }
        return {
          mode: "hosted",
          credentials_ciphertext: platform.credentials_ciphertext,
          webhook_secret_ciphertext: platform.webhook_secret_ciphertext,
        };
      }
      return data;
    },
  };
}
