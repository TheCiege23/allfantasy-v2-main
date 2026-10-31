import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { requireCommissionerRole } from "@/lib/league/permissions"
import { isNativePlatform, listingVerification } from "@/lib/public-discovery/externalListing"
import { LEAGUE_VIBES_KEY, normalizeLeagueVibes, readLeagueVibes } from "@/lib/public-discovery/vibes"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ leagueId: string }> }

/**
 * /api/commissioner/leagues/[leagueId]/vibes — the league's vibe tags in Find a League.
 *
 *   GET → { vibes }
 *   PUT { vibes: string[] } → saves up to three from the fixed list (lib/public-discovery/vibes.ts)
 *
 * Who may write follows who may list: a native league's commissioner, or for a league that plays
 * elsewhere, the importer the import showed to be its commissioner (externalListing.ts).
 */
async function authorize(leagueId: string, scope: "read" | "write") {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) }
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, platform: true, isCommissioner: true, settings: true },
  })
  if (!league) return { error: NextResponse.json({ error: "League not found." }, { status: 404 }) }

  if (isNativePlatform(league.platform)) {
    try {
      await requireCommissionerRole(leagueId, userId, scope === "write" ? "league" : undefined)
    } catch (e) {
      if (e instanceof Response) return { error: e }
      throw e
    }
  } else if (league.userId !== userId || !listingVerification(league)) {
    return { error: NextResponse.json({ error: "Only the league's commissioner can set its vibe." }, { status: 403 }) }
  }
  return { league }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const auth = await authorize(leagueId, "read")
  if ("error" in auth) return auth.error
  return NextResponse.json({ vibes: readLeagueVibes(auth.league.settings) })
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const auth = await authorize(leagueId, "write")
  if ("error" in auth) return auth.error
  const body = (await req.json().catch(() => null)) as { vibes?: unknown } | null
  const vibes = normalizeLeagueVibes(body?.vibes)
  const settings =
    auth.league.settings && typeof auth.league.settings === "object" && !Array.isArray(auth.league.settings)
      ? (auth.league.settings as Record<string, unknown>)
      : {}
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...settings, [LEAGUE_VIBES_KEY]: vibes } as never },
  })
  return NextResponse.json({ ok: true, vibes })
}
