/**
 * GET /api/leagues/[leagueId]/stat-corrections — the league's Stat Corrections screen.
 *
 * Every correction that changed this league: official ones applied by the correction window
 * (lib/redraft/statCorrections.ts) and the commish's own league-only corrections
 * (applyNflRedraftStatCorrectionToSeason). Both are recorded as `LeagueEvent` rows of one type, so
 * this reads one place. Any league member may look; the window setting is the commish's and is saved
 * through the shared settings patch (`statCorrectionDays`).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { STAT_CORRECTION_EVENT, readStatCorrectionDays } from '@/lib/redraft/statCorrections'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

type Row = {
  id: string
  at: string
  week: number | null
  source: 'official' | 'commish'
  reason: string | null
  players: Array<{ playerId: string; playerName: string | null; teamName: string | null; pointsBefore: number; pointsAfter: number }>
  matchups: Array<{ homeTeam: string | null; awayTeam: string | null; before: { home: number; away: number }; after: { home: number; away: number }; resultFlipped: boolean }>
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** One ledger row from either writer's payload. Exported for tests. */
export function toCorrectionRow(event: { id: string; createdAt: Date; payload: unknown }): Row {
  const p = (event.payload ?? {}) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [])
  return {
    id: event.id,
    at: event.createdAt.toISOString(),
    week: p.week == null ? null : num(p.week),
    source: p.source === 'official' ? 'official' : 'commish',
    reason: typeof p.reason === 'string' ? p.reason : null,
    players: list(p.corrections).map((c) => ({
      playerId: String(c.playerId ?? ''),
      playerName: typeof c.playerName === 'string' ? c.playerName : null,
      teamName: typeof c.teamName === 'string' ? c.teamName : null,
      pointsBefore: num(c.pointsBefore),
      pointsAfter: num(c.pointsAfter),
    })),
    matchups: list(p.matchups).map((m) => {
      const b = (m.before ?? {}) as Record<string, unknown>
      const a = (m.after ?? {}) as Record<string, unknown>
      return {
        homeTeam: typeof m.homeTeam === 'string' ? m.homeTeam : null,
        awayTeam: typeof m.awayTeam === 'string' ? m.awayTeam : null,
        before: { home: num(b.home), away: num(b.away) },
        after: { home: num(a.home), away: num(a.away) },
        resultFlipped: m.resultFlipped === true,
      }
    }),
  }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = ((await ctx.params)?.leagueId ?? '').trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const events = await prisma.leagueEvent.findMany({
    where: { leagueId, eventType: STAT_CORRECTION_EVENT },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, createdAt: true, payload: true },
  })
  const rows = events.map(toCorrectionRow)

  // A commish correction records the player id only; name it from the league's own roster rows.
  const unnamed = [...new Set(rows.flatMap((r) => r.players.filter((p) => !p.playerName).map((p) => p.playerId)))].filter(Boolean)
  if (unnamed.length > 0) {
    const names = await prisma.redraftRosterPlayer.findMany({
      where: { playerId: { in: unnamed }, roster: { leagueId } },
      select: { playerId: true, playerName: true },
    })
    const nameOf = new Map(names.map((n) => [n.playerId, n.playerName]))
    for (const r of rows) for (const p of r.players) p.playerName ??= nameOf.get(p.playerId) ?? null
  }

  return NextResponse.json({
    supported: isNativePlatform(league.platform) && String(league.sport ?? '').toUpperCase() === 'NFL',
    days: readStatCorrectionDays(league.settings),
    canEdit: isCommissionerRole(await getLeagueRole(leagueId, userId)),
    corrections: rows,
  })
}
