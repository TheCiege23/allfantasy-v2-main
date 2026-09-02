import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sha256Hex } from "@/lib/tokens"

export const runtime = "nodejs"

function safeReturnTo(input: string | null): string {
  if (!input) return "/dashboard"
  return input.startsWith("/") ? input : "/dashboard"
}

/**
 * The Location is RELATIVE on purpose — never an origin taken from `req.url`.
 *
 * Next builds a route handler's `req.url` from the address the server was BOUND
 * to, not the host the visitor actually reached. `attachRequestMeta` in
 * next-server.js returns `${protocol}://${fetchHostname}:${port}${req.url}`
 * whenever a hostname and port were supplied, and this app must supply them:
 * Railway requires binding every interface, so scripts/railway-next-start.cjs
 * runs `next start -H 0.0.0.0 -p 8080`, and middleware.ts means the hostname
 * cannot be omitted ("To use middleware you must provide a `hostname` and
 * `port` to the Next.js Server"). So `new URL(req.url).origin` was
 * `https://0.0.0.0:8080` — measured in production on 2026-09-02:
 *
 *   GET https://allfantasy.ai/verify/email?token=…
 *   → 307  location: https://0.0.0.0:8080/verify?error=INVALID_LINK&returnTo=%2Fonboarding
 *
 * The emailed link itself was always correct. This redirect is what broke the
 * flow, and it broke it in the worst order: the transaction below marks the
 * address verified and deletes the token FIRST, so the visitor got a browser
 * connection error on a dead host, and a second click then reported
 * INVALID_LINK on an account that was in fact already verified.
 *
 * A relative Location is resolved by the browser against the URL it requested,
 * so it lands on whichever host the visitor came in on — correct in local dev,
 * on a preview deployment and in production alike, without trusting a Host
 * header the way `experimental.trustHostHeader` would.
 */
function redirectTo(path: string, returnTo?: string | null) {
  // Base is a parsing placeholder only; nothing but pathname + search is emitted.
  const target = new URL(path, "http://relative.invalid")
  if (returnTo && returnTo.startsWith("/")) {
    target.searchParams.set("returnTo", returnTo)
  }
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `${target.pathname}${target.search}` },
  })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams?.get("token")
  const returnTo = safeReturnTo(url.searchParams?.get("returnTo"))

  if (!token) return redirectTo("/verify?error=INVALID_LINK", returnTo)

  const tokenHash = sha256Hex(token)

  const row = await (prisma as any).emailVerifyToken.findUnique({
    where: { tokenHash },
  }).catch(() => null)

  if (!row) return redirectTo("/verify?error=INVALID_LINK", returnTo)

  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    await (prisma as any).emailVerifyToken.delete({ where: { tokenHash } }).catch(() => {})
    return redirectTo("/verify?error=EXPIRED_LINK", returnTo)
  }

  const now = new Date()

  let verifiedEmail: string | null = null

  try {
    await (prisma as any).$transaction(async (tx: any) => {
      const updated = await tx.appUser.findUnique({
        where: { id: row.userId },
        select: { email: true },
      })
      verifiedEmail = updated?.email ?? null

      await tx.appUser.updateMany({
        where: { id: row.userId },
        data: { emailVerified: now },
      })

      await tx.userProfile.updateMany({
        where: { userId: row.userId },
        data: { emailVerifiedAt: now },
      })

      await tx.emailVerifyToken.delete({
        where: { tokenHash },
      })
    })
  } catch (txErr) {
    console.error("[verify/email] Transaction failed:", txErr)
    return redirectTo("/verify?error=INVALID_LINK", returnTo)
  }

  // Mirror the confirmation onto the EarlyAccessSignup row so the admin "Signups"
  // tab shows the correct confirmed status for account-flow signups. Best-effort.
  if (verifiedEmail) {
    try {
      await (prisma as any).earlyAccessSignup.updateMany({
        where: { email: verifiedEmail, confirmedAt: null },
        data: { confirmedAt: now },
      })
    } catch (mirrorErr) {
      console.warn("[verify/email] EarlyAccessSignup confirm mirror failed (non-blocking):", mirrorErr)
    }
  }

  return redirectTo("/verify?verified=email", returnTo)
}

