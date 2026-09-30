import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getClientIp, consumeRateLimit } from "@/lib/rate-limit";
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = NextAuth(authOptions);

const AUTH_SIGNIN_MAX = 10;
const AUTH_SIGNIN_WINDOW_MS = 60 * 1000;
// Generous on purpose: this counts OAuth callbacks too, and carrier-grade NAT puts
// many phones behind one address. The per-ACCOUNT budget in lib/auth.ts is the
// real password-guessing guard; this only caps one address's total volume.
const AUTH_SIGNIN_SHARED_MAX = 60;
const AUTH_SIGNIN_SHARED_WINDOW_S = 10 * 60;

async function wrappedHandler(req: Request, ctx: unknown) {
  if (req.method === "POST") {
    const url = req.url ?? "";
    const isSignin = url.includes("signin") || url.includes("callback");
    if (isSignin) {
      const ip = getClientIp(req);
      const rl = consumeRateLimit({
        scope: "auth",
        action: "signin",
        ip,
        maxRequests: AUTH_SIGNIN_MAX,
        windowMs: AUTH_SIGNIN_WINDOW_MS,
        includeIpInKey: true,
      });
      // The limiter above is in-process: per replica, and reset by every deploy.
      // This ceiling is shared across all instances (lib/security/sharedRateLimit).
      const shared = rl.success
        ? await consumeSharedRateLimit(`signin-ip:${ip}`, AUTH_SIGNIN_SHARED_MAX, AUTH_SIGNIN_SHARED_WINDOW_S)
        : { success: false }
      if (!rl.success || !shared.success) {
        return NextResponse.json(
          { error: "Too many sign-in attempts. Please try again later." },
          { status: 429, headers: { "Retry-After": String(rl.success ? AUTH_SIGNIN_SHARED_WINDOW_S : rl.retryAfterSec) } }
        );
      }
    }
  }
  return handler(req as any, ctx as any);
}

export const GET = handler;
export const POST = wrappedHandler;