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
  /**
   * True only on a session minted after an authenticator code was checked
   * (app/api/auth/admin-totp). While ADMIN_TOTP_SECRETS is set, lib/adminAuth.ts refuses
   * any admin session without it. Covered by the HMAC signature, so it cannot be added.
   */
  mfa?: boolean;
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

/**
 * Server-side lifetime of an admin session, matching the cookie's own `maxAge`.
 *
 * 🛑 THE SERVER MUST ENFORCE EXPIRY, NOT JUST THE BROWSER. The password and magic-link
 * logins signed `{authenticated, role:"admin"}` with no `expiresAt`, and verification
 * treated a missing `expiresAt` as valid forever — so a copied `admin_session` value
 * worked until the signing secret was rotated, whatever its cookie maxAge said.
 */
export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAdminSessionCookie(payload: AdminSessionPayload) {
  const secret = adminSessionSecret();

  const payloadJson = JSON.stringify({
    ...payload,
    expiresAt: payload.expiresAt ?? Date.now() + ADMIN_SESSION_TTL_MS,
  });
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
    // No expiry = a cookie minted before expiry was enforced: refuse it, the admin signs in again.
    if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) return null;

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

/**
 * "This browser proved an admin email with a magic link and still owes a code." Set by the
 * magic-link consume route while ADMIN_TOTP_SECRETS is set, read by the code route. It
 * grants nothing on its own: it is not an admin_session, and verifyAdminSessionCookie
 * rejects it (it has no `authenticated`).
 */
export const ADMIN_MFA_PENDING_COOKIE = "admin_mfa_pending";
export const ADMIN_MFA_PENDING_TTL_SECONDS = 10 * 60;

type MfaPendingPayload = { purpose: "admin_mfa_pending"; email: string; exp: number };

export function signAdminMfaPending(email: string, ttlSeconds = ADMIN_MFA_PENDING_TTL_SECONDS) {
  const payload: MfaPendingPayload = {
    purpose: "admin_mfa_pending",
    email,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", adminSessionSecret()).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

export function verifyAdminMfaPending(raw: string | null | undefined): { email: string } | null {
  try {
    const value = safeDecodeURIComponent(String(raw ?? ""));
    const [payloadB64, sigB64] = value.split(".");
    if (!payloadB64 || !sigB64) return null;
    const expected = crypto.createHmac("sha256", adminSessionSecret()).update(payloadB64).digest();
    const got = b64urlDecode(sigB64);
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as MfaPendingPayload;
    if (payload.purpose !== "admin_mfa_pending" || !payload.email) return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
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
