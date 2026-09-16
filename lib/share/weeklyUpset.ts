import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isMissingDatabaseObjectError } from '@/lib/canonical/getCanonicalPlayer'

/**
 * WEEKLY UPSETS — a win your team was not expected to get, by the odds SAVED BEFORE the game
 * (shareable moments, user decision 2026-09-14: "Weekly upsets (saves odds first)").
 *
 * 🛑 ONLY SAVED ODDS, NEVER RECOMPUTED. The win probability comes from `matchup_odds_snapshots`,
 * written by lib/core-app/matchupOddsSweep.ts while the week was still entirely unplayed. Once a
 * week is scored it joins the history, and the week board's formula returns a DIFFERENT number for
 * the same game — so there is no fallback: no snapshot for that game, no upset.
 *
 * The table comes from `prisma/migrations/20260915010000_matchup_odds_snapshots`, applied to
 * production 2026-09-16, so upsets exist only for weeks captured from then on. A database without
 * the table raises 42P01 on the read, which is "no upsets". Raw SQL, like the sweep that writes it.
 *
 * ⚠ TWO ID SPACES. The snapshots and WeeklyMatchup carry the PLATFORM league id and the platform
 * roster id (see lib/core-app/weekAll.ts); the home and the card speak `League.id`. The bridge is
 * your claimed LeagueTeam's `externalId`, kept as a STRING — `claimedRosterIds` in decisionReceipts
 * converts to a number, which would turn an MFL franchise "0001" into 1 and miss the row.
 */

/** A win you were given at most this chance of before kickoff is an upset. */
export const UPSET_MAX_WIN_PROBABILITY = 0.4

/** Leagues read per render — the weekly routine's own cap. */
const MAX_UPSET_LEAGUES = 12

export type OddsSnapshot = {
  /** PLATFORM league id. */
  leagueId: string
  season: number
  week: number
  rosterId: string
  opponentRosterId: string
  winProbability: number
  projectedPoints: number
  opponentProjectedPoints: number
}

export type UpsetMoment = {
  /** `League.id`. */
  leagueId: string
  leagueName: string
  season: number
  week: number
  /** Your pre-game win probability (0–1), exactly as saved before kickoff. */
  winProbability: number
  /** "22%" — the same label on the home and on the card. */
  winChance: string
  pointsFor: number
  pointsAgainst: number
}

export type UpsetCard = UpsetMoment & {
  teamName: string
  opponentName: string | null
  projectedPoints: number
  opponentProjectedPoints: number
}

