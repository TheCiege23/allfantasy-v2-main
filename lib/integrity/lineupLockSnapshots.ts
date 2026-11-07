import 'server-only'

import { randomUUID } from 'node:crypto'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'

import { mergeSnapshotPlayers, type SnapshotPlayerMap } from './lineupLockSnapshotMerge'
import type { SnapshotSlot } from './lineupIntegrityScore'

/**
 * Hourly: record what every manager in a monitored league can see — each player's projection, injury
 * status and bye — and FREEZE each player at their own game's kickoff. The week-close Lineup Integrity
 * score (lib/integrity/lineupIntegrityScore.ts) reads these rows instead of today's numbers.
 *
 * ⚠ ONLY LEAGUES WITH THE TANKING MONITOR ON. The score exists for that monitor; snapshotting every
 * league every hour would read 200 players per team for a number nobody looks at.
 *
 * ⚠ THE SAME READ THE MANAGER'S LINEUP SCREEN USES. `getNormalizedPlayerData({ surface: 'roster' })`
 * is what My Team renders, so the projection frozen here is the one they were shown — the same read
 * Chimmy's away-mode lineups and the eliminated-team minimums already use.
 *
 * ⚠ SHIPS BEFORE ITS MIGRATION. Until `20261107120000_lineup_lock_snapshots` is applied the table is
 * absent: `lineupLockSnapshotsReady()` answers false and the run does nothing. Raw SQL on purpose — the
 * shared node_modules' generated client is whichever session last ran `prisma generate`, so a typed
 * delegate would type-check or not depending on a peer (lib/projections/futureWeekProjectionStore.ts).
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

async function upsertPlayers(args: { leagueId: string; rosterId: string; season: number; week: number; players: SnapshotPlayerMap; slots: SnapshotSlot[] }) {
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

export type LineupSnapshotRunResult = {
  leagues: number
  teams: number
  written: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

const DEFAULT_LEAGUE_LIMIT = 40

export async function runLineupLockSnapshots(opts?: { limit?: number; deadline?: number; now?: Date }): Promise<LineupSnapshotRunResult> {
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: LineupSnapshotRunResult = { leagues: 0, teams: 0, written: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  if (!(await lineupLockSnapshotsReady())) {
    skip('table_absent')
    return result
  }

  const monitored = await prisma.leagueIntegritySettings.findMany({
    where: { tankingMonitorEnabled: true },
    select: { leagueId: true },
    orderBy: { leagueId: 'asc' },
    take: Math.max(1, Math.min(opts?.limit ?? DEFAULT_LEAGUE_LIMIT, 200)),
  })

  for (const { leagueId } of monitored) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId } })
      if (!league) continue
      const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
      const week = leagueWeekFromSettings(league.settings)
      const season = league.season
      const reason =
        resolveWriteAuthority(league.platform) !== 'NATIVE'
          ? 'not_native'
          : league.bestBallMode || automaticLineup(league.leagueType, league.settings)
            ? 'automatic_lineups'
            : !['active', 'in_season'].includes(status)
              ? 'not_in_season'
              : week == null || !season
                ? 'no_week'
                : null
      if (reason) {
        skip(reason)
        continue
      }
      const sport = String(league.sport ?? 'NFL')
      const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
      const slots: SnapshotSlot[] = resolveLineupStarterSlots(league as never, template).map((s) => ({ slot: s.label, eligible: s.allowedPositions }))
      if (slots.length === 0) {
        skip('no_slots')
        continue
      }

      const rosters = await prisma.roster.findMany({
        where: { leagueId, redraftRosterId: { not: null } },
        select: { id: true, platformUserId: true, playerData: true, redraftRosterId: true },
      })
      const prior = new Map(
        (await readLineupLockSnapshots({ leagueId, season: season!, weeks: [week!], rosterIds: rosters.map((r) => r.redraftRosterId!) })).map((r) => [r.rosterId, r]),
      )

      for (const roster of rosters) {
        if (Date.now() >= deadline) break
        result.teams += 1
        const flagRosterId = roster.redraftRosterId!
        try {
          if (!roster.platformUserId) {
            skip('no_owner')
            continue
          }
          const [rows, lock] = await Promise.all([
            getNormalizedPlayerData({ surface: 'roster', leagueId, userId: roster.platformUserId, limit: 200 }),
            resolveFullLineupLockContext({
              leagueId,
              rosterId: roster.id,
              sport,
              leagueVariant: league.leagueVariant as string | null,
              settings: league.settings,
              leagueWeek: week!,
              editingWeek: week!,
              season: season!,
              now: opts?.now ?? new Date(),
              playerData: roster.playerData,
              lockAllMoves: league.lockAllMoves,
              lifecycleState: league.lifecycleState,
            }).catch(() => null),
          ])
          const current: SnapshotPlayerMap = {}
          for (const p of rows.map(serializeUnifiedPlayerForApi)) {
            current[p.id] = {
              name: p.name ?? null,
              position: p.position ?? null,
              proj: typeof p.projectedPoints === 'number' ? p.projectedPoints : null,
              status: p.injuryStatus ?? null,
              bye: p.product?.byeWeek ?? null,
              team: p.team ?? null,
              frozenAt: null,
            }
          }
          const next = mergeSnapshotPlayers({
            prior: prior.get(flagRosterId)?.players ?? null,
            current,
            lockedIds: new Set(lock?.lockedPlayerIds ?? []),
            nowIso: (opts?.now ?? new Date()).toISOString(),
          })
          if (!next.changed) {
            skip('unchanged')
            continue
          }
          await upsertPlayers({ leagueId, rosterId: flagRosterId, season: season!, week: week!, players: next.players, slots })
          result.written += 1
        } catch (e) {
          result.failures.push({ leagueId, rosterId: flagRosterId, error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
