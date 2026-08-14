import { afterEach, describe, expect, it } from "vitest";
import { getSmsProviderForOrg, isMockSmsProvider } from "../provider";

const originalProvider = process.env.SMS_PROVIDER;

afterEach(() => {
  if (originalProvider === undefined) delete process.env.SMS_PROVIDER;
  else process.env.SMS_PROVIDER = originalProvider;
});

describe("getSmsProviderForOrg", () => {
  it("returns the mock provider when SMS_PROVIDER=mock", async () => {
    process.env.SMS_PROVIDER = "mock";
    const provider = await getSmsProviderForOrg("org-does-not-matter");
    expect(provider.name).toBe("mock");
    expect(isMockSmsProvider()).toBe(true);
  });
});