/** "22%"; under half a percent is "<1%", never "0%" for a game that was won. */
export function formatWinChance(p: number): string {
  return p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`
}

/** An upset: played, won outright, with saved odds of at most 40% for you. */
export function isUpset(
  result: { pointsFor: number; pointsAgainst: number; won: boolean },
  winProbability: number | null | undefined,
): boolean {
  if (winProbability == null || !Number.isFinite(winProbability) || winProbability > UPSET_MAX_WIN_PROBABILITY) return false
  return result.won && result.pointsFor > result.pointsAgainst
}

/** Your claimed roster id, as the platform wrote it, per `League.id`. A league claimed twice has none. */
export function claimedRosters(teams: ReadonlyArray<{ leagueId: string; externalId: string | null }>): Map<string, string> {
  const out = new Map<string, string>()
  const twice = new Set<string>()
  for (const t of teams) {
    const id = t.externalId?.trim()
    if (!id) continue
    if (out.has(t.leagueId)) twice.add(t.leagueId)
    out.set(t.leagueId, id)
  }
  for (const leagueId of twice) out.delete(leagueId)
  return out
}

/** A team name fit for a shared image: trimmed, and never anything that looks like an email. */
function publicName(name: string | null | undefined): string | null {
  const s = name?.trim()
  return s && !s.includes('@') ? s : null
}

type SnapshotRow = {
  league_id: string
  season: number
  week: number
  roster_id: string
  opponent_roster_id: string
  win_probability: number
  projected_points: number
  opponent_projected_points: number
}

/**
 * The saved odds for these rosters in one played week. A table that does not exist yet (the parked
 * migration) is no odds; any other failure propagates to the caller.
 */
export async function readOddsSnapshots(
  keys: ReadonlyArray<{ leagueId: string; rosterId: string }>,
  season: number,
  week: number,
): Promise<OddsSnapshot[]> {
  if (keys.length === 0) return []
  let rows: SnapshotRow[]
  try {
    rows = await prisma.$queryRaw<SnapshotRow[]>`
      SELECT "league_id", "season", "week", "roster_id", "opponent_roster_id", "win_probability", "projected_points", "opponent_projected_points"
      FROM "matchup_odds_snapshots"
      WHERE "season" = ${season} AND "week" = ${week}
        AND ("league_id", "roster_id") IN (${Prisma.join(keys.map((k) => Prisma.sql`(${k.leagueId}, ${k.rosterId})`))})
    `
  } catch (e: unknown) {
    if (isMissingDatabaseObjectError(e)) return []
    throw e
  }
  return rows.map((r) => ({
    leagueId: r.league_id,
    season: Number(r.season),
    week: Number(r.week),
    rosterId: r.roster_id,
    opponentRosterId: r.opponent_roster_id,
    winProbability: Number(r.win_probability),
    projectedPoints: Number(r.projected_points),
    opponentProjectedPoints: Number(r.opponent_projected_points),
  }))
}

/**
 * Your upset wins in a played week, across your leagues (the "Your week" card). Only wins with saved
 * odds count. A league with no platform id, or one you claim twice, is skipped. Longest odds first.
 */
export async function getWeeklyUpsetsForUser(
  userId: string,
  leagues: ReadonlyArray<{ id: string; platformLeagueId?: string | null }>,
  played: {
    rows: ReadonlyArray<{ leagueId: string; leagueName: string; pointsFor: number; pointsAgainst: number; won: boolean }>
    season: number | null
    week: number | null
  },
): Promise<UpsetMoment[]> {
  const { season, week } = played
  if (season == null || week == null) return []
  const platformIdOf = new Map<string, string>()
  for (const l of leagues) if (l.platformLeagueId) platformIdOf.set(l.id, l.platformLeagueId)
  const wins = played.rows.filter((r) => r.won && platformIdOf.has(r.leagueId))
  const leagueIds = [...new Set(wins.map((r) => r.leagueId))].slice(0, MAX_UPSET_LEAGUES)
  if (leagueIds.length === 0) return []

  const rosters = claimedRosters(
    await prisma.leagueTeam.findMany({
      where: { leagueId: { in: leagueIds }, claimedByUserId: userId },
      select: { leagueId: true, externalId: true },
    }),
  )
  const mine = leagueIds
    .filter((id) => rosters.has(id))
    .map((id) => ({ id, leagueId: platformIdOf.get(id)!, rosterId: rosters.get(id)! }))
  if (mine.length === 0) return []

  const snapshots = await readOddsSnapshots(
    mine.map(({ leagueId, rosterId }) => ({ leagueId, rosterId })),
    season,
    week,
  )
  const odds = new Map(snapshots.map((s) => [`${s.leagueId}:${s.rosterId}`, s]))
  const out: UpsetMoment[] = []
  for (const m of mine) {
    const snap = odds.get(`${m.leagueId}:${m.rosterId}`)
    const row = wins.find((r) => r.leagueId === m.id)!
    if (!snap || !isUpset(row, snap.winProbability)) continue
    out.push({
      leagueId: m.id,
      leagueName: row.leagueName,
      season,
      week,
      winProbability: snap.winProbability,
      winChance: formatWinChance(snap.winProbability),
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
    })
  }
  return out.sort((a, b) => a.winProbability - b.winProbability)
}

/**
 * One upset for the share card: YOUR claimed team in that league (the access check — no claim, no
 * other read), its scored result that week, and the odds saved for it before kickoff. Null whenever
 * any part is missing; the card is never drawn from a guess.
 */
export async function getUpsetForCard(userId: string, leagueId: string, season: number, week: number): Promise<UpsetCard | null> {
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId, claimedByUserId: userId },
    select: { leagueId: true, externalId: true, teamName: true },
  })
  const rosterId = claimedRosters(teams).get(leagueId)
  if (!rosterId) return null
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, platformLeagueId: true } })
  if (!league?.platformLeagueId) return null
  const platformLeagueId = league.platformLeagueId

  const [result, [snap]] = await Promise.all([
    prisma.weeklyMatchup.findUnique({
      where: { leagueId_seasonYear_week_rosterId: { leagueId: platformLeagueId, seasonYear: season, week, rosterId } },
      select: { pointsFor: true, pointsAgainst: true, win: true },
    }),
    readOddsSnapshots([{ leagueId: platformLeagueId, rosterId }], season, week),
  ])
  if (!result || !snap || !isUpset({ ...result, won: result.win === 1 }, snap.winProbability)) return null

  const opponent = await prisma.leagueTeam.findFirst({
    where: { leagueId, externalId: snap.opponentRosterId },
    select: { teamName: true },
  })
  return {
    leagueId,
    leagueName: league.name?.trim() || 'Your league',
    season,
    week,
    winProbability: snap.winProbability,
    winChance: formatWinChance(snap.winProbability),
    pointsFor: result.pointsFor,
    pointsAgainst: result.pointsAgainst,
    teamName: publicName(teams.find((t) => t.externalId?.trim() === rosterId)?.teamName) ?? 'Your team',
    opponentName: publicName(opponent?.teamName),
    projectedPoints: snap.projectedPoints,
    opponentProjectedPoints: snap.opponentProjectedPoints,
  }
}
