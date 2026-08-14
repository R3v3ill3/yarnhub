import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../credentials";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a payload with SMS_CREDENTIALS_KEY", () => {
    const previous = process.env.SMS_CREDENTIALS_KEY;
    process.env.SMS_CREDENTIALS_KEY = "a".repeat(64);
    try {
      const cipher = encryptSecret("mm-password");
      expect(cipher.startsWith("v1.")).toBe(true);
      expect(cipher).not.toContain("mm-password");
      expect(decryptSecret(cipher)).toBe("mm-password");
    } finally {
      if (previous === undefined) delete process.env.SMS_CREDENTIALS_KEY;
      else process.env.SMS_CREDENTIALS_KEY = previous;
    }
  });
});
