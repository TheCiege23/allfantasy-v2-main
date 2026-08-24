import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import {
  computeWinProbability,
  KNOWN_LIMITATION_INDEPENDENCE,
  type MatchupPlayer,
} from '@/lib/projections/winProbability'
import type { GroundedTradeDelta, GroundedWeekDelta } from './types'

/**
 * P4-8 — the trade sim's real-schedule delta.
 *
 * The Monte Carlo trade sim runs on client-supplied placeholder projections and
 * says so on the panel. This module is the other half of that honesty deal:
 * when the league's rosters, schedule, and league-scored projections all
 * resolve, the SAME Gaussian win-probability engine that powers the Matchup
 * screen (lib/projections/winProbability via lib/core-app/matchupProjections)
 * prices the user's actual remaining matchups before and after the trade.
 * Everything that does not resolve is a labeled refusal — the synthetic
 * estimate labels stand.
 *
 * ⚠ EXPECTED WINS, NOT PLAYOFF ODDS. Converting per-week win odds into playoff
 * odds needs every OTHER team's full-season distribution, which we do not hold
 * priced. Claiming "playoff odds" here would be an invented number, so the
 * output says exactly what it is and what it is not.
 *
 * Identity: trade players are resolved against the SAME projection board that
 * prices them — (name, position) within one week's fantasy_projections rows,
 * whose outer `stats` object carries name/position metadata written by
 * app/api/cron/import-projections. Ambiguous or missing names refuse that
 * week. Cross-table name-joins are a known hazard in this repo; a within-board
 * match either finds the row that will price the player or refuses — it cannot
 * silently mis-price.
 *
 * DB-only. No provider calls (db-first boundary stays clean).
 */

export type GroundedTradeAsset = { name: string; position: string }

/** Mirrors matchupProjections.isResolvableId — `name:` descriptors cannot join a projection. */
function isResolvableId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && !raw.startsWith('name:')
}

function startersOf(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object') return []
  const s = (playerData as Record<string, unknown>).starters
  return Array.isArray(s) ? s.map(String) : []
}

type FeedRow = { playerId: string; stats: unknown }

function feedName(row: FeedRow): string | null {
  const s = row.stats
  if (!s || typeof s !== 'object') return null
  const n = (s as Record<string, unknown>).name
  return typeof n === 'string' && n.trim() ? n.trim().toLowerCase() : null
}

function feedPosition(row: FeedRow): string | null {
  const s = row.stats
  if (!s || typeof s !== 'object') return null
  const p = (s as Record<string, unknown>).position
  return typeof p === 'string' && p.trim() ? p.trim().toUpperCase() : null
}

