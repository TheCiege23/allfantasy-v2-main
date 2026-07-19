import crypto from "crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { verifyAdminSessionCookie } from "@/lib/adminSession";
import { authOptions } from "@/lib/auth";
import { isAllFantasyTestEmail, isSiteAdmin } from "@/lib/auth/admin";
import { extractBearerToken, resolveAdminApiToken } from "@/lib/admin/adminApiTokens";

export type AdminUser = {
  id?: string;
  email?: string;
  name?: string;
  username?: string;
  role?: string;
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

function getCookieAdminAccessState(): AdminAccessState | null {
  const cookieStore = cookies();
  const adminSession = cookieStore.get("admin_session");
  if (!adminSession?.value) return null;

  const payload = verifyAdminSessionCookie(adminSession.value);
  if (!payload?.authenticated) return { status: "unauthenticated", source: "none" };

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
  };

  return { status: "admin", source: "admin_session", user };
}

async function getAppSessionAdminAccessState(): Promise<AdminAccessState> {
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

  const user: AdminUser = {
    id: session.user.id ?? undefined,
    email: session.user.email ?? undefined,
    name: session.user.name ?? undefined,
    username: session.user.username ?? undefined,
    role: isAdminEmailAllowed(session.user.email) || isSiteAdmin(session.user) ? "admin" : undefined,
  };

  if (isAdminEmailAllowed(session.user.email) || isSiteAdmin(session.user)) {
    return { status: "admin", source: "app_session", user };
  }

  return { status: "forbidden", source: "app_session", user };
}

export async function getAdminAccessState(): Promise<AdminAccessState> {
  const cookieState = getCookieAdminAccessState();
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

/**
 * Phase 1 of the per-admin token migration keeps the shared `ADMIN_PASSWORD` bearer
 * path working by default, so automated callers keep functioning while they are moved
 * onto per-admin tokens. Set `ADMIN_SHARED_SECRET_FALLBACK=off` once none are left;
 * Phase 2 deletes the path outright.
 *
 * Note this gates only the ADMIN_PASSWORD *bearer* path. `checkAdminSecret` covers the
 * `x-admin-secret` / `x-cron-secret` headers, which resolve `BRACKET_ADMIN_SECRET`
 * first — a separate cron credential, not the shared admin password — so disabling
 * this flag must not take crons down with it.
 */
function sharedSecretFallbackEnabled(): boolean {
  const raw = (process.env.ADMIN_SHARED_SECRET_FALLBACK || "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "off", "false", "no", "disabled"].includes(raw);
}

export type AdminBearerAuthSource = "admin_api_token" | "shared_secret";

/**
 * Admin gate for routes that also accept machine callers.
 *
 * A per-admin API token is tried first and resolves to a real identity — that is the
 * point of the token table, since the shared-secret branch below can only ever report
 * "somebody who knew the secret". `source` and `tokenId` are additive; existing callers
 * that only read `.ok` / `.user` are unaffected.
 */
export async function requireAdminOrBearer(request: Request) {
  const bearer = extractBearerToken(request);
  if (bearer) {
    // Authority comes from the owner being an admin RIGHT NOW, not from the token —
    // so an owner who loses admin access loses their tokens with it.
    const owner = await resolveAdminApiToken(bearer, isAdminEmailAllowed);
    if (owner) {
      return {
        ok: true as const,
        user: {
          id: owner.ownerUserId ?? undefined,
          email: owner.ownerEmail,
          role: "admin",
        } as AdminUser,
        source: "admin_api_token" as AdminBearerAuthSource,
        tokenId: owner.tokenId,
      };
    }
  }

  if (sharedSecretFallbackEnabled() && checkBearerToken(request)) {
    return {
      ok: true as const,
      user: { role: "admin" } as AdminUser,
      source: "shared_secret" as AdminBearerAuthSource,
    };
  }

  if (checkAdminSecret(request)) {
    return {
      ok: true as const,
      user: { role: "admin" } as AdminUser,
      source: "shared_secret" as AdminBearerAuthSource,
    };
  }

  return requireAdmin();
}

export function isAuthorizedRequest(request: Request): boolean {
  if (checkBearerToken(request) || checkAdminSecret(request)) return true;

  try {
    const cookieStore = cookies();
    const adminSession = cookieStore.get("admin_session");
    if (!adminSession?.value) return false;
    const payload = verifyAdminSessionCookie(adminSession.value);
    if (!payload?.authenticated) return false;
    const role = payload.role?.toLowerCase();
    return role === "admin" || !!isAdminEmailAllowed(payload.email);
  } catch {
    return false;
  }
}
