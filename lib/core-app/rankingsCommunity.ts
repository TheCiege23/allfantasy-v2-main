import 'server-only'

import { prisma } from '@/lib/prisma'
import { getLevelFromXp } from '@/lib/rank/levels'
import { loadCareerLedger, type CareerLedgerRow } from '@/lib/rank/careerLedger'
import { careerXp } from '@/lib/rank/careerXp'
import {
  DEFAULT_FILTERS,
  buildScoringCohorts,
  easternDateKey,
  matchesFilters,
  rankBoard,
  scoreRows,
  type CommunityEntry,
  type RankingFilters,
  type ScoringCohorts,
} from '@/lib/core-app/rankingsEngine'
import { snapshotExists, writeRankSnapshot } from '@/lib/core-app/rankingsSnapshots'
// Safe under the import rule below: prisma, the ledger and pure XP maths, plus a
// career-profile hook it loads dynamically and catches — it is run from plain tsx too.
import { calculateAndSaveRank } from '@/lib/rank/calculateRank'

/**
 * The community base for `/core/rankings` — every ranked manager and their
 * career ledger — plus the daily snapshot writer that runs from a cron.
 *
 * ⚠ SPLIT OUT OF `rankings.ts` SO THE CRON DOES NOT IMPORT THE SCREEN'S GRAPH.
 * The screen loader also reaches `playerFinder` and `leagueStandings`, whose
 * import graphs load `lib/auth.ts` — which throws at import time when
 * `NEXTAUTH_SECRET` is unset. `/api/cron/domain-os-refresh` imports this module
 * only, so a worker env that differs from the web service's cannot take the whole
 * cron route down at module load. Keep this file's imports to prisma, the ledger
 * and the pure engine.
 */

/* ─────────────────────────── the community base ─────────────────────────── */

type ProfileRow = {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  xpTotal: number | null
  rankCalculatedAt: string | null
}

export type CommunityBase = {
  profiles: ProfileRow[]
  rows: CareerLedgerRow[]
  rowsByUser: Map<string, CareerLedgerRow[]>
  cohorts: ScoringCohorts
  computedAt: string
}

/**
 * Every profile that has ever been ranked — the community population.
 *
 * ⚠ `rank_calculated_at IS NOT NULL` IS THE ELIGIBILITY TEST. A manager who was
 * scored and came out at zero belongs in the population; one who was never
 * scored does not.
 */
async function loadRankedProfiles(): Promise<ProfileRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      userId: string
      username: string | null
      displayName: string | null
      avatarUrl: string | null
      xp_total: bigint | number | null
      rank_calculated_at: Date | null
    }>
  >`
    SELECT p."userId",
           u.username,
           u."displayName",
           u."avatarUrl",
           p.xp_total,
           p.rank_calculated_at
      FROM user_profiles p
      JOIN app_users u ON u.id = p."userId"
     WHERE p.rank_calculated_at IS NOT NULL
  `
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    xpTotal: r.xp_total == null ? null : Number(r.xp_total),
    rankCalculatedAt: r.rank_calculated_at ? r.rank_calculated_at.toISOString() : null,
  }))
}

/**
 * ⚠ AN IN-PROCESS MEMO, NOT `unstable_cache`. The ledger for the whole
 * population is ~1,200 rows today and grows with every import; Next's data cache
 * refuses items over 2 MB, and a refused write is silent. A one-minute memo per
 * server process bounds the query rate just as well, and a concurrent second
 * render shares the in-flight read instead of issuing its own.
 */
const COMMUNITY_TTL_MS = 60_000
let communityMemo: { at: number; value: Promise<CommunityBase> } | null = null

async function buildCommunity(): Promise<CommunityBase> {
  const profiles = await loadRankedProfiles()
  const rows = await loadCareerLedger(profiles.map((p) => p.userId))
  const rowsByUser = new Map<string, CareerLedgerRow[]>()
  for (const r of rows) {
    const list = rowsByUser.get(r.userId) ?? []
    list.push(r)
    rowsByUser.set(r.userId, list)
  }
  return { profiles, rows, rowsByUser, cohorts: buildScoringCohorts(rows), computedAt: new Date().toISOString() }
}

export async function loadCommunity(opts: { fresh?: boolean } = {}): Promise<CommunityBase> {
  const now = Date.now()
  if (!opts.fresh && communityMemo && now - communityMemo.at < COMMUNITY_TTL_MS) return communityMemo.value
  const value = buildCommunity()
  communityMemo = { at: now, value }
  value.catch(() => {
    if (communityMemo?.value === value) communityMemo = null
  })
  return value
}

export function handleOf(p: Pick<ProfileRow, 'displayName' | 'username'>): string {
  return p.displayName?.trim() || p.username?.trim() || 'Manager'
}

export function levelOf(rows: CareerLedgerRow[]) {
  return getLevelFromXp(careerXp(rows).total)
}

