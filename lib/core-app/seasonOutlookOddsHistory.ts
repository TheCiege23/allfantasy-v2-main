import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { isMissingDatabaseObjectError } from '@/lib/prisma/schema-drift'
import { pctOf, type SimGame, type SimInput } from './outlookSim'
import { weeklyScopeKey } from './weeklyCapabilities'
import type { LeagueSimResult } from './seasonOutlookSims'

/**
 * Season Outlook — how a team's playoff and title odds moved, week by week (`league_odds_snapshots`).
 *
 * ⚠ NO SECOND SIMULATOR. Every row is read off a `LeagueSimResult` that `seasonOutlookSims.ts` already
 * produced — the stored per-league run the page prints. This file only turns its counts into
 * percentages (with the page's own `pctOf`) and stores them under the week that was current.
 *
 * ── WHO WRITES ────────────────────────────────────────────────────────────────────────────────────
 * 1. The scheduled pre-compute (`/api/cron/domain-os-refresh` every 30 min → `runOutlookPrewarm` →
 *    `refreshLeagueOutlook`), on every league it computes OR confirms unchanged — bounded by that
 *    job's own 12-league / 30 s slice of the cron's shared run budget. This is the writer that keeps
 *    the table current; a league nobody opens still gets its weekly row.
 * 2. The live re-run after a live points pass (same `refreshLeagueOutlook`).
 * 3. The page, whenever it computes a run (`getSeasonOutlook`), fire-and-forget.
 *
 * One row per modelled team per league-week, upserted, so re-runs inside a week overwrite in place and
 * the row a week keeps is the last run made while it was current. Teams the model cannot fit yet (too
 * few completed weeks) are not written: their 0% is "not modelled", not a probability.
 *
 * ── RETENTION (owner's default, change `SEASONS_KEPT`) ──────────────────────────────────────────────
 * The current and previous season per league. Every write deletes that league's older seasons.
 *
 * ── 🛑 THE TABLE MAY NOT EXIST ──────────────────────────────────────────────────────────────────────
 * Code ships ahead of its migration here. Nothing in this file throws: a missing table (42P01 via
 * P2010) makes a write a no-op and a read "no history", which the screen renders as no chart at all.
 */

/** Seasons kept per league: this one and the one before. */
export const SEASONS_KEPT = 2

/** Below this many weeks a line says nothing, so the read returns nothing. */
export const MIN_HISTORY_WEEKS = 2

export type OddsHistoryPoint = { week: number; playoffPct: number; titlePct: number }

export type OddsSnapshotInput = {
  /** Season Outlook scope key (`weeklyScopeKey`), the id the stored run is keyed on. */
  pid: string
  season: number
  week: number
  result: Pick<LeagueSimResult, 'iterations' | 'counts' | 'computedAt'>
  /** Only modelled teams are written. */
  teams: ReadonlyArray<{ rosterId: string; modelled: boolean }>
}

export type OddsSnapshotWrite = {
  ok: boolean
  written: number
  pruned: number
  /** Why nothing was written. `missing_table` is the expected state before the migration. */
  reason?: 'no_rows' | 'missing_table' | 'error'
}

type Db = Pick<typeof defaultPrisma, '$executeRaw' | '$queryRaw'>

const round = (n: number) => Math.round(n * 100) / 100

/**
 * The week a run belongs to: the league's current scoring period, else the next unplayed week, else
 * the last played one. Null when the run carries no week at all — nothing is written then.
 */
export function snapshotWeek(p: { period?: number; sim: Pick<SimInput, 'remaining'>; played?: readonly SimGame[] }): number | null {
  if (typeof p.period === 'number' && Number.isFinite(p.period) && p.period > 0) return p.period
  const next = (p.sim?.remaining ?? []).map((g) => g.week).filter((w) => Number.isFinite(w) && w > 0)
  if (next.length) return Math.min(...next)
  const last = (p.played ?? []).map((g) => g.week).filter((w) => Number.isFinite(w) && w > 0)
  return last.length ? Math.max(...last) : null
}

/**
 * The snapshot for one prepared league and its run, or null when it has nothing to file — no week, no
 * season, no teams, no run. Never throws: it sits on the pre-compute's path, where a throw would count
 * a league as failed.
 */
