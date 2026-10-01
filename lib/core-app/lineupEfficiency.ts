import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeWeeklyMaxPf, type WeeklyRosterPlayer } from '@/lib/commissioner-os/efl/maxPfEngine'
import { asIds } from './dash3aPanels'
import { composePlayerIdentities } from './playerIdentityCompose'
import { normalizePosition } from './positionNormalization'
import { lineupSeatsFromSettings } from './slotEligibility'

/**
 * Lineup efficiency for every team in one league: points scored as a share of the best lineup each
 * team could have set, week by week, from the players it actually had.
 *
 * ⚠ THE SAME ENGINE AND THE SAME REFUSALS AS YOUR LINEUP RECEIPTS (`decisionReceipts.ts`). The best
 * lineup is `computeWeeklyMaxPf` — the exact optimizer EFL's Max PF uses, FLEX and superflex included —
 * never a greedy pass. A team-week is LEFT OUT, not guessed, when a starter has no position on file (his
 * seat cannot be checked) or the best lineup still leaves a seat empty. So two teams can be measured over
 * different numbers of weeks, which is why the table prints a percentage and a per-week figure and never
 * a season total of bench points.
 *
 * ⚠ SCORES ARE SLEEPER'S OWN, so this is Sleeper-only. `league_player_weekly_scores` holds Sleeper's
 * points for the whole roster, bench included; no other platform's player scoring is stored.
 *
 * ⚠ NOT CALLED "MAX PF". That name already means points scored elsewhere in this repo (see the lottery
 * and rookie-order code), so the best lineup is "best possible" here and nowhere "max".
 *
 * ⚠ IR/TAXI IS APPROXIMATE, as in the receipts: a bench player on a team's CURRENT reserve or taxi list
 * is left out of its best lineup. Membership that changed since that week is not reconstructed.
 */

export type TeamLineupEfficiency = {
  /** Points your starters scored, over the weeks counted. */
  actual: number
  /** Points the best possible lineup would have scored, over the same weeks. */
  best: number
  /** actual ÷ best, 0–1. */
  efficiency: number
  /** Points left on the bench, per week counted. */
  benchPerWeek: number
  /** Weeks counted for this team. */
  weeks: number
}

export type LineupEfficiency = {
  byRoster: Record<string, TeamLineupEfficiency>
  /** Final weeks with any player scores on file. */
  weeksOnFile: number[]
  basis: string
}

type ScoreRow = { week: number; playerId: string; rosterId: number | null; isStarter: boolean; points: number }
type Seats = NonNullable<ReturnType<typeof lineupSeatsFromSettings>>

/**
 * PURE: the season figures from per-player weekly rows. `positionsOf` returns a player's positions (empty
 * when unknown); `inactive` holds each roster's reserve/taxi players.
 */
export function summariseLineupEfficiency(args: {
  rows: readonly ScoreRow[]
  seats: Seats
  positionsOf: (playerId: string) => string[]
  inactive?: ReadonlyMap<string, ReadonlySet<string>>
}): Record<string, TeamLineupEfficiency> {
  const byWeek = new Map<number, Map<string, ScoreRow[]>>()
  for (const r of args.rows) {
    if (r.rosterId == null) continue
    const roster = String(r.rosterId)
    const week = byWeek.get(r.week) ?? byWeek.set(r.week, new Map()).get(r.week)!
    const list = week.get(roster) ?? week.set(roster, []).get(roster)!
    list.push(r)
  }

  const totals = new Map<string, { actual: number; best: number; bench: number; weeks: number }>()
  for (const [week, rosters] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const teams: Array<{ teamId: string; players: WeeklyRosterPlayer[] }> = []
    for (const [roster, rows] of rosters) {
      const inactive = args.inactive?.get(roster)
      const players: WeeklyRosterPlayer[] = []
      let starterUnplaced = false
      for (const r of rows) {
        if (!r.isStarter && inactive?.has(r.playerId)) continue
        const positions = args.positionsOf(r.playerId)
        if (positions.length === 0) {
          if (r.isStarter) starterUnplaced = true
          continue
        }
        players.push({ playerId: r.playerId, playerName: null, positions, points: r.points, wasStarter: r.isStarter })
      }
      // A starter whose seat cannot be checked would be compared against a lineup missing him.
      if (!starterUnplaced && players.some((p) => p.wasStarter)) teams.push({ teamId: roster, players })
    }
    if (teams.length === 0) continue
    for (const row of computeWeeklyMaxPf({ week, slots: args.seats, teams }).rows) {
      if (row.optimal.unfilledSlots.length > 0 || row.maxPf <= 0) continue
      const t = totals.get(row.teamId) ?? { actual: 0, best: 0, bench: 0, weeks: 0 }
      t.actual += row.actualStarterPoints
      t.best += row.maxPf
      t.bench += Math.max(0, row.pointsLeftOnBench)
      t.weeks += 1
      totals.set(row.teamId, t)
    }
  }

  const out: Record<string, TeamLineupEfficiency> = {}
  for (const [roster, t] of totals) {
    out[roster] = {
      actual: Math.round(t.actual * 10) / 10,
      best: Math.round(t.best * 10) / 10,
      // A started player out of position could in principle beat the "best" lineup; never print >100%.
      efficiency: Math.min(1, t.actual / t.best),
      benchPerWeek: Math.round((t.bench / t.weeks) * 10) / 10,
      weeks: t.weeks,
    }
  }
  return out
}

