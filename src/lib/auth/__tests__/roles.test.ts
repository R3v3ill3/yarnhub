import { describe, expect, it } from "vitest";
import { destructiveRoleError, isAdminRole, isPlatformAdminEmail } from "../roles";

describe("org roles", () => {
  it("treats owner and admin as destructive-capable", () => {
    expect(isAdminRole("owner")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("member")).toBe(false);
    expect(destructiveRoleError("member")).toBeTruthy();
    expect(destructiveRoleError("admin")).toBeNull();
  });
});

describe("platform admin allow-list", () => {
  it("matches configured emails only", () => {
    const prev = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = "troy@reveille.net.au, ops@example.com";
    expect(isPlatformAdminEmail("troy@reveille.net.au")).toBe(true);
    expect(isPlatformAdminEmail("TROY@reveille.net.au")).toBe(true);
    expect(isPlatformAdminEmail("other@example.com")).toBe(false);
    process.env.PLATFORM_ADMIN_EMAILS = prev;
  });
});