export function communityEntries(base: CommunityBase, filters: RankingFilters, maxSeason?: number): CommunityEntry[] {
  return base.profiles.map((p) => {
    const all = base.rowsByUser.get(p.userId) ?? []
    const rows = all.filter((r) => matchesFilters(r, filters) && (maxSeason == null || r.season <= maxSeason))
    const lvl = levelOf(all)
    return {
      userId: p.userId,
      handle: handleOf(p),
      avatarUrl: p.avatarUrl,
      level: lvl.level,
      tierGroup: lvl.tierGroup,
      score: scoreRows(rows, base.cohorts),
    }
  })
}

/* ─────────────────────────── the daily snapshot ─────────────────────────── */

export type RankingsSnapshotCounts = {
  date: string | null
  written: number
  alreadyWritten: number
  population: number
  failed: number
  /** Stored levels rewritten because they disagreed with the ledger. */
  levelsRefreshed: number
  /** Stale levels whose rewrite returned nothing. Kept apart from `failed`, which is the snapshot. */
  levelsRefreshFailed: number
  /** Stale levels left for tomorrow by `LEVEL_REFRESH_CAP`. */
  levelsDeferred: number
  errors: string[]
}

export function emptyRankingsSnapshotCounts(): RankingsSnapshotCounts {
  return {
    date: null,
    written: 0,
    alreadyWritten: 0,
    population: 0,
    failed: 0,
    levelsRefreshed: 0,
    levelsRefreshFailed: 0,
    levelsDeferred: 0,
    errors: [],
  }
}

/* ─────────────────────────── the stored level ───────────────────────────── */

/**
 * Most stale levels rewritten per day. Each rewrite re-reads one manager's ledger,
 * so this bounds the first fire of the day however large the population grows.
 */
export const LEVEL_REFRESH_CAP = 200

/**
 * Managers whose STORED XP disagrees with the published formula over today's ledger.
 *
 * ⚠ THE STORED LEVEL IS ONLY REWRITTEN BY AN IMPORT, SO IT ROTS. `/core/rankings`
 * computes the level from the ledger on every render, but `user_profiles.xp_level`
 * is what the join gate, `/api/user/rank` and every badge read — and nothing
 * rewrote it unless the manager re-imported. Measured 2026-10-01: 8 of 12 ranked
 * profiles disagreed with their ledger, the largest stored at level 21 against a
 * ledger-derived 13 (an XP total from an older formula, last written 2026-05-06).
 *
 * An empty ledger is skipped: `calculateAndSaveRank` writes nothing for one, so
 * listing it would retry it every day for nothing.
 */
export function staleLevelUserIds(base: CommunityBase): string[] {
  const out: string[] = []
  for (const p of base.profiles) {
    const rows = base.rowsByUser.get(p.userId) ?? []
    if (rows.length === 0) continue
    if (p.xpTotal == null || careerXp(rows).total !== p.xpTotal) out.push(p.userId)
  }
  return out
}

async function refreshStaleLevels(base: CommunityBase, out: RankingsSnapshotCounts): Promise<void> {
  const stale = staleLevelUserIds(base)
  out.levelsDeferred = Math.max(0, stale.length - LEVEL_REFRESH_CAP)
  // Sequential on purpose: a handful of ledger reads, never a burst against the pool.
  for (const userId of stale.slice(0, LEVEL_REFRESH_CAP)) {
    const saved = await calculateAndSaveRank(userId)
    if (saved) out.levelsRefreshed += 1
    else out.levelsRefreshFailed += 1
  }
}

/**
 * Write today's Overall board, once per Eastern day — and on that same first fire,
 * rewrite any stored level that has drifted from the ledger (see `staleLevelUserIds`).
 *
 * Cheap by construction — one existence check per fire, and on the first fire of
 * the day one ledger read, one upsert, and one ledger read per stale level (capped)
 * — so it runs every fire rather than behind a flag.
 * `CORE_RANKINGS_SNAPSHOT_DISABLED=true` turns both off.
 */
export async function runRankingsDailySnapshot(now: Date = new Date()): Promise<RankingsSnapshotCounts> {
  const out = emptyRankingsSnapshotCounts()
  if (String(process.env.CORE_RANKINGS_SNAPSHOT_DISABLED ?? '').toLowerCase() === 'true') return out
  const date = easternDateKey(now)
  out.date = date
  try {
    if (await snapshotExists(date)) {
      out.alreadyWritten = 1
      return out
    }
    const base = await loadCommunity({ fresh: true })
    const board = rankBoard(communityEntries(base, DEFAULT_FILTERS), 'overall', DEFAULT_FILTERS.minSample)
    await writeRankSnapshot(
      {
        date,
        population: base.profiles.length,
        rows: board.rows.map((r) => ({ u: r.userId, r: r.rank, s: r.metric })),
      },
      now,
    )
    out.written = 1
    out.population = board.rows.length
    // After the snapshot, never before: a level rewrite must not be able to cost the board.
    await refreshStaleLevels(base, out).catch((e: unknown) => {
      out.errors.push(`level_refresh: ${e instanceof Error ? e.message : String(e)}`)
    })
  } catch (e) {
    out.failed = 1
    out.errors.push(`rankings_snapshot: ${e instanceof Error ? e.message : String(e)}`)
  }
  return out
}