/**
 * Read and summarise one league's season, through the last week the standings table counts. Null where
 * nothing honest can be said: not Sleeper, best ball, unreadable lineup slots, or no scores on file.
 */
export async function getLineupEfficiency(args: {
  league: {
    id: string
    platform: string | null
    platformLeagueId: string | null
    settings: unknown
    leagueType?: string | null
    bestBallMode?: boolean | null
  }
  season: number
  throughWeek: number
}): Promise<LineupEfficiency | null> {
  const { league } = args
  if (String(league.platform ?? '').toLowerCase() !== 'sleeper' || !league.platformLeagueId) return null
  const s = (league.settings ?? {}) as Record<string, unknown>
  if (league.bestBallMode || String(league.leagueType ?? '').toLowerCase() === 'best_ball' || s.best_ball || s.bestBall) return null
  const seats = lineupSeatsFromSettings(league.settings)
  if (!seats || args.throughWeek < 1) return null

  const [rows, teams, rosters] = await Promise.all([
    prisma.leaguePlayerWeeklyScore.findMany({
      where: { leagueId: league.platformLeagueId, seasonYear: args.season, week: { lte: args.throughWeek } },
      select: { week: true, playerId: true, rosterId: true, isStarter: true, points: true },
    }),
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, platformUserId: true } }),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { platformUserId: true, playerData: true } }),
  ])
  if (rows.length === 0) return null

  /* Reserve/taxi by roster, joined through the owner's platform id — the pair both tables carry. */
  const inactiveByOwner = new Map<string, Set<string>>()
  for (const r of rosters) {
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    inactiveByOwner.set(r.platformUserId, new Set([...asIds(pd.reserve), ...asIds(pd.taxi)]))
  }
  const inactive = new Map<string, Set<string>>()
  for (const t of teams) {
    const set = t.externalId && t.platformUserId ? inactiveByOwner.get(t.platformUserId) : undefined
    if (set) inactive.set(String(t.externalId), set)
  }

  const ids = [...new Set(rows.map((r) => r.playerId))]
  const identities = composePlayerIdentities(
    await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: ids } },
      select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
    }),
  )
  const positionsOf = (id: string) =>
    String(identities.get(id)?.position ?? '')
      .split('/')
      .map((p) => normalizePosition(p))
      .filter(Boolean)

  const byRoster = summariseLineupEfficiency({ rows, seats, positionsOf, inactive })
  if (Object.keys(byRoster).length === 0) return null
  const weeksOnFile = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b)
  return {
    byRoster,
    weeksOnFile,
    basis:
      'Lineup efficiency is the points your starters scored as a share of the best lineup you could have set from your own roster that week, using Sleeper’s own player scores and this league’s starting slots. A week is left out where a starter’s position is unknown or no full lineup could be set. Players on a team’s current IR or taxi list are not counted as available.',
  }
}
