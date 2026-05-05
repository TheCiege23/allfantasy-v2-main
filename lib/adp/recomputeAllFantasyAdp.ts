/**
 * D.5-scheduler — reusable recompute service for AllFantasy AI ADP.
 *
 * Lifts the aggregation + upsert flow out of `scripts/recompute-allfantasy-adp.ts`
 * so a Vercel cron route (or any future caller) can run the recompute without
 * duplicating math. The CLI script is a thin wrapper around this module.
 *
 * Default behavior (matches D.5 spec):
 *   - Real-mode picks only.
 *   - `source` NOT IN ('test_seed', 'undone', 'corrected', 'deleted').
 *   - `assetType` IN (null, 'player') — devy / dispersal picks excluded.
 *   - Sport NFL by default, but `options.sport` is overridable.
 *   - Mock and test draftModes can be opted in via flags (used by the CLI).
 *
 * The cron route MUST NOT include test picks unless explicitly told to.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import {
  aggregateAdp,
  applyTrends,
  isPickValidForAdp,
  snapshotKey,
  type AdpSnapshot,
  type AggregatablePick,
  type DraftMode,
} from '@/lib/adp/computeAllFantasyAdp'

/**
 * Upsert computed **`AllFantasyAdpSnapshot`** rows — shared by cron/CLI and tests.
 * Does not run aggregation; pass **`AdpSnapshot`** from **`aggregateAdp`** / **`applyTrends`**.
 */
