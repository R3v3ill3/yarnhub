import { createAdminClient } from "@/lib/supabase/admin";

export async function emailsForUserIds(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const admin = createAdminClient();
  await Promise.all(
    unique.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data.user?.email) map.set(id, data.user.email);
    }),
  );
  return map;
}