export async function computeGroundedTradeDelta(args: {
  leagueId: string
  userId: string
  /** Players the focused team SENDS away. Picks/FAAB do not change a lineup and are out of scope. */
  sent: GroundedTradeAsset[]
  /** Players the focused team RECEIVES. */
  received: GroundedTradeAsset[]
}): Promise<GroundedTradeDelta> {
  const refuse = (reason: string): GroundedTradeDelta => ({ available: false, reason })

  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, platformLeagueId: true, settings: true },
  })
  if (!league) return refuse('league not found')
  if (!league.platformLeagueId) {
    return refuse('this league has no platform id, so its schedule cannot be located')
  }

  // The league's own scoring rules — the SAME extraction the Matchup screen
  // uses, so this surface and that one cannot disagree about a player's price.
  const scoring = extractScoringSettings(league.settings)
  if (!scoring) {
    return refuse('we hold no scoring settings for this league, and a generic projection would not be yours')
  }

  const myTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId: league.id, claimedByUserId: args.userId },
    select: { externalId: true, platformUserId: true },
  })
  if (!myTeam?.externalId) {
    return refuse('we cannot tell which team in this league is yours')
  }
  const myRosterId = Number.parseInt(String(myTeam.externalId), 10)

  // ⚠ WeeklyMatchup.leagueId IS THE PLATFORM LEAGUE ID (two-id-space trap —
  // see lib/core-app/matchup.ts).
  const latest = await prisma.weeklyMatchup.findFirst({
    where: { leagueId: league.platformLeagueId },
    orderBy: [{ seasonYear: 'desc' }, { week: 'desc' }],
    select: { seasonYear: true },
  })
  if (!latest) return refuse('no schedule stored for this league')

  const rows = await prisma.weeklyMatchup.findMany({
    where: { leagueId: league.platformLeagueId, seasonYear: latest.seasonYear },
    select: { week: true, rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true },
  })

  // Remaining schedule = weeks where MY row exists, is unscored (a 0-0 row is a
  // scheduled week, not a result — same stance as lib/core-app/matchup.ts), and
  // an opponent shares the matchupId.
  const remaining: Array<{ week: number; opponentRosterId: number }> = []
  const weekNumbers = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b)
  for (const week of weekNumbers) {
    const weekRows = rows.filter((r) => r.week === week)
    const mine = weekRows.find((r) => r.rosterId === myRosterId)
    if (!mine || mine.pointsFor > 0 || mine.pointsAgainst > 0) continue
    const opp =
      mine.matchupId != null
        ? weekRows.find((r) => r.matchupId === mine.matchupId && r.rosterId !== mine.rosterId)
        : undefined
    if (opp) remaining.push({ week, opponentRosterId: opp.rosterId })
  }
  if (remaining.length === 0) {
    return refuse('no unplayed weeks with a scheduled opponent remain on file for this league')
  }

  // Roster starters, keyed the way lib/core-app/matchup.ts resolves them:
  // Roster.platformUserId sometimes holds the platform user id and sometimes our
  // own User uuid, so both candidates are tried for the user's own roster.
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: league.id },
    select: { externalId: true, platformUserId: true },
  })
  const teamByExternal = new Map(teams.map((t) => [String(t.externalId), t]))
  const rosters = await prisma.roster.findMany({
    where: { leagueId: league.id },
    select: { platformUserId: true, playerData: true },
  })
  const startersByKey = new Map(rosters.map((r) => [r.platformUserId, startersOf(r.playerData)]))
  const myKey = [myTeam.platformUserId, args.userId].find((c) => c && startersByKey.has(c)) ?? null
  const myStarters = myKey ? startersByKey.get(myKey) ?? [] : []
  if (myStarters.length === 0) return refuse('your roster has no stored starting lineup to price')

  const weekList = remaining.map((r) => r.week)
  const feed = await prisma.fantasyProjection.findMany({
    where: { season: String(latest.seasonYear), week: { in: weekList } },
    select: { playerId: true, week: true, stats: true },
  })
  if (feed.length === 0) {
    return refuse(
      `the projection feed holds nothing for ${latest.seasonYear} weeks ${weekList[0]}–${weekList[weekList.length - 1]}`,
    )
  }
  const feedByWeek = new Map<number, FeedRow[]>()
  for (const row of feed) {
    const arr = feedByWeek.get(row.week) ?? []
    arr.push({ playerId: row.playerId, stats: row.stats })
    feedByWeek.set(row.week, arr)
  }

  // ⚠ Rescored under the league's own rules, never read from a generic total —
  // the outer stats object is metadata, the nested `stats` is the stat line
  // (same convention as lib/core-app/matchupProjections).
  const priceRow = (row: FeedRow): number | null => {
    const outer = (row.stats ?? {}) as Record<string, unknown>
    const scored = computeLeagueProjectedPoints(
      (outer.stats ?? null) as Record<string, unknown> | null,
      scoring,
    )
    return scored ? scored.points : null
  }

  const resolved: GroundedWeekDelta[] = []
  const skipped: Array<{ week: number; reason: string }> = []

  for (const { week, opponentRosterId } of remaining) {
    const board = feedByWeek.get(week)
    if (!board || board.length === 0) {
      skipped.push({ week, reason: 'no projections written for this week' })
      continue
    }
    const byId = new Map(board.map((r) => [r.playerId, r]))

    // (name, position) → feed row, refusing ambiguity outright.
    const byNamePos = new Map<string, FeedRow | 'ambiguous'>()
    for (const row of board) {
      const n = feedName(row)
      const p = feedPosition(row)
      if (!n || !p) continue
      const key = `${n}|${p}`
      byNamePos.set(key, byNamePos.has(key) ? 'ambiguous' : row)
    }
    const findAsset = (a: GroundedTradeAsset): FeedRow | 'ambiguous' | null =>
      byNamePos.get(`${a.name.trim().toLowerCase()}|${a.position.trim().toUpperCase()}`) ?? null

    const oppTeam = teamByExternal.get(String(opponentRosterId))
    const oppKey =
      oppTeam?.platformUserId && startersByKey.has(oppTeam.platformUserId)
        ? oppTeam.platformUserId
        : null
    const oppStarters = oppKey ? startersByKey.get(oppKey) ?? [] : []
    if (oppStarters.length === 0) {
      skipped.push({ week, reason: 'the opponent that week has no stored starting lineup' })
      continue
    }

    const buildSide = (ids: string[]): { players: MatchupPlayer[]; unpriced: number } => {
      const players: MatchupPlayer[] = []
      let unpriced = 0
      for (const id of ids) {
        const row = isResolvableId(id) ? byId.get(id) : undefined
        const points = row ? priceRow(row) : null
        if (points == null) {
          unpriced++
          continue
        }
        players.push({ playerId: id, projectedPoints: points, actualPoints: 0, isFinal: false })
      }
      return { players, unpriced }
    }

    const you = buildSide(myStarters)
    const opp = buildSide(oppStarters)
    if (you.unpriced > 0 || opp.unpriced > 0) {
      skipped.push({
        week,
        reason: `${you.unpriced + opp.unpriced} starter(s) could not be priced under this league's scoring`,
      })
      continue
    }

    // A sent starter whose feed row carries no name metadata could never match a
    // trade asset — that would silently leave him in the after-lineup, which
    // understates the delta. Refuse the week instead.
    if (args.sent.length > 0) {
      const unmatchable = you.players.some((p) => {
        const row = byId.get(p.playerId)
        return !row || !feedName(row) || !feedPosition(row)
      })
      if (unmatchable) {
        skipped.push({
          week,
          reason: 'projection rows for your starters lack name metadata, so trade assets cannot be matched',
        })
        continue
      }
    }

    // After-lineup: each sent STARTER must be replaced by a received player of
    // the same position; anything else would require guessing a lineup decision.
    // A sent player who is not in the starting lineup changes nothing this week,
    // and received players not replacing a starter are assumed benched (stated
    // in scopeNote).
    const sentResolved = args.sent.map((a) => ({ asset: a, row: findAsset(a) }))
    const receivedPool = args.received.map((a) => ({ asset: a, row: findAsset(a), used: false }))

    let lineupProblem: string | null = null
    const afterPlayers = [...you.players]
    for (const s of sentResolved) {
      if (s.row === 'ambiguous') {
        lineupProblem = `two ${s.asset.position} players named "${s.asset.name}" exist in the projection board`
        break
      }
      if (!s.row) continue // not on the priced board → cannot be a priced starter here
      const sentRow = s.row
      const idx = afterPlayers.findIndex((p) => p.playerId === sentRow.playerId)
      if (idx < 0) continue // sent player is not in the starting lineup — no weekly change
      const replacement = receivedPool.find(
        (r) =>
          !r.used &&
          r.row !== null &&
          r.row !== 'ambiguous' &&
          r.asset.position.trim().toUpperCase() === s.asset.position.trim().toUpperCase(),
      )
      if (!replacement || replacement.row === null || replacement.row === 'ambiguous') {
        lineupProblem = `you send starter ${s.asset.name} (${s.asset.position}) and receive no priced ${s.asset.position} to replace him — filling that slot would be a guess`
        break
      }
      const points = priceRow(replacement.row)
      if (points == null) {
        lineupProblem = `received player ${replacement.asset.name} has no league-scored projection`
        break
      }
      replacement.used = true
      afterPlayers[idx] = {
        playerId: replacement.row.playerId,
        projectedPoints: points,
        actualPoints: 0,
        isFinal: false,
      }
    }
    if (lineupProblem) {
      skipped.push({ week, reason: lineupProblem })
      continue
    }

    const before = computeWinProbability(
      { teamId: 'you', starters: you.players },
      { teamId: 'opponent', starters: opp.players },
    )
    const after = computeWinProbability(
      { teamId: 'you', starters: afterPlayers },
      { teamId: 'opponent', starters: opp.players },
    )
    if (!before.available || !after.available) {
      skipped.push({
        week,
        reason: !before.available ? before.reason : (after as { available: false; reason: string }).reason,
      })
      continue
    }

    resolved.push({ week, opponentRosterId, pWinBefore: before.pWin, pWinAfter: after.pWin })
  }

  if (resolved.length === 0) {
    const first = skipped[0]
    return refuse(
      first
        ? `no remaining week could be priced (week ${first.week}: ${first.reason})`
        : 'no remaining week could be priced',
    )
  }

  const expectedWinsBefore = resolved.reduce((s, w) => s + w.pWinBefore, 0)
  const expectedWinsAfter = resolved.reduce((s, w) => s + w.pWinAfter, 0)
  const round = (n: number) => Math.round(n * 1000) / 1000

  return {
    available: true,
    engine: 'gaussian-winprob-v1',
    weeks: resolved,
    weeksSkipped: skipped,
    expectedWinsBefore: round(expectedWinsBefore),
    expectedWinsAfter: round(expectedWinsAfter),
    expectedWinsDelta: round(expectedWinsAfter - expectedWinsBefore),
    scopeNote:
      `Expected WINS over ${resolved.length} priced week${resolved.length === 1 ? '' : 's'} of your actual remaining schedule — ` +
      `players only (picks/FAAB do not change a lineup); received players not replacing a sent starter are assumed benched. ` +
      `Not playoff odds: that would need every other team's season priced, which we do not hold.`,
    limitation: KNOWN_LIMITATION_INDEPENDENCE,
  }
}
