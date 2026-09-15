import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { isMissingDatabaseObjectError } from '@/lib/canonical/getCanonicalPlayer'
import { rotateForFairness, remainingFor, type RunBudget } from '@/lib/cron/runBudget'
import { DEFAULT_TIME_ZONE, localParts } from './managerActivityWindow'
import { buildProfiles, pairRows, winProbabilityOf, type MatchupRow } from './weekBoard'

/**
 * PRE-GAME WIN ODDS, SAVED — so a later "won as a 22% underdog" is a claim about what the odds
 * were BEFORE the games, not a number rebuilt afterwards (shareable moments, user decision
 * 2026-09-14: "Weekly upsets (saves odds first)").
 *
 * 🛑 THE ODDS CANNOT BE REBUILT AFTER THE FACT, WHICH IS WHY THIS EXISTS. `weekBoard` computes a win
 * probability from each roster's completed weeks and never stores it. Once the week is scored, that
 * week joins the history, and the same formula now returns a DIFFERENT number for a game already
 * played. So the number is captured while the week is still entirely unplayed.
 *
 * ⚠ SAME MODEL AS THE BOARD, BY CONSTRUCTION: `buildProfiles`, `pairRows` and `winProbabilityOf`
 * are imported from `weekBoard`, not re-derived. Two implementations of one rule is the bug.
 *
 * ⚠ WRITTEN ONCE, NEVER UPDATED. A league-week is due only when it has no snapshot yet (a set
 * difference, like `forecastSweep` — no timestamp to rot), its rows are all unplayed, and the fire
 * is outside Sunday–Tuesday-06:00 ET. That last guard matters: `isScored` treats any points as
 * played, so during Sunday and Monday night the previous week's IN-PROGRESS points would feed the
 * next week's profiles. `ON CONFLICT DO NOTHING` keeps the first capture.
 *
 * 🛑 DORMANT UNTIL THE MIGRATION IS APPLIED. The table comes from the parked
 * `20260915010000_matchup_odds_snapshots`; until then the season-scoped read of existing
 * snapshots raises 42P01, which this reports as `unavailable` and returns — no matchup rows are
 * read, no work is done. Raw SQL, no Prisma model, for the same P2021 / schema-drift reason as
 * `player_follows`. No provider calls anywhere: this is Postgres rows and arithmetic.
 */

export const ODDS_MODEL = 'history_normal_v1'

/** League-weeks per fire. Each is one history read plus arithmetic; the cap keeps the fire's tail. */
const DEFAULT_LEAGUE_CAP = 25
/** Matches the host cron's fire interval, so a different slice leads each fire. */
const ROTATION_PERIOD_MS = 30 * 60 * 1000
/** Ceiling on ONE league-week; `budget.exhausted()` is checked between units and cannot bound one. */
const PER_UNIT_CAP_MS = 5_000

export interface MatchupOddsSweepCounts {
  /** 1 when the fire fell Sunday–Tuesday 06:00 ET, when last week may still be in play. */
  outsideWindow: number
  /** 1 when the snapshot table does not exist yet (the migration is parked). */
  unavailable: number
  /** League-weeks whose current week is entirely unplayed. */
  considered: number
  /** Of those, the ones with no snapshot yet. */
  due: number
  /** Snapshot ROWS persisted (two per projected matchup). Read off the write, never inferred. */
  written: number
  leaguesWritten: number
  /** Due, but the week turned out to have scored rows when read — refused, never snapshotted. */
  started: number
  /** Matchups where either side has too little history to project. Not written. */
  unprojected: number
  failed: number
  skippedForTime: number
  errors: string[]
}

export function emptyMatchupOddsSweepCounts(): MatchupOddsSweepCounts {
  return {
    outsideWindow: 0,
    unavailable: 0,
    considered: 0,
    due: 0,
    written: 0,
    leaguesWritten: 0,
    started: 0,
    unprojected: 0,
    failed: 0,
    skippedForTime: 0,
    errors: [],
  }
}

export interface MatchupOddsSweepDeps {
  prisma?: typeof defaultPrisma
  budget: RunBudget
  leagueCap?: number
  now?: () => number
}

type Unit = { leagueId: string; season: number; week: number }
const keyOf = (u: Unit) => `${u.leagueId}|${u.season}|${u.week}`

/** Sunday, Monday, and Tuesday before 06:00 US Eastern: last week's games may still be in play. */
export function inPlayWindow(at: Date): boolean {
  const { weekday, hour } = localParts(at, DEFAULT_TIME_ZONE)
  return weekday === 0 || weekday === 1 || (weekday === 2 && hour < 6)
}

