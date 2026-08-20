import crypto from "crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { verifyAdminSessionCookie } from "@/lib/adminSession";
import { authOptions } from "@/lib/auth";
import { isAllFantasyTestEmail, isSiteAdmin } from "@/lib/auth/admin";

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
    authMethod: payload.authMethod,
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

export async function requireAdminOrBearer(request: Request) {
  if (checkBearerToken(request) || checkAdminSecret(request)) {
    return { ok: true as const, user: { role: "admin" } as AdminUser };
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
