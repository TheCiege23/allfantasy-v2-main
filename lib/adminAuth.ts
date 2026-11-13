import crypto from "crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { verifyAdminSessionCookie, type AdminSessionPayload } from "@/lib/adminSession";
import { authOptions } from "@/lib/auth";
import { isAllFantasyTestEmail, isAllFantasyTestUsername } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { adminTotpRequired } from "@/lib/security/adminTotp";

/**
 * Whether a VERIFIED admin_session cookie may still be used. Two ways a genuine,
 * correctly signed cookie is no longer enough:
 *
 *  - It came from the retired shared-password login. That login is refused in production
 *    (app/api/auth/login/route.ts), and a cookie it minted before the change would
 *    otherwise keep working for the rest of its 7-day life.
 *  - Admin codes are required (ADMIN_TOTP_SECRETS is set) and this session was not minted
 *    by the code check. That covers magic-link and bootstrap sessions as well as old ones.
 */
export function isAdminSessionPayloadUsable(payload: AdminSessionPayload): boolean {
  if (payload.authMethod === "password" && process.env.NODE_ENV === "production") return false;
  if (adminTotpRequired() && payload.mfa !== true) return false;
  return true;
}

export type AdminUser = {
  id?: string;
  email?: string;
  name?: string;
  username?: string;
  role?: string;
  /** Audit metadata: how the admin session was established (e.g. "password"). Not an identity. */
  authMethod?: string;
};

export type AdminAccessState =
  | { status: "admin"; source: "admin_session" | "app_session"; user: AdminUser }
  | { status: "unauthenticated"; source: "none"; user?: undefined }
  | { status: "forbidden"; source: "app_session" | "admin_session"; user?: AdminUser };