export async function persistAllFantasyAdpSnapshots(
  snapshots: readonly AdpSnapshot[],
): Promise<{ written: number; errors: string[] }> {
  let written = 0
  const errors: string[] = []
  for (const s of snapshots) {
    const data: Prisma.AllFantasyAdpSnapshotCreateInput = {
      playerKey: s.playerKey,
      playerName: s.playerName,
      sport: s.context.sport,
      leagueType: s.context.leagueType,
      draftType: s.context.draftType,
      scoringFormat: s.context.scoringFormat,
      rosterFormat: s.context.rosterFormat,
      teamCount: s.context.teamCount,
      season: s.context.season,
      draftMode: s.draftMode,
      sampleSize: s.sampleSize,
      averageOverallPick: s.averageOverallPick,
      averageRound: s.averageRound,
      averagePickInRound: s.averagePickInRound,
      minOverallPick: s.minOverallPick,
      maxOverallPick: s.maxOverallPick,
      standardDeviation: s.standardDeviation,
      sevenDayTrend: s.sevenDayTrend,
      thirtyDayTrend: s.thirtyDayTrend,
      contextHash: s.contextHash,
    }
    try {
      await prisma.allFantasyAdpSnapshot.upsert({
        where: {
          playerKey_contextHash_draftMode: {
            playerKey: s.playerKey,
            contextHash: s.contextHash,
            draftMode: s.draftMode,
          },
        },
        create: data,
        update: { ...data, lastUpdatedAt: new Date() },
      })
      written++
    } catch (err) {
      errors.push(
        `upsert ${s.playerName} (${s.draftMode}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return { written, errors }
}

export interface RecomputeAllFantasyAdpOptions {
  /** Default 'NFL'. Pass null to recompute across all sports (CLI use). */
  sport?: string | null
  /** Default null = all seasons. */
  season?: string | null
  /** Default 'real'. Pass 'all' or another mode to widen — cron should leave default. */
  draftMode?: DraftMode | 'all'
  /** When false (default), test_seed picks AND draftMode='test' rows are excluded. */
  includeTest?: boolean
  /** Default true. Set false to perform a dry-run. Cron uses true. */
  apply?: boolean
  /** Optional overrides used only by the CLI script. */
  leagueType?: string | null
  draftType?: string | null
  teamCount?: number | null
  /** Override the wall-clock used for trend windows; tests pass a fixed Date. */
  now?: Date
}

export interface RecomputeAllFantasyAdpReport {
  mode: 'dry-run' | 'apply'
  startedAt: string
  finishedAt: string
  durationMs: number
  sport: string | null
  season: string | null
  draftMode: DraftMode | 'all'
  includeTest: boolean
  picksScanned: number
  picksKept: number
  filteredOutBySource: number
  filteredOutByAsset: number
  filteredOutByMode: number
  uniquePlayers: number
  uniqueContexts: number
  snapshotsWritten: number
  byDraftMode: Record<DraftMode, number>
  errors: string[]
}

interface DraftPickWithSession {
  playerName: string
  position: string | null
  overall: number
  round: number
  roundPick: number | null
  pickedAt: Date | null
  source: string | null
  assetType: string | null
  session: {
    sessionKind: string
    status: string
    teamCount: number
    draftType: string
    sportType: string | null
    league: {
      sport: string
      season: number
      scoring: string | null
      isDynasty: boolean
      leagueVariant: string | null
    } | null
  }
}

function deriveDraftMode(row: DraftPickWithSession): DraftMode {
  if (row.session.sessionKind === 'mock') return 'mock'
  if (row.session.sessionKind === 'test' || (row.source ?? '').toLowerCase() === 'test_seed') return 'test'
  return 'real'
}

function deriveLeagueType(row: DraftPickWithSession): string {
  const variant = (row.session.league?.leagueVariant ?? '').trim().toLowerCase()
  if (variant) return variant
  if (row.session.league?.isDynasty) return 'dynasty'
  return 'redraft'
}

function deriveContext(row: DraftPickWithSession) {
  return {
    sport: (row.session.league?.sport ?? row.session.sportType ?? 'NFL').toString().toUpperCase(),
    leagueType: deriveLeagueType(row),
    draftType: (row.session.draftType ?? 'snake').toLowerCase(),
    scoringFormat: (row.session.league?.scoring ?? 'ppr').toLowerCase(),
    rosterFormat: 'standard' as const,
    teamCount: row.session.teamCount ?? 12,
    season: String(row.session.league?.season ?? new Date().getUTCFullYear()),
  }
}

/**
 * Runs the recompute end-to-end and returns a structured report. Safe to call
 * from a Next route handler. Errors during individual upserts are captured in
 * `report.errors` rather than thrown — the caller decides on the HTTP status.
 */
export async function recomputeAllFantasyAdp(
  options: RecomputeAllFantasyAdpOptions = {},
): Promise<RecomputeAllFantasyAdpReport> {
  const startedAt = new Date()
  const sport = options.sport === undefined ? 'NFL' : options.sport
  const season = options.season ?? null
  const draftMode: DraftMode | 'all' = options.draftMode ?? 'real'
  const includeTest = Boolean(options.includeTest)
  const apply = options.apply !== false
  const now = options.now ?? new Date()

  const report: RecomputeAllFantasyAdpReport = {
    mode: apply ? 'apply' : 'dry-run',
    startedAt: startedAt.toISOString(),
    finishedAt: '',
    durationMs: 0,
    sport,
    season,
    draftMode,
    includeTest,
    picksScanned: 0,
    picksKept: 0,
    filteredOutBySource: 0,
    filteredOutByAsset: 0,
    filteredOutByMode: 0,
    uniquePlayers: 0,
    uniqueContexts: 0,
    snapshotsWritten: 0,
    byDraftMode: { real: 0, mock: 0, test: 0 },
    errors: [],
  }

  try {
    const picksRaw = (await prisma.draftPick.findMany({
      where: {
        OR: [{ pickedAt: { not: null } }, { session: { status: 'completed' } }],
        ...(sport ? { sportType: sport } : {}),
      },
      select: {
        playerName: true,
        position: true,
        overall: true,
        round: true,
        roundPick: true,
        pickedAt: true,
        source: true,
        assetType: true,
        session: {
          select: {
            sessionKind: true,
            status: true,
            teamCount: true,
            draftType: true,
            sportType: true,
            league: {
              select: {
                sport: true,
                season: true,
                scoring: true,
                isDynasty: true,
                leagueVariant: true,
              },
            },
          },
        },
      },
    })) as unknown as DraftPickWithSession[]
    report.picksScanned = picksRaw.length

    const valid: AggregatablePick[] = []
    for (const row of picksRaw) {
      const mode = deriveDraftMode(row)
      // Caller-provided narrowing.
      if (season && String(row.session.league?.season ?? '') !== season) continue
      if (options.leagueType && deriveLeagueType(row) !== options.leagueType.toLowerCase()) continue
      if (options.draftType && (row.session.draftType ?? '').toLowerCase() !== options.draftType.toLowerCase())
        continue
      if (options.teamCount != null && (row.session.teamCount ?? 0) !== options.teamCount) continue
      if (draftMode !== 'all' && mode !== draftMode) continue

      const ok = isPickValidForAdp(
        { source: row.source, assetType: row.assetType, draftMode: mode },
        { includeTest },
      )
      if (!ok) {
        const src = (row.source ?? '').toLowerCase()
        if (src === 'undone' || src === 'corrected' || src === 'deleted') {
          report.filteredOutBySource++
        } else if (mode === 'test') {
          report.filteredOutByMode++
        } else {
          report.filteredOutByAsset++
        }
        continue
      }
      valid.push({
        playerName: row.playerName,
        position: row.position ?? '',
        overall: row.overall,
        round: row.round,
        roundPick: row.roundPick ?? null,
        pickedAt: row.pickedAt,
        context: deriveContext(row),
        draftMode: mode,
      })
    }
    report.picksKept = valid.length

    const snapshots = aggregateAdp(valid)
    report.uniquePlayers = new Set(snapshots.map((s) => s.playerKey)).size
    report.uniqueContexts = new Set(snapshots.map((s) => s.contextHash)).size
    for (const s of snapshots) report.byDraftMode[s.draftMode]++

    // Trend windows.
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const sevenMap = new Map<string, number>()
    const thirtyMap = new Map<string, number>()
    if (snapshots.length) {
      const orFilter = snapshots.map(({ playerKey, contextHash, draftMode: dm }) => ({
        playerKey,
        contextHash,
        draftMode: dm,
      }))
      const priorRows = await prisma.allFantasyAdpSnapshot.findMany({
        where: { OR: orFilter, lastUpdatedAt: { lt: sevenDaysAgo } },
        select: {
          playerKey: true,
          contextHash: true,
          draftMode: true,
          averageOverallPick: true,
          lastUpdatedAt: true,
        },
      })
      const sortedDesc = [...priorRows].sort(
        (a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime(),
      )
      for (const r of sortedDesc) {
        const k = snapshotKey({
          playerKey: r.playerKey,
          contextHash: r.contextHash,
          draftMode: r.draftMode as DraftMode,
        })
        if (r.lastUpdatedAt < sevenDaysAgo && !sevenMap.has(k)) sevenMap.set(k, r.averageOverallPick)
        if (r.lastUpdatedAt < thirtyDaysAgo && !thirtyMap.has(k))
          thirtyMap.set(k, r.averageOverallPick)
      }
    }
    const final: AdpSnapshot[] = applyTrends(snapshots, { sevenDay: sevenMap, thirtyDay: thirtyMap })

    if (apply) {
      const { written, errors: persistErrors } = await persistAllFantasyAdpSnapshots(final)
      report.snapshotsWritten = written
      report.errors.push(...persistErrors)
    }
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err))
  }

  const finishedAt = new Date()
  report.finishedAt = finishedAt.toISOString()
  report.durationMs = finishedAt.getTime() - startedAt.getTime()
  return report
}
