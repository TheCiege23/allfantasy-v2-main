import type { C2CMatchupScore } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { calculateOfficialTeamScore, leagueUsesDevyEngine } from '@/lib/devy/scoringEligibilityEngine'
import { leagueUsesC2CEngine } from '@/lib/c2c/scoringEngine'
import { getCanonicalNflMatchupContext } from '@/lib/nfl-data-foundation/nflDataFoundationService'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { matchupContextFromUnifiedWire } from '@/lib/player-data/adapters/matchupPlayerAdapter'

export const dynamic = 'force-dynamic'

type MatchupPlayerContext = ReturnType<typeof matchupContextFromUnifiedWire>

async function buildUnifiedNflMatchupPlayers(input: {
  leagueId: string
  rosterIds: string[]
}): Promise<{ byRosterId: Record<string, MatchupPlayerContext[]>; playerCount: number }> {
  const rosterIds = Array.from(new Set(input.rosterIds.map((id) => String(id ?? '').trim()).filter(Boolean)))
  if (!rosterIds.length) return { byRosterId: {}, playerCount: 0 }

  const rosterPlayers = await prisma.redraftRosterPlayer
    .findMany({
      where: { rosterId: { in: rosterIds }, droppedAt: null },
      select: { rosterId: true, playerId: true },
    })
    .catch(() => [])
  const playerIds = Array.from(new Set(rosterPlayers.map((player) => player.playerId).filter(Boolean)))
  if (!playerIds.length) return { byRosterId: {}, playerCount: 0 }

  const rows = await getNormalizedPlayerData({
    surface: 'matchup',
    leagueId: input.leagueId,
    playerIds,
    limit: Math.max(playerIds.length, 1),
  }).catch(() => [])
  const contextByPlayerId = new Map(
    rows.map((row) => {
      const wire = serializeUnifiedPlayerForApi(row)
      return [wire.id, matchupContextFromUnifiedWire(wire)] as const
    }),
  )
  const byRosterId: Record<string, MatchupPlayerContext[]> = {}
  for (const player of rosterPlayers) {
    const context = contextByPlayerId.get(player.playerId)
    if (!context) continue
    ;(byRosterId[player.rosterId] ??= []).push(context)
  }
  return { byRosterId, playerCount: contextByPlayerId.size }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const matchupId = req.nextUrl.searchParams?.get('matchupId')?.trim()
  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const week = req.nextUrl.searchParams?.get('week')

  if (matchupId) {
    const m = await prisma.redraftMatchup.findFirst({
      where: { id: matchupId },
      include: { homeRoster: true, awayRoster: true, season: true },
    })
    if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const gate = await assertLeagueMember(m.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const canonicalNflMatchup =
      String(m.season.sport).toUpperCase() === 'NFL'
        ? await getCanonicalNflMatchupContext({ matchupId: m.id }).catch(() => null)
        : null
    const unifiedNflMatchupPlayers =
      String(m.season.sport).toUpperCase() === 'NFL'
        ? await buildUnifiedNflMatchupPlayers({
            leagueId: m.leagueId,
            rosterIds: [m.homeRosterId, m.awayRosterId].filter((id): id is string => Boolean(id)),
          })
        : null
    return NextResponse.json({ matchup: m, canonicalNflMatchup, unifiedNflMatchupPlayers })
  }

  if (seasonId && week != null) {
    const w = Number(week)
    const season = await prisma.redraftSeason.findFirst({ where: { id: seasonId } })
    if (!season) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const gate = await assertLeagueMember(season.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

    const matchups = await prisma.redraftMatchup.findMany({
      where: { seasonId, week: w },
      include: { homeRoster: true, awayRoster: true },
    })
    const canonicalNflMatchups =
      String(season.sport).toUpperCase() === 'NFL'
        ? Object.fromEntries(
            await Promise.all(
              matchups.map(async (mu: { id: string }) => [
                mu.id,
                await getCanonicalNflMatchupContext({ matchupId: mu.id }).catch(() => null),
              ]),
            ),
          )
        : null
    const unifiedNflMatchupPlayers =
      String(season.sport).toUpperCase() === 'NFL'
        ? await buildUnifiedNflMatchupPlayers({
            leagueId: season.leagueId,
            rosterIds: matchups
              .flatMap((mu) => [mu.homeRosterId, mu.awayRosterId])
              .filter((id): id is string => Boolean(id)),
          })
        : null
    if (await leagueUsesC2CEngine(season.leagueId)) {
      const c2cScores: Record<string, { home: C2CMatchupScore | null; away: C2CMatchupScore | null }> = {}
      for (const mu of matchups) {
        const home = await prisma.c2CMatchupScore.findUnique({
          where: {
            leagueId_matchupId_rosterId: {
              leagueId: season.leagueId,
              matchupId: mu.id,
              rosterId: mu.homeRosterId,
            },
          },
        })
        const away = mu.awayRosterId
          ? await prisma.c2CMatchupScore.findUnique({
              where: {
                leagueId_matchupId_rosterId: {
                  leagueId: season.leagueId,
                  matchupId: mu.id,
                  rosterId: mu.awayRosterId,
                },
              },
            })
          : null
        c2cScores[mu.id] = { home, away }
      }
      return NextResponse.json({ matchups, c2cScores, canonicalNflMatchups, unifiedNflMatchupPlayers })
    }
    if (await leagueUsesDevyEngine(season.leagueId)) {
      const devyScores: Record<
        string,
        { home: Awaited<ReturnType<typeof calculateOfficialTeamScore>>; away: Awaited<ReturnType<typeof calculateOfficialTeamScore>> | null }
      > = {}
      for (const mu of matchups) {
        const home = await calculateOfficialTeamScore(season.leagueId, mu.homeRosterId, w, season.season)
        const away = mu.awayRosterId
          ? await calculateOfficialTeamScore(season.leagueId, mu.awayRosterId, w, season.season)
          : null
        devyScores[mu.id] = { home, away }
      }
      return NextResponse.json({ matchups, devyScores, canonicalNflMatchups, unifiedNflMatchupPlayers })
    }
    return NextResponse.json({ matchups, canonicalNflMatchups, unifiedNflMatchupPlayers })
  }

  return NextResponse.json({ error: 'matchupId or seasonId+week required' }, { status: 400 })
}

