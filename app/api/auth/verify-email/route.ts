import { NextResponse } from "next/server"

/**
 * Legacy entry point for verification links: forwards to /verify/email.
 *
 * The Location is RELATIVE for the reason spelled out in app/verify/email/route.ts —
 * a route handler's `req.url` carries the address the server was BOUND to
 * (`https://0.0.0.0:8080` under `next start -H 0.0.0.0 -p 8080` on Railway),
 * not the host the visitor reached, so `url.origin` cannot be used to build a
 * link back to this site. The previous `getBaseUrl() || url.origin` only held
 * up because NEXTAUTH_URL happens to be set in production; the fallback was the
 * same dead host. Relative keeps the visitor on whichever host they arrived on
 * and depends on no env var at all.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams?.get("token")
  const target = token
    ? `/verify/email?token=${encodeURIComponent(token)}`
    : "/verify"
  return new NextResponse(null, { status: 308, headers: { Location: target } })
}