export function snapshotFromRun(
  p: { pid: string; season: number; period?: number; sim: Pick<SimInput, 'remaining' | 'teams'>; played?: readonly SimGame[] },
  result: OddsSnapshotInput['result'] | null | undefined,
): OddsSnapshotInput | null {
  try {
    const week = snapshotWeek(p)
    const teams = Array.isArray(p.sim?.teams) ? p.sim.teams : []
    if (week == null || !result?.counts || !p.pid || !Number.isFinite(p.season) || p.season <= 0 || teams.length === 0) return null
    return {
      pid: p.pid,
      season: p.season,
      week,
      result,
      teams: teams.map((t) => ({ rosterId: t.rosterId, modelled: t.profile != null })),
    }
  } catch {
    return null
  }
}

/**
 * Upsert one league-week's odds for every modelled team, then prune that league's seasons older than
 * the previous one. Never throws.
 */
export async function writeOddsSnapshot(input: OddsSnapshotInput | null, deps: { prisma?: Db } = {}): Promise<OddsSnapshotWrite> {
  if (!input) return { ok: false, written: 0, pruned: 0, reason: 'no_rows' }
  const n = input.result.iterations
  const teams = input.teams.filter((t) => t.modelled && t.rosterId)
  if (teams.length === 0 || !(n > 0)) return { ok: false, written: 0, pruned: 0, reason: 'no_rows' }
  try {
    const db = deps.prisma ?? defaultPrisma
    const computedAt = new Date(Date.parse(input.result.computedAt) || Date.now())
    const values = teams.map((t) => {
      const c = input.result.counts[t.rosterId] ?? { playoff: 0, bye: 0, title: 0 }
      return Prisma.sql`(${randomUUID()}, ${input.pid}, ${input.season}, ${input.week}, ${t.rosterId}, ${round(pctOf(c.playoff, n))}, ${round(pctOf(c.title, n))}, ${computedAt})`
    })
    const written = await db.$executeRaw`
      INSERT INTO "league_odds_snapshots"
        ("id", "league_id", "season", "week", "team_external_id", "playoff_pct", "title_pct", "computed_at")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("league_id", "season", "week", "team_external_id")
      DO UPDATE SET "playoff_pct" = EXCLUDED."playoff_pct", "title_pct" = EXCLUDED."title_pct", "computed_at" = EXCLUDED."computed_at"`
    const pruned = await db.$executeRaw`
      DELETE FROM "league_odds_snapshots"
      WHERE "league_id" = ${input.pid} AND "season" <= ${input.season - SEASONS_KEPT}`
    return { ok: true, written: Number(written) || 0, pruned: Number(pruned) || 0 }
  } catch (e) {
    return { ok: false, written: 0, pruned: 0, reason: isMissingDatabaseObjectError(e) ? 'missing_table' : 'error' }
  }
}

/**
 * Your team's odds by week this season, oldest first. Null — never an empty array — when there is
 * nothing worth drawing: the table is missing, the read failed, or fewer than two weeks are on file.
 */
export async function readOddsHistory(
  league: { id: string; platform?: string | null; platformLeagueId?: string | null },
  season: number,
  rosterId: string,
  deps: { prisma?: Db } = {},
): Promise<OddsHistoryPoint[] | null> {
  if (!rosterId || !Number.isFinite(season)) return null
  try {
    const db = deps.prisma ?? defaultPrisma
    const rows = await db.$queryRaw<Array<{ week: number; playoff_pct: number; title_pct: number }>>`
      SELECT "week", "playoff_pct", "title_pct" FROM "league_odds_snapshots"
      WHERE "league_id" = ${weeklyScopeKey(league)} AND "season" = ${season} AND "team_external_id" = ${rosterId}
      ORDER BY "week" ASC`
    const points = (Array.isArray(rows) ? rows : [])
      .map((r) => ({ week: Number(r.week), playoffPct: Number(r.playoff_pct), titlePct: Number(r.title_pct) }))
      .filter((r) => Number.isFinite(r.week) && Number.isFinite(r.playoffPct) && Number.isFinite(r.titlePct))
    return points.length >= MIN_HISTORY_WEEKS ? points : null
  } catch {
    return null
  }
}
