import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 300;

export function parseStripeSignatureHeader(header: string | null): {
  t: string;
  v1: string[];
} | null {
  if (!header) return null;
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === "t") t = value;
    if (key === "v1") v1.push(value);
  }
  if (!t || v1.length === 0) return null;
  return { t, v1 };
}

export function verifyStripeWebhookSignature(args: {
  rawBody: string;
  header: string | null;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const parsed = parseStripeSignatureHeader(args.header);
  if (!parsed) return false;
  const ts = Number(parsed.t);
  if (!Number.isFinite(ts)) return false;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_AGE_SECONDS) return false;

  const expectedHex = createHmac("sha256", args.secret)
    .update(`${parsed.t}.${args.rawBody}`)
    .digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");

  return parsed.v1.some((sig) => {
    const actual = Buffer.from(sig, "utf8");
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  });
}
