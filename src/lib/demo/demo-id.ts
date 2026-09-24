import { createHash } from "node:crypto";

export const REDGUM_DEMO_KEY = "redgum-bargaining";

/** Stable id so loading the demo twice replaces the same rows. */
export function demoId(orgId: string, key: string): string {
  const hash = createHash("sha256")
    .update(`yarnhub-demo:${REDGUM_DEMO_KEY}:${orgId}:${key}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
