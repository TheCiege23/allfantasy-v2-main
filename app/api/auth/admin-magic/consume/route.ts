import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from "next/server";
import {
  verifyAdminMagicToken,
  signAdminSessionCookie,
  signAdminMfaPending,
  ADMIN_MFA_PENDING_COOKIE,
  ADMIN_MFA_PENDING_TTL_SECONDS,
} from "@/lib/adminSession";
import { isAdminEmailAllowed } from "@/lib/adminAuth";
import { adminTotpRequired } from "@/lib/security/adminTotp";
import { getDeploymentLinkOrigin } from "@/lib/site-public-origin";
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit";
import { createHash } from "crypto";

function sanitizeNext(next?: string) {
  if (!next) return "/admin";
  if (!next.startsWith("/")) return "/admin";
  if (next.startsWith("//")) return "/admin";
  if (!next.startsWith("/admin")) return "/admin";
  return next;
}

export const GET = withApiUsage({ endpoint: "/api/auth/admin-magic/consume", tool: "AuthAdminMagicConsume" })(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams?.get("token") || "";
  const payload = verifyAdminMagicToken(token);

  /*
   * 🛑 THE REDIRECT ORIGIN CANNOT BE BUILT FROM `req.url` DIRECTLY. On Railway the Node process
   * sees its own internal bind address (0.0.0.0:8080) as the request URL's host, not the
   * public-facing host a reverse proxy actually served the request on -- resolving `next`
   * against that raw origin sent a real browser to a host it can never reach. Confirmed live
   * 2026-09-04: an admin's magic-link click landed on `https://0.0.0.0:8080/admin`.
   *
   * Using `req.url`'s origin here was previously deliberate, for Vercel specifically: a preview
   * deployment's req.url correctly carries THAT preview's own reachable hostname, which is why
   * the redirect used to be built directly from req.url instead of a fixed canonical origin (see
   * the test this replaces).
   *
   * getDeploymentLinkOrigin() makes the SAME preview-stays-on-preview guarantee via Vercel's own
   * env vars (VERCEL_BRANCH_URL/VERCEL_URL) rather than trusting req.url, so it is correct on
   * both hosts -- and it is already what the sibling /request route uses to build the emailed
   * link in the first place; this consume route was the one surface that never got the same fix.
   * `|| url.origin` matters only for local dev, where nothing is configured and req.url IS
   * trustworthy (no reverse proxy sits in front of it there).
   */
  const baseUrl = getDeploymentLinkOrigin() || url.origin;

  if (!payload?.email || !isAdminEmailAllowed(payload.email)) {
    // Send expired/invalid tokens back to the admin login page so the user lands in a
    // surface that understands "err=magic" and shows a clear retry prompt.
    return NextResponse.redirect(new URL("/admin-login?err=magic", baseUrl));
  }

  // The email calls this link one-time; make it so. The token is a stateless HMAC valid for
  // its whole window, so a forwarded or logged link otherwise mints a fresh admin session on
  // every click. Claim it once (shared store; the window outlives the token's own expiry).
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const claim = await consumeSharedRateLimit(`admin-magic-used:${tokenHash}`, 1, 30 * 60);
  if (!claim.success) {
    return NextResponse.redirect(new URL("/admin-login?err=magic", baseUrl));
  }

  const next = sanitizeNext(payload.next || "/admin");

  // While admin codes are required, the link proves the EMAIL and nothing more: whoever
  // can read that inbox still has to produce the authenticator code. Hold the proven
  // address in a short-lived pending cookie and send the browser to the code step.
  if (adminTotpRequired()) {
    const codeStep = new URL("/admin-login", baseUrl);
    codeStep.searchParams.set("step", "code");
    codeStep.searchParams.set("next", next);
    const pending = NextResponse.redirect(codeStep, { status: 303 });
    pending.cookies.set(ADMIN_MFA_PENDING_COOKIE, signAdminMfaPending(payload.email), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ADMIN_MFA_PENDING_TTL_SECONDS,
    });
    return pending;
  }

  const cookie = signAdminSessionCookie({
    authenticated: true,
    role: "admin",
    email: payload.email,
    name: "Admin",
  });

  const res = NextResponse.redirect(new URL(next, baseUrl), { status: 303 });

  res.cookies.set("admin_session", cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
})

