import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { resolveLeagueAccess } from '@/lib/league-access'
import { storylineEntitled, storylineUpgradePath } from '@/lib/storyline-studio/storylineService'
import { generateSeasonRecapNarrative, readCachedSeasonRecapNarrative } from '@/lib/season-recap/seasonRecapAi'
import type { RecapLanguage } from '@/lib/season-recap/seasonRecapFacts'

export const dynamic = 'force-dynamic'

/**
 * /api/leagues/[leagueId]/season-recap-ai — Chimmy's season recap (lib/season-recap/seasonRecapAi.ts).
 *
 *   GET  ?season=&lang=    the cached recap for that season (any league member), plus whether the
 *                          viewer may write one (`canGenerate`) and the upgrade path when they lack the plan
 *   POST { season, lang?, regenerate? }   write it — commissioner / co-commissioner with AF Commissioner
 *
 * The plan is checked BEFORE the cap and the model, so a member without it costs nothing. Served from
 * the [section] dispatcher; no route of its own.
 */

type Ctx = { params: Promise<{ leagueId: string }> }

const langOf = (raw: unknown): RecapLanguage => (raw === 'es' ? 'es' : 'en')
const seasonOf = (raw: unknown): number | null => {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isInteger(n) && n > 1900 && n < 3000 ? n : null
}

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(req: Request, ctx: Ctx) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const url = new URL(req.url)
  const season = seasonOf(url.searchParams.get('season'))
  if (!leagueId || !season) return NextResponse.json({ error: 'leagueId and season required' }, { status: 400 })
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const lang = langOf(url.searchParams.get('lang'))
  const role = await getLeagueRole(leagueId, userId)
  const isCommissioner = role === 'commissioner' || role === 'co_commissioner'
  const entitled = isCommissioner ? await storylineEntitled(userId) : false
  const narrative = await readCachedSeasonRecapNarrative(leagueId, season, lang).catch(() => null)
  return NextResponse.json({
    narrative,
    isCommissioner,
    entitled,
    canGenerate: isCommissioner && entitled,
    upgradePath: isCommissioner && !entitled ? await storylineUpgradePath(userId) : null,
  })
}

export async function POST(req: Request, ctx: Ctx) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const season = seasonOf(body.season)
  if (!leagueId || !season) return NextResponse.json({ error: 'leagueId and season required' }, { status: 400 })
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role !== 'commissioner' && role !== 'co_commissioner') return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (!(await storylineEntitled(userId))) {
    return NextResponse.json({ error: 'not_entitled', upgradePath: await storylineUpgradePath(userId) }, { status: 402 })
  }

  const out = await generateSeasonRecapNarrative({ leagueId, season, userId, lang: langOf(body.lang), regenerate: body.regenerate === true })
  if (!out.ok && out.reason === 'no_recap') return NextResponse.json({ error: 'No recap for this season' }, { status: 404 })
  if (!out.ok) return NextResponse.json({ error: 'daily_cap', message: out.message, resetsAt: out.resetsAt, limit: out.limit }, { status: 429 })
  return NextResponse.json({ narrative: out.narrative, cached: out.cached, factGuardErrors: out.factGuardErrors })
}
