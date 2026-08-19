import crypto from "crypto";

export type AdminSessionPayload = {
  authenticated: boolean;
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  /**
   * How this admin session was established — audit metadata only, never the identity of a
   * specific person. "password" marks the shared-password login (which carries no email/id):
   * it lets attribution record the honest "password-admin" method instead of "unknown-admin".
   * Absent on legacy cookies signed before this field existed. Covered by the HMAC signature.
   */
  authMethod?: string;
  expiresAt?: number; // epoch ms
};

function adminSessionSecret(): string {
  const secret =
    process.env.ADMIN_SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    "";
  if (secret) return secret;
  // In production, never accept sessions without a configured secret.
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_SESSION_SECRET or ADMIN_PASSWORD must be set in production");
  }
  throw new Error("ADMIN_SESSION_SECRET or ADMIN_PASSWORD must be set for admin sessions");
}

export function signAdminSessionCookie(payload: AdminSessionPayload) {
  const secret = adminSessionSecret();

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const sigB64 = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sigB64}`;
}

export function verifyAdminSessionCookie(rawValue: string): AdminSessionPayload | null {
  let secret: string;
  try {
    secret = adminSessionSecret();
  } catch {
    return null;
  }

  const value = safeDecodeURIComponent(rawValue);
  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  if (!timingSafeEqualBase64Url(sigB64, expectedSig)) return null;

  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(json) as AdminSessionPayload;

    if (!payload?.authenticated) return null;
    if (payload.expiresAt && Date.now() > payload.expiresAt) return null;

    return payload;
  } catch {
    return null;
  }
}

function safeDecodeURIComponent(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function timingSafeEqualBase64Url(a: string, b: string) {
  try {
    const ab = Buffer.from(a, "base64url");
    const bb = Buffer.from(b, "base64url");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function b64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function b64urlDecode(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const base64 = s.replaceAll("-", "+").replaceAll("_", "/") + pad;
  return Buffer.from(base64, "base64");
}

type MagicPayload = {
  email: string;
  iat: number;
  exp: number;
  purpose: "admin_magic";
  next?: string;
};

function magicSecret() {
  return adminSessionSecret();
}

export function signAdminMagicToken(email: string, next?: string, ttlSeconds = 10 * 60) {
  const now = Math.floor(Date.now() / 1000);
  const payload: MagicPayload = {
    email,
    iat: now,
    exp: now + ttlSeconds,
    purpose: "admin_magic",
    next,
  };

  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", magicSecret()).update(payloadB64).digest();
  const sigB64 = b64url(sig);
  return `${payloadB64}.${sigB64}`;
}

export function verifyAdminMagicToken(token: string): MagicPayload | null {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return null;

    const expected = crypto.createHmac("sha256", magicSecret()).update(payloadB64).digest();
    const got = b64urlDecode(sigB64);

    if (expected.length !== got.length) return null;
    if (!crypto.timingSafeEqual(expected, got)) return null;

    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as MagicPayload;
    if (payload.purpose !== "admin_magic") return null;

    const now = Math.floor(Date.now() / 1000);
    if (now > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}
