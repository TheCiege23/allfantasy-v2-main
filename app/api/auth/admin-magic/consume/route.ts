import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from "next/server";
import { verifyAdminMagicToken, signAdminSessionCookie } from "@/lib/adminSession";
import { isAdminEmailAllowed } from "@/lib/adminAuth";
import { getDeploymentLinkOrigin } from "@/lib/site-public-origin";

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

  const next = sanitizeNext(payload.next || "/admin");

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

