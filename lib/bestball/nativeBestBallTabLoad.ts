import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { buildBestBallSlots } from '@/lib/redraft/scoringEngine'
import { loadBestBallWeekRosterRows } from '@/lib/redraft/bestBallWeekRoster'
import { buildNativeLineupCard, lineupPositionsForWeek, lineupSlotsForWeek, snapshotSide, type NativeLineupCard } from '@/lib/bestball/nativeBestBallTab'

/** Matchup rows that have been scored at least once. */
const SCORED = ['active', 'final']

export type NativeBestBallTabBody = {
  selectedWeek: number
  weeksAvailable: number[]
  lineups: NativeLineupCard[]
  rosterComposition: Array<{ rosterId: string; teamName: string; playerCount: number }>
  standings: Array<{ rosterId: string; rank: number; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>
  history: Array<{ rosterId: string; week: number; totalPoints: number; status: 'final' | 'provisional' }>
}

/**
 * The Best Ball tab's data for a league AllFantasy scores itself (see nativeBestBallTab.ts), or null for
 * an imported league or one with no native season — the handler then keeps its legacy reads.
 */
export async function loadNativeBestBallTab(args: {
  leagueId: string
  platform: string | null | undefined
  sport: string
  settings: unknown
  requestedWeek: number
  /** A season-total (cumulative) league ranks on points; head-to-head on record, then points. */
  rankBy: 'points' | 'record'
}): Promise<{ season: number; body: NativeBestBallTabBody } | null> {
  if (resolveWriteAuthority(args.platform) !== 'NATIVE') return null
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: args.leagueId },
    orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, season: true },
  })
  if (!season) return null

  const [rosters, matchups] = await Promise.all([
    prisma.redraftRoster.findMany({
      where: { seasonId: season.id, leagueId: args.leagueId },
      select: { id: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgainst: true },
    }),
    prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, status: { in: SCORED } },
      select: { id: true, week: true, status: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, lineupSnapshots: true },
      orderBy: { week: 'asc' },
    }),
  ])
  const nameOf = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'Team']))

  const weeksAvailable = [...new Set(matchups.map((m) => m.week))].sort((a, b) => a - b)
  const selectedWeek =
    Number.isFinite(args.requestedWeek) && weeksAvailable.includes(args.requestedWeek)
      ? args.requestedWeek
      : weeksAvailable[weeksAvailable.length - 1] ?? 1
  const weekMatchups = matchups.filter((m) => m.week === selectedWeek)

  // The roster each team held THIS week, by the same rule scoring uses (bestBallWeekRoster.ts).
  const rosterIds = rosters.map((r) => r.id)
  const weekRows = await loadBestBallWeekRosterRows(prisma, {
    rosterIds,
    sport: args.sport,
    season: season.season,
    week: selectedWeek,
    platform: args.platform,
  })
  const rowsByRoster = new Map<string, typeof weekRows>()
  for (const row of weekRows) {
    const list = rowsByRoster.get(row.rosterId) ?? []
    list.push(row)
    rowsByRoster.set(row.rosterId, list)
  }
  const playerIds = [...new Set(weekRows.map((r) => r.playerId))]
  const pointRows = playerIds.length
    ? await prisma.leaguePlayerWeeklyScore.findMany({
        where: { leagueId: args.leagueId, seasonYear: season.season, week: selectedWeek, playerId: { in: playerIds } },
        select: { playerId: true, points: true },
      })
    : []
  const pointsByPlayer = new Map(pointRows.map((r) => [r.playerId, r.points]))
  // The league's CURRENT seats. A sealed week is read against the seats it was scored on instead
  // (lineupSlotsForWeek, per matchup); a legacy or unstamped week keeps these.
  const currentSlots = buildBestBallSlots(args.sport, args.settings).map((s) => ({ slot: s.slot, eligible: s.eligible, count: s.count }))

  const lineups: NativeLineupCard[] = []
  for (const m of weekMatchups) {
    const { slots, sealedSeatsNote } = lineupSlotsForWeek(m.lineupSnapshots, currentSlots)
    // ...and at the positions it was seated at (a sealed week with stored positions only).
    const sealedPositions = lineupPositionsForWeek(m.lineupSnapshots)
    const sides: Array<{ rosterId: string | null; side: 'home' | 'away'; opp: number | null }> = [
      { rosterId: m.homeRosterId, side: 'home', opp: m.awayRosterId ? m.awayScore : null },
      { rosterId: m.awayRosterId, side: 'away', opp: m.homeScore },
    ]
    for (const s of sides) {
      if (!s.rosterId) continue
      const card = buildNativeLineupCard({
        rosterId: s.rosterId,
        teamName: nameOf.get(s.rosterId) ?? 'Team',
        side: snapshotSide(m.lineupSnapshots, s.side),
        matchupFinal: m.status === 'final',
        opponentPoints: s.opp,
        weekRoster: (rowsByRoster.get(s.rosterId) ?? []).map((r) => ({
          playerId: r.playerId,
          playerName: r.playerName,
          position: r.position,
          team: r.team ?? null,
          slotType: r.slotType ?? null,
        })),
        pointsByPlayer,
        slots,
        sealedPositions,
      })
      lineups.push(sealedSeatsNote ? { ...card, sealedSeatsNote } : card)
    }
  }
  lineups.sort((a, b) => b.totalPoints - a.totalPoints)

  const history: NativeBestBallTabBody['history'] = []
  for (const m of matchups) {
    const status = m.status === 'final' ? 'final' : 'provisional'
    history.push({ rosterId: m.homeRosterId, week: m.week, totalPoints: m.homeScore, status })
    if (m.awayRosterId) history.push({ rosterId: m.awayRosterId, week: m.week, totalPoints: m.awayScore, status })
  }

  const standings = [...rosters]
    .sort((a, b) =>
      args.rankBy === 'points'
        ? b.pointsFor - a.pointsFor
        : b.wins - a.wins || b.ties - a.ties || b.pointsFor - a.pointsFor,
    )
    .map((r, i) => ({
      rosterId: r.id,
      rank: i + 1,
      teamName: nameOf.get(r.id) ?? 'Team',
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
    }))

  const rosterComposition = rosters.map((r) => ({
    rosterId: r.id,
    teamName: nameOf.get(r.id) ?? 'Team',
    playerCount: (rowsByRoster.get(r.id) ?? []).length,
  }))

  return { season: season.season, body: { selectedWeek, weeksAvailable, lineups, rosterComposition, standings, history } }
}
