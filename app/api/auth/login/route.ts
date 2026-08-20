import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { signAdminSessionCookie } from "@/lib/adminSession";

type Bucket = { count: number; resetAt: number; lockedUntil?: number };
const buckets = new Map<string, Bucket>();

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 8;
const LOCK_MS = 15 * 60 * 1000;

function ipFrom(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return "local";
}

function bucketFor(key: string): Bucket {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b) {
    const nb: Bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, nb);
    return nb;
  }

  if (now > b.resetAt) {
    b.count = 0;
    b.resetAt = now + WINDOW_MS;
    delete b.lockedUntil;
  }

  return b;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sanitizeNext(next?: string) {
  if (!next) return "/admin";
  if (!next.startsWith("/")) return "/admin";
  if (next.startsWith("//")) return "/admin";
  if (!next.startsWith("/admin")) return "/admin";
  return next;
}

export const POST = withApiUsage({ endpoint: "/api/auth/login", tool: "AuthLogin" })(async (req: Request) => {
  const ip = ipFrom(req);
  const key = `admin_login:${ip}`;
  const b = bucketFor(key);
  const now = Date.now();

  if (b.lockedUntil && now < b.lockedUntil) {
    const remaining = 0;
    return NextResponse.json(
      { error: "Too many attempts. Try again soon.", remaining, lockedUntil: b.lockedUntil },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({} as any));
  const password = String(body?.password || "");
  const nextRaw = String(body?.next || "/admin");
  const next = sanitizeNext(nextRaw);

  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || "";
  const adminPassword = process.env.ADMIN_PASSWORD || "";

  let ok = false;
  if (password && (adminPassword || adminPasswordHash)) {
    if (adminPassword) ok = safeEqual(password, adminPassword);
    if (!ok && adminPasswordHash) ok = await bcrypt.compare(password, adminPasswordHash);
  }

  if (!ok) {
    b.count += 1;

    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - b.count);

    if (b.count >= MAX_ATTEMPTS) {
      b.lockedUntil = now + LOCK_MS;
      return NextResponse.json(
        { error: "Too many attempts. You are temporarily locked.", remaining: 0, lockedUntil: b.lockedUntil },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Invalid password.", remaining: attemptsLeft, lockedUntil: null },
      { status: 401 }
    );
  }

  b.count = 0;
  b.resetAt = now + WINDOW_MS;
  delete b.lockedUntil;

  const cookie = signAdminSessionCookie({
    authenticated: true,
    role: "admin",
    // Shared-password login carries no per-person identity. Record the METHOD so audited
    // actions attribute to the honest "password-admin" (see resolveAdminAuditIdentity),
    // never "unknown-admin" and never a specific administrator's email.
    authMethod: "password",
  });

  const res = NextResponse.json({ ok: true, next });

  res.cookies.set("admin_session", cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
})