export function adminUnauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function adminForbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function isAdminEmailAllowed(email?: string | null) {
  const e = (email || "").toLowerCase();
  if (isAllFantasyTestEmail(e)) return true;
  const allow = (process.env.ADMIN_EMAILS || "")
    .split(/[\n\r,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(e) && allow.includes(e);
}

export function isAdminRole(role?: string | null) {
  return (role || "").toLowerCase() === "admin";
}

function timingSafeCompare(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function checkBearerToken(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (!adminPassword || !token) return false;
  return timingSafeCompare(token, adminPassword);
}

function checkAdminSecret(request: Request): boolean {
  const headerSecret =
    request.headers.get("x-admin-secret") ??
    request.headers.get("x-cron-secret") ??
    "";
  if (!headerSecret) return false;
  const adminSecret =
    process.env.BRACKET_ADMIN_SECRET || process.env.ADMIN_PASSWORD || "";
  if (!adminSecret) return false;
  return timingSafeCompare(headerSecret, adminSecret);
}

async function getCookieAdminAccessState(): Promise<AdminAccessState | null> {
  const cookieStore = await cookies();
  const adminSession = cookieStore.get("admin_session");
  if (!adminSession?.value) return null;

  const payload = verifyAdminSessionCookie(adminSession.value);
  if (!payload?.authenticated) return { status: "unauthenticated", source: "none" };
  if (!isAdminSessionPayloadUsable(payload)) return { status: "unauthenticated", source: "none" };

  const email = payload.email?.toLowerCase();
  const role = payload.role?.toLowerCase();

  if (!(role === "admin" || isAdminEmailAllowed(email))) {
    return {
      status: "forbidden",
      source: "admin_session",
      user: {
        id: payload.id,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      },
    };
  }

  const user: AdminUser = {
    id: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    authMethod: payload.authMethod,
  };

  return { status: "admin", source: "admin_session", user };
}

/**
 * Does the account behind this session hold `email` AND has it verified it?
 * Read from the database, never from the token: the token's email is copied
 * from the row whether or not it was ever proven. Any failure answers "no".
 */
async function isEmailProvenForUser(userId: string, email: string | null | undefined): Promise<boolean> {
  const wanted = String(email ?? "").trim().toLowerCase();
  if (!userId || !wanted) return false;
  try {
    const row = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    return Boolean(row?.emailVerified) && String(row?.email ?? "").trim().toLowerCase() === wanted;
  } catch {
    return false;
  }
}

/**
 * The signed-in app account, and whether the allowlist makes it an administrator —
 * WITHOUT the second-factor requirement. Exported for the code route, which needs to know
 * whose code it is checking; everything that grants access goes through
 * getAppSessionAdminAccessState below instead.
 */
export async function getAppSessionAdminCandidate(): Promise<AdminAccessState> {
  const session = (await getServerSession(authOptions as any).catch(() => null)) as {
    user?: {
      id?: string | null;
      email?: string | null;
      name?: string | null;
      username?: string | null;
    };
  } | null;

  if (!session?.user?.id) {
    return { status: "unauthenticated", source: "none" };
  }

  // ⚠ An allowlisted EMAIL is only a credential once the account has PROVEN it.
  // Registration and email-change both let an account hold an address nobody
  // has verified, so trusting session.user.email alone let anyone who claimed an
  // allowlisted address (one with no account yet) sign in as a full admin. The
  // handle path is separate and unchanged — it cannot be self-assigned (see
  // lib/auth/admin.ts) and it is how the founder's second provider signs in.
  const grantedByHandle = isAllFantasyTestUsername(session.user.username);
  const grantedByEmail =
    !grantedByHandle &&
    isAdminEmailAllowed(session.user.email) &&
    (await isEmailProvenForUser(session.user.id, session.user.email));
  const isAdmin = grantedByHandle || grantedByEmail;

  const user: AdminUser = {
    id: session.user.id ?? undefined,
    email: session.user.email ?? undefined,
    name: session.user.name ?? undefined,
    username: session.user.username ?? undefined,
    role: isAdmin ? "admin" : undefined,
  };

  if (isAdmin) {
    return { status: "admin", source: "app_session", user };
  }

  return { status: "forbidden", source: "app_session", user };
}

async function getAppSessionAdminAccessState(): Promise<AdminAccessState> {
  const candidate = await getAppSessionAdminCandidate();
  // 🛑 While admin codes are required, an allowlisted account is a CANDIDATE, not an admin:
  // a stolen Google or email login must not reach /admin by itself. "unauthenticated"
  // sends every admin page to /admin-login, which asks this account for its code.
  if (candidate.status === "admin" && adminTotpRequired()) {
    return { status: "unauthenticated", source: "none" };
  }
  return candidate;
}

export async function getAdminAccessState(): Promise<AdminAccessState> {
  const cookieState = await getCookieAdminAccessState();
  if (cookieState?.status === "admin") return cookieState;
  const sessionState = await getAppSessionAdminAccessState();
  if (sessionState.status === "admin") return sessionState;
  return cookieState?.status === "forbidden" ? cookieState : sessionState;
}

export async function requireAdmin() {
  const state = await getAdminAccessState();
  if (state.status === "admin") {
    return { ok: true as const, user: state.user };
  }

  return {
    ok: false as const,
    res: state.status === "forbidden" ? adminForbidden() : adminUnauthorized(),
  };
}

export async function requireAdminOrBearer(request: Request) {
  if (checkBearerToken(request) || checkAdminSecret(request)) {
    return { ok: true as const, user: { role: "admin" } as AdminUser };
  }

  return requireAdmin();
}

/** One cookie's value from a request's Cookie header, or null. */
function readRequestCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/*
 * ⚠ DELIBERATELY SYNCHRONOUS. Next 15 made `cookies()` async; converting this to
 * async would turn every `Boolean(isAuthorizedRequest(req) || …)` that missed an
 * `await` into `Boolean(promise)` — always true, a silent admin bypass that no
 * type check reports. It already receives the request, so it reads the cookie
 * from the request's own Cookie header instead of next/headers.
 */
export function isAuthorizedRequest(request: Request): boolean {
  if (checkBearerToken(request) || checkAdminSecret(request)) return true;

  try {
    const adminSessionValue = readRequestCookie(request, "admin_session");
    if (!adminSessionValue) return false;
    const payload = verifyAdminSessionCookie(adminSessionValue);
    if (!payload?.authenticated) return false;
    if (!isAdminSessionPayloadUsable(payload)) return false;
    const role = payload.role?.toLowerCase();
    return role === "admin" || !!isAdminEmailAllowed(payload.email);
  } catch {
    return false;
  }
}
