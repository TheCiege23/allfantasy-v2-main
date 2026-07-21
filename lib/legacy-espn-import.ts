// lib/legacy-espn-import.ts
//
// Season-walk import for the ANONYMOUS ESPN guest funnel on /af-legacy.
//
// This is the ESPN sibling of `runLegacyImportStep` in `lib/legacy-import.ts`. It is
// invoked one season at a time by `/api/legacy/worker/run` (which the client polls), so
// the shared progress bar advances for real. Like the Sleeper step it persists into the
// Legacy* tables — LegacyLeague / LegacyRoster / LegacySeasonSummary — because those are
// the rows `/api/legacy/profile` reads to render the post-import report. It deliberately
// does NOT touch the modern `League` tables: `/api/import-espn` already owns that path,
// but it requires a real AppUser (which an anonymous guest does not have) and writes rows
// the legacy report never reads.
//
// No schema migration: the per-job cursor reuses the existing generic `currentSeason` and
// `emptyYears` columns on LegacyImportJob, exactly as the Sleeper step does. The job is
// routed here (rather than to the Sleeper step) purely by the synthetic identity its
// LegacyUser carries — `sleeperUserId` of the form `espn:<leagueId>` — which the worker
// branches on. Real Sleeper user ids are always numeric, so the prefix cannot collide.

import { prisma } from './prisma'
import { fetchEspnLeague, findTeamByName, type EspnTeam } from './espn-client'

const CURRENT_YEAR = new Date().getFullYear()
// ESPN's public read API only reliably serves recent seasons for a given league id
// (older seasons are commonly 404/401 unless the league opted into public history), so a
// tight window keeps the walk honest and snappy: it captures whatever IS public and stops
// early via MAX_EMPTY_YEARS rather than grinding through a decade of misses.
const MIN_YEAR = CURRENT_YEAR - 10
const MAX_EMPTY_YEARS = 2

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 5% on start, ramp to ~95% across the season window, 100% only when the walk finishes. */
function calculateProgress(nextSeason: number): number {
  const span = CURRENT_YEAR - MIN_YEAR + 1
  const processed = CURRENT_YEAR - nextSeason
  const pct = 5 + Math.round((processed / span) * 90)
  return Math.max(5, Math.min(95, pct))
}

/**
 * A LegacyLeague row is keyed unique on (userId, sleeperLeagueId). ESPN reuses the SAME
 * league id across every season, whereas Sleeper mints a new id per season — so to keep
 * one row per season (the shape the profile groups by) we namespace the stored id with the
 * season. `<leagueId>_<season>` stays human-legible in the DB.
 */
function seasonScopedLeagueKey(espnLeagueId: string, season: number): string {
  return `${espnLeagueId}_${season}`
}

function toPlayersJson(roster: EspnTeam['roster']) {
  const starters: string[] = []
  const bench: string[] = []
  const ir: string[] = []
  for (const entry of roster) {
    if (entry.slot === 'Bench') bench.push(entry.name)
    else if (entry.slot === 'IR') ir.push(entry.name)
    else starters.push(entry.name)
  }
  // `starters`/`bench`/`ir` mirror the array shape Sleeper's players JSON exposes, so any
  // consumer that reads `players.starters` gets an array. `espnRoster` keeps the richer
  // per-player detail (position/team/slot) for roster views.
  return { starters, bench, ir, taxi: [] as string[], espnRoster: roster }
}