export async function runMatchupOddsSweep(deps: MatchupOddsSweepDeps): Promise<MatchupOddsSweepCounts> {
  const counts = emptyMatchupOddsSweepCounts()
  const prisma = deps.prisma ?? defaultPrisma
  const now = deps.now ?? (() => Date.now())
  const leagueCap = Math.max(1, deps.leagueCap ?? DEFAULT_LEAGUE_CAP)

  // No read at all in the window — the cheapest possible no-op.
  if (inPlayWindow(new Date(now()))) {
    counts.outsideWindow = 1
    return counts
  }

  let season: number | null
  let have: Set<string>
  try {
    const latest = await prisma.weeklyMatchup.aggregate({ _max: { seasonYear: true } })
    season = latest._max.seasonYear ?? null
    if (season == null) return counts
    // Also the table-exists probe: a parked migration stops the sweep here.
    const rows = await prisma.$queryRaw<Array<{ league_id: string; week: number }>>`
      SELECT DISTINCT "league_id", "week" FROM "matchup_odds_snapshots" WHERE "season" = ${season}
    `
    have = new Set(rows.map((r) => keyOf({ leagueId: r.league_id, season: season as number, week: Number(r.week) })))
  } catch (e: unknown) {
    if (isMissingDatabaseObjectError(e)) {
      counts.unavailable = 1
      return counts
    }
    counts.failed += 1
    counts.errors.push(`due_query: ${e instanceof Error ? e.message : String(e)}`)
    return counts
  }

  /*
   * Each league's current week in the latest season: the EARLIEST week with no scored row at all.
   * A week with some scored rows is in play (or done) and is never snapshotted.
   */
  let groups: Array<{ leagueId: string; week: number; _max: { pointsFor: number | null; pointsAgainst: number | null } }>
  try {
    const grouped = await prisma.weeklyMatchup.groupBy({
      by: ['leagueId', 'week'],
      where: { seasonYear: season },
      _max: { pointsFor: true, pointsAgainst: true },
    })
    groups = grouped
  } catch (e: unknown) {
    counts.failed += 1
    counts.errors.push(`week_query: ${e instanceof Error ? e.message : String(e)}`)
    return counts
  }
  const firstUnplayed = new Map<string, number>()
  for (const g of groups) {
    const played = (g._max.pointsFor ?? 0) > 0 || (g._max.pointsAgainst ?? 0) > 0
    if (played) continue
    const held = firstUnplayed.get(g.leagueId)
    if (held == null || g.week < held) firstUnplayed.set(g.leagueId, g.week)
  }
  const units: Unit[] = [...firstUnplayed.entries()].map(([leagueId, week]) => ({ leagueId, season, week }))
  const dueUnits = units.filter((u) => !have.has(keyOf(u)))
  counts.considered = units.length
  counts.due = dueUnits.length
  if (dueUnits.length === 0) return counts

  let attempted = 0
  for (const unit of rotateForFairness(dueUnits, ROTATION_PERIOD_MS, now)) {
    if (attempted >= leagueCap) break
    if (deps.budget.exhausted() || remainingFor(now() + deps.budget.remainingMs(), PER_UNIT_CAP_MS) === null) {
      counts.skippedForTime = dueUnits.length - attempted
      break
    }
    attempted += 1

    try {
      const rows = (await prisma.weeklyMatchup.findMany({
        where: { leagueId: unit.leagueId },
        select: { leagueId: true, seasonYear: true, week: true, rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true, win: true },
      })) as MatchupRow[]
      const weekRows = rows.filter((r) => r.seasonYear === unit.season && r.week === unit.week)
      // Defence in depth: the grouped read said unplayed; the rows must agree, or nothing is written.
      if (weekRows.some((r) => r.pointsFor > 0 || r.pointsAgainst > 0)) {
        counts.started += 1
        continue
      }
      const profiles = buildProfiles(rows)
      const values: Prisma.Sql[] = []
      for (const pair of pairRows(weekRows)) {
        const a = profiles.get(`${unit.leagueId}:${pair.a.rosterId}`)
        const b = profiles.get(`${unit.leagueId}:${pair.b.rosterId}`)
        if (!a || !b) {
          counts.unprojected += 1
          continue
        }
        const pA = winProbabilityOf(a, b)
        for (const [me, them, meP, themP, p] of [
          [pair.a, pair.b, a, b, pA],
          [pair.b, pair.a, b, a, 1 - pA],
        ] as const) {
          values.push(
            Prisma.sql`(${randomUUID()}, ${unit.leagueId}, ${unit.season}, ${unit.week}, ${me.rosterId}, ${them.rosterId}, ${meP.mu}, ${themP.mu}, ${p}, ${meP.n}, ${themP.n}, ${ODDS_MODEL})`,
          )
        }
      }
      if (values.length === 0) continue
      const inserted = await prisma.$executeRaw`
        INSERT INTO "matchup_odds_snapshots"
          ("id", "league_id", "season", "week", "roster_id", "opponent_roster_id", "projected_points",
           "opponent_projected_points", "win_probability", "sample_weeks", "opponent_sample_weeks", "model")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("league_id", "season", "week", "roster_id") DO NOTHING
      `
      counts.written += Number(inserted) || 0
      if (Number(inserted) > 0) counts.leaguesWritten += 1
    } catch (e: unknown) {
      if (isMissingDatabaseObjectError(e)) {
        counts.unavailable = 1
        break
      }
      counts.failed += 1
      if (counts.errors.length < 10) {
        counts.errors.push(`${unit.leagueId} ${unit.season}w${unit.week}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return counts
}
