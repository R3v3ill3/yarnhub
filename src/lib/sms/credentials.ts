import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1";

function credentialsKey(): Buffer {
  const raw = process.env.SMS_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error("SMS_CREDENTIALS_KEY is not set");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw).digest();
}

/** AES-256-GCM. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialsKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Unrecognised credentials ciphertext");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialsKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export interface MobileMessageCredentials {
  username: string;
  password: string;
}

export function encryptMobileMessageCredentials(
  creds: MobileMessageCredentials,
): string {
  return encryptSecret(JSON.stringify(creds));
}

export function decryptMobileMessageCredentials(
  ciphertext: string,
): MobileMessageCredentials {
  const parsed = JSON.parse(decryptSecret(ciphertext)) as Partial<MobileMessageCredentials>;
  if (!parsed.username || !parsed.password) {
    throw new Error("Decrypted Mobile Message credentials are incomplete");
  }
  return { username: parsed.username, password: parsed.password };
}
