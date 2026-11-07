import 'server-only'

import { randomUUID } from 'node:crypto'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import type { SnapshotPlayerMap } from './lineupLockSnapshotMerge'
import type { SnapshotSlot } from './lineupIntegrityScore'

/**
 * The only module that reads or writes `lineup_lock_snapshots` — Prisma and nothing else.
 *
 * ⚠ KEPT APART FROM THE HOURLY WRITER ON PURPOSE. The writer (./lineupLockSnapshots.ts) needs the
 * lineup-lock service, the roster template and the player-data reader, which pull in the specialty
 * league registry. The tanking scan only needs to READ a snapshot, and it is reached from score sync and
 * week finalization; importing the writer there dragged that whole graph into every one of those paths
 * (and broke their test mocks). Readers import this file; only the cron imports the writer.
 *
 * ⚠ SHIPS BEFORE ITS MIGRATION. Until `20261107120000_lineup_lock_snapshots` is applied the table is
 * absent: `lineupLockSnapshotsReady()` answers false, reads return `[]` and writes do nothing. Raw SQL
 * on purpose — the shared node_modules' generated client is whichever session last ran `prisma generate`
 * (lib/projections/futureWeekProjectionStore.ts).
 */

const RECHECK_MS = 10 * 60_000
let readyCache: { ready: boolean; at: number } | null = null

export async function lineupLockSnapshotsReady(now: number = Date.now()): Promise<boolean> {
  if (readyCache?.ready) return true
  if (readyCache && now - readyCache.at < RECHECK_MS) return false
  let ready = false
  try {
    const rows = await prisma.$queryRaw<Array<{ n: number | bigint }>>`
      SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'lineup_lock_snapshots'`
    ready = Number(rows[0]?.n ?? 0) === 1
  } catch {
    ready = false
  }
  readyCache = { ready, at: now }
  return ready
}

/** Test seam. */
export function resetLineupLockSnapshotsReadyCache(): void {
  readyCache = null
}

export type LineupLockSnapshotRow = {
  rosterId: string
  season: number
  week: number
  players: SnapshotPlayerMap
  slots: SnapshotSlot[]
  startedProj: number | null
  optimalProj: number | null
  ratio: number | null
  startedTopCount: number | null
  starterCount: number | null
  excludedIds: string[]
  skipReason: string | null
  scoredAt: Date | null
}

type RawRow = {
  roster_id: string
  season: number
  week: number
  players: unknown
  slots: unknown
  started_proj: number | null
  optimal_proj: number | null
  ratio: number | null
  started_top_count: number | null
  starter_count: number | null
  excluded_ids: string[] | null
  skip_reason: string | null
  scored_at: Date | null
}

function fromRaw(r: RawRow): LineupLockSnapshotRow {
  return {
    rosterId: r.roster_id,
    season: Number(r.season),
    week: Number(r.week),
    players: (r.players && typeof r.players === 'object' ? r.players : {}) as SnapshotPlayerMap,
    slots: Array.isArray(r.slots) ? (r.slots as SnapshotSlot[]) : [],
    startedProj: r.started_proj,
    optimalProj: r.optimal_proj,
    ratio: r.ratio,
    startedTopCount: r.started_top_count,
    starterCount: r.starter_count,
    excludedIds: r.excluded_ids ?? [],
    skipReason: r.skip_reason,
    scoredAt: r.scored_at,
  }
}

/** Snapshots for a league. `[]` while the table is absent. */
export async function readLineupLockSnapshots(args: {
  leagueId: string
  season: number
  rosterIds?: readonly string[]
  weeks?: readonly number[]
}): Promise<LineupLockSnapshotRow[]> {
  if (!(await lineupLockSnapshotsReady())) return []
  const filters: Prisma.Sql[] = [Prisma.sql`league_id = ${args.leagueId}`, Prisma.sql`season = ${args.season}`]
  if (args.rosterIds) {
    if (args.rosterIds.length === 0) return []
    filters.push(Prisma.sql`roster_id IN (${Prisma.join([...args.rosterIds])})`)
  }
  if (args.weeks) {
    if (args.weeks.length === 0) return []
    filters.push(Prisma.sql`week IN (${Prisma.join([...args.weeks])})`)
  }
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT roster_id, season, week, players, slots, started_proj, optimal_proj, ratio, started_top_count,
           starter_count, excluded_ids, skip_reason, scored_at
    FROM lineup_lock_snapshots WHERE ${Prisma.join(filters, ' AND ')} ORDER BY week ASC`
  return rows.map(fromRaw)
}

export async function upsertPlayers(args: { leagueId: string; rosterId: string; season: number; week: number; players: SnapshotPlayerMap; slots: SnapshotSlot[] }) {
  const players = JSON.stringify(args.players)
  const slots = JSON.stringify(args.slots)
  await prisma.$executeRaw`
    INSERT INTO lineup_lock_snapshots (id, league_id, roster_id, season, week, players, slots, created_at, updated_at)
    VALUES (${randomUUID()}, ${args.leagueId}, ${args.rosterId}, ${args.season}, ${args.week}, ${players}::jsonb, ${slots}::jsonb, NOW(), NOW())
    ON CONFLICT (league_id, roster_id, season, week)
    DO UPDATE SET players = EXCLUDED.players, slots = EXCLUDED.slots, updated_at = NOW()`
}

/** Writes the week's score onto its snapshot row (lib/integrity/lineupIntegrityWeek.ts). */
export async function writeLineupScore(args: {
  leagueId: string
  rosterId: string
  season: number
  week: number
  score:
    | { scored: true; startedProj: number; optimalProj: number; ratio: number; startedTopCount: number; starterCount: number; excludedIds: string[] }
    | { scored: false; skipReason: string }
  algorithmVersion: string
}): Promise<void> {
  const s = args.score
  const excluded = s.scored ? s.excludedIds : []
  await prisma.$executeRaw`
    UPDATE lineup_lock_snapshots SET
      started_proj = ${s.scored ? s.startedProj : null},
      optimal_proj = ${s.scored ? s.optimalProj : null},
      ratio = ${s.scored ? s.ratio : null},
      started_top_count = ${s.scored ? s.startedTopCount : null},
      starter_count = ${s.scored ? s.starterCount : null},
      excluded_ids = ${excluded}::text[],
      skip_reason = ${s.scored ? null : s.skipReason},
      scored_at = NOW(),
      algorithm_version = ${args.algorithmVersion},
      updated_at = NOW()
    WHERE league_id = ${args.leagueId} AND roster_id = ${args.rosterId} AND season = ${args.season} AND week = ${args.week}`
}
