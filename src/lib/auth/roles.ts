import type { OrgRole } from "@/lib/supabase/types";

export const ADMIN_ROLES: OrgRole[] = ["owner", "admin"];

export function isAdminRole(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function destructiveRoleError(role: OrgRole | null | undefined): string | null {
  return isAdminRole(role)
    ? null
    : "Only owners and admins can do this";
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!email || allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