async function persistEspnSeason(
  legacyUserId: string,
  espnLeagueId: string,
  season: number,
  team: EspnTeam,
  league: { leagueName: string; numTeams: number; scoringType: string },
): Promise<void> {
  const savedLeague = await prisma.legacyLeague.upsert({
    where: {
      userId_sleeperLeagueId: {
        userId: legacyUserId,
        sleeperLeagueId: seasonScopedLeagueKey(espnLeagueId, season),
      },
    },
    update: {
      name: league.leagueName,
      season,
      scoringType: league.scoringType,
      teamCount: league.numTeams,
    },
    create: {
      userId: legacyUserId,
      sleeperLeagueId: seasonScopedLeagueKey(espnLeagueId, season),
      name: league.leagueName,
      season,
      sport: 'nfl',
      leagueType: 'Redraft',
      scoringType: league.scoringType,
      teamCount: league.numTeams,
      status: 'complete',
    },
  })

  const wins = safeNum(team.record.wins)
  const losses = safeNum(team.record.losses)
  const ties = safeNum(team.record.ties)
  const pointsFor = safeNum(team.record.pointsFor)

  await prisma.legacyRoster.upsert({
    where: {
      leagueId_rosterId: { leagueId: savedLeague.id, rosterId: team.id },
    },
    update: {
      ownerId: String(team.id),
      ownerName: team.name,
      isOwner: true,
      wins,
      losses,
      ties,
      pointsFor,
      players: toPlayersJson(team.roster),
    },
    create: {
      leagueId: savedLeague.id,
      rosterId: team.id,
      ownerId: String(team.id),
      ownerName: team.name,
      isOwner: true,
      wins,
      losses,
      ties,
      pointsFor,
      players: toPlayersJson(team.roster),
    },
  })

  // ESPN's basic read endpoint does not expose final standing or championship without the
  // playoff views, so those stay honest defaults (unknown) rather than fabricated wins.
  await prisma.legacySeasonSummary.upsert({
    where: { leagueId: savedLeague.id },
    update: { season, wins, losses, pointsFor },
    create: { leagueId: savedLeague.id, season, wins, losses, pointsFor },
  })
}

/**
 * Advance one season of an ESPN guest import. Returns `{ done, progress }`; the worker
 * calls it repeatedly (driven by the client poll) until `done`.
 */
export async function runLegacyEspnImportStep(
  jobId: string,
  legacyUserId: string,
  espnLeagueId: string,
  teamName: string,
): Promise<{ done: boolean; progress: number }> {
  const job = await prisma.legacyImportJob.findUnique({ where: { id: jobId } })
  if (!job) throw new Error('Job not found')
  if (job.status === 'completed' || job.status === 'failed') {
    return { done: true, progress: job.progress }
  }

  let currentSeason = job.currentSeason
  let emptyYears = job.emptyYears

  // First run: initialise the cursor at the current season.
  if (currentSeason === null) {
    currentSeason = CURRENT_YEAR
    emptyYears = 0
    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date(), currentSeason, emptyYears: 0, progress: 5 },
    })
  }

  // Terminal condition: ran past the window, or hit the empty-season tolerance.
  if (currentSeason < MIN_YEAR || emptyYears >= MAX_EMPTY_YEARS) {
    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: { status: 'completed', progress: 100, completedAt: new Date() },
    })
    return { done: true, progress: 100 }
  }

  let seasonHadData = false
  try {
    const league = await fetchEspnLeague(espnLeagueId, currentSeason)
    const team = findTeamByName(league.teams, teamName)
    if (team) {
      await persistEspnSeason(legacyUserId, espnLeagueId, currentSeason, team, {
        leagueName: league.leagueName,
        numTeams: league.numTeams,
        scoringType: league.scoringType,
      })
      seasonHadData = true
    }
  } catch (e: unknown) {
    // A private/non-existent season for this league id is an expected miss on the walk,
    // not a failure of the import — treat it as an empty year and keep going.
    console.warn(
      `[legacy-espn-import] season ${currentSeason} for league ${espnLeagueId} unavailable:`,
      e instanceof Error ? e.message : e,
    )
  }

  const nextSeason = currentSeason - 1
  const nextEmptyYears = seasonHadData ? 0 : emptyYears + 1
  const done = nextSeason < MIN_YEAR || nextEmptyYears >= MAX_EMPTY_YEARS

  if (done) {
    await prisma.legacyImportJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
        currentSeason: nextSeason,
        emptyYears: nextEmptyYears,
      },
    })
    return { done: true, progress: 100 }
  }

  const progress = calculateProgress(nextSeason)
  await prisma.legacyImportJob.update({
    where: { id: jobId },
    data: { currentSeason: nextSeason, emptyYears: nextEmptyYears, progress },
  })
  return { done: false, progress }
}
