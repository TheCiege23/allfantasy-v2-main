/**
 * E2E-only Spotify link fixture.
 *
 * ── WHY THIS FILE CAME BACK ──────────────────────────────────────────────────
 *
 * `e2e/auth-spotify-signin.spec.ts` POSTs here to put the signed-in test user into a
 * "Spotify connected" state without standing up a real OAuth round trip. The route was
 * moved out of `app/` by the production route prune in commit 90542801c (it landed in
 * `.next-build-disabled-routes/` as a flattened copy) and then disappeared entirely, so
 * the POST had been 404ing and the spec failed on `expect(linkRes.ok()).toBeTruthy()`
 * for every run since. Same shape as the two route files restored alongside it: not
 * deleted on purpose, lost in a bulk move.
 *
 * ── THE GATE IS DELIBERATELY STRICTER THAN THE ORIGINAL ──────────────────────
 *
 * The version in history checked only `NODE_ENV !== "production"`. This one also
 * requires the `x-allfantasy-e2e` header, which is the convention every other seam in
 * this repo uses (see app/api/auth/register and app/api/e2e/decision-os-proof-league).
 * That matters more here than elsewhere, because this endpoint FABRICATES an OAuth
 * link: an env check alone would leave it reachable on any non-production deploy —
 * including a preview, which as `lib/email/undeliverableDomains.ts` records talks to
 * the production database.
 *
 * It can still only ever affect the CALLER'S OWN account: every write is keyed on
 * `session.user.id`, and an anonymous request is rejected. There is no parameter that
 * lets one user link a provider onto another.
 */
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

function e2eAllowed(request: Request): boolean {
  const envAllows = process.env.NODE_ENV !== "production" || process.env.ALLOW_E2E_SEED === "1"
  return envAllows && request.headers.get("x-allfantasy-e2e") === "1"
}

export async function POST(request: Request) {
  // 404 rather than 403: an endpoint that is not enabled here should not advertise itself.
  if (!e2eAllowed(request)) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 })
  }

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const providerAccountId = `mock-spotify-${userId}`
  const nowEpoch = Math.floor(Date.now() / 1000)

  // Delete-then-create rather than upsert: `AuthAccount` is unique on
  // (provider, providerAccountId), not on (userId, provider), so a re-run would
  // otherwise collide with the row the previous run left behind.
  await prisma.authAccount.deleteMany({
    where: {
      userId,
      provider: "spotify",
    },
  })

  await prisma.authAccount.create({
    data: {
      userId,
      type: "oauth",
      provider: "spotify",
      providerAccountId,
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      token_type: "Bearer",
      scope: "user-read-email",
      expires_at: nowEpoch + 3600,
    },
  })

  await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      spotifyAccessToken: "mock-access-token",
      spotifyRefreshToken: "mock-refresh-token",
      spotifyExpiresAt: new Date(Date.now() + 3600 * 1000),
      spotifyDisplayName: "Spotify Mock User",
      spotifyConnectedAt: new Date(),
    },
    update: {
      spotifyAccessToken: "mock-access-token",
      spotifyRefreshToken: "mock-refresh-token",
      spotifyExpiresAt: new Date(Date.now() + 3600 * 1000),
      spotifyDisplayName: "Spotify Mock User",
      spotifyConnectedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}
