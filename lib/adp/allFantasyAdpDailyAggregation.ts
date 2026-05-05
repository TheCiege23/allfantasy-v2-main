/**
 * AllFantasy **AI ADP** daily aggregation — pure helpers + types.
 *
 * AUDIT (production pipeline):
 * - **System / imported ADP**: Player pool `adp` from external/import resolution (`getResolvedDraftPoolForLeague`
 *   resolved rows) — not computed here.
 * - **AllFantasy AI ADP**: Aggregated from real app **`DraftPick`** rows → **`aggregateAdp`** in
 *   `computeAllFantasyAdp.ts` → persisted to **`AllFantasyAdpSnapshot`** via **`persistAllFantasyAdpSnapshots`**
 *   (`recomputeAllFantasyAdp.ts`). Snapshot key is **`(playerKey, contextHash, draftMode)`** where `playerKey`
 *   is `name|position` — context separates scoring/format/teamCount/season.
 * - **Player pool exposure**: `aiAdp`, `aiAdpSampleSize`, … from `AllFantasyAdpSnapshot` join by context hash
 *   (`getResolvedDraftPoolForLeague`) — never overwrites imported **`adp`**.
 *
 * This module adds **playerId + sport rollups** for analytics/tests — orthogonal to context-keyed snapshots.
 */

import type { DraftMode } from '@/lib/adp/computeAllFantasyAdp'
import {
  aggregateAdp,
  isPickValidForAdp,
  type AdpSnapshot,
  type AggregatablePick,
} from '@/lib/adp/computeAllFantasyAdp'

export type { AggregatablePick, AdpSnapshot }
export { aggregateAdp }

/** Same as **`aggregateAdp`** — context-keyed AllFantasy AI ADP snapshots (not playerId-only rollup). */
export function computeAllFantasyAdpFromPicks(picks: readonly AggregatablePick[]) {
  return aggregateAdp(picks)
}

export interface DraftPickSampleRow {
  playerId: string | null
  playerName: string
  position: string | null
  overall: number
  /** League sport (uppercase). */
  sport: string
  /** `DraftPick.sportType` when set — must match league sport or row is skipped. */
  sportTypePick?: string | null
  source: string | null
  assetType: string | null
  sessionKind: string
  sessionStatus: string
  pickedAt: Date | null
  leagueId: string
  draftSessionId: string
}

export type CollectSamplesOptions = {
  includeTest?: boolean
  requirePlayerId?: boolean
  excludeMockSessions?: boolean
}

export type CollectSamplesResult = {
  kept: DraftPickSampleRow[]
  skippedMock: number
  skippedInvalid: number
  skippedNoPlayerId: number
  skippedSportMismatch: number
}

export function deriveDraftModeFromSession(sessionKind: string, source: string | null): DraftMode {
  const sk = (sessionKind ?? '').toLowerCase()
  if (sk === 'mock') return 'mock'
  if (sk === 'test' || (source ?? '').toLowerCase() === 'test_seed') return 'test'
  return 'real'
}

/**
 * Filter draft pick rows using the same validity gates as `recomputeAllFantasyAdp` (mock/test/source/asset).
 * Use **`collectAllFantasyDraftPickSamples`** output as input to **`computeAllFantasyAdpByPlayerIdSport`**
 * for playerId rollups, or map to **`AggregatablePick`** for context snapshots.
 */
export function collectAllFantasyDraftPickSamples(
  rows: readonly DraftPickSampleRow[],
  options: CollectSamplesOptions = {},
): CollectSamplesResult {
  const includeTest = Boolean(options.includeTest)
  const requirePlayerId = Boolean(options.requirePlayerId)
  const excludeMock = options.excludeMockSessions !== false

  let skippedMock = 0
  let skippedInvalid = 0
  let skippedNoPlayerId = 0
  let skippedSportMismatch = 0

  const kept: DraftPickSampleRow[] = []

  for (const row of rows) {
    if (excludeMock && (row.sessionKind ?? '').toLowerCase() === 'mock') {
      skippedMock++
      continue
    }
    const mode = deriveDraftModeFromSession(row.sessionKind, row.source)
    if (
      !isPickValidForAdp(
        { source: row.source, assetType: row.assetType, draftMode: mode },
        { includeTest },
      )
    ) {
      skippedInvalid++
      continue
    }
    if (!row.playerName?.trim()) {
      skippedInvalid++
      continue
    }
    if (!Number.isFinite(row.overall) || row.overall < 1) {
      skippedInvalid++
      continue
    }
    const leagueSport = String(row.sport ?? '').toUpperCase()
    const pickSport = row.sportTypePick ? String(row.sportTypePick).toUpperCase() : null
    if (pickSport && leagueSport && pickSport !== leagueSport) {
      skippedSportMismatch++
      continue
    }
    if (requirePlayerId && !(row.playerId ?? '').trim()) {
      skippedNoPlayerId++
      continue
    }
    kept.push(row)
  }

  return { kept, skippedMock, skippedInvalid, skippedNoPlayerId, skippedSportMismatch }
}

export type PlayerSportAdpRollup = {
  sport: string
  playerId: string
  playerName: string
  averageOverall: number
  sampleCount: number
  minOverall: number
  maxOverall: number
  lastDraftedAt: string | null
}

/**
 * Average overall pick per (**sport**, **playerId**) — for dashboards/tests.
 * Production **`AllFantasyAdpSnapshot`** remains context-keyed via **`aggregateAdp`**.
 */
export function computeAllFantasyAdpByPlayerIdSport(
  samples: readonly DraftPickSampleRow[],
): PlayerSportAdpRollup[] {
  type G = {
    sport: string
    playerId: string
    playerName: string
    overalls: number[]
    dates: Date[]
  }
  const m = new Map<string, G>()
  for (const s of samples) {
    const pid = (s.playerId ?? '').trim()
    if (!pid) continue
    const sport = String(s.sport ?? '').toUpperCase()
    const k = `${sport}::${pid}`
    const g =
      m.get(k) ??
      ({
        sport,
        playerId: pid,
        playerName: s.playerName.trim(),
        overalls: [],
        dates: [],
      } as G)
    g.overalls.push(s.overall)
    if (s.pickedAt) g.dates.push(s.pickedAt)
    if (s.playerName.trim()) g.playerName = s.playerName.trim()
    m.set(k, g)
  }
  const out: PlayerSportAdpRollup[] = []
  for (const g of m.values()) {
    const overalls = g.overalls
    const sum = overalls.reduce((a, b) => a + b, 0)
    const last =
      g.dates.length > 0
        ? new Date(Math.max(...g.dates.map((d) => d.getTime()))).toISOString()
        : null
    out.push({
      sport: g.sport,
      playerId: g.playerId,
      playerName: g.playerName,
      averageOverall: Math.round((sum / overalls.length) * 100) / 100,
      sampleCount: overalls.length,
      minOverall: Math.min(...overalls),
      maxOverall: Math.max(...overalls),
      lastDraftedAt: last,
    })
  }
  out.sort((a, b) => `${a.sport}::${a.playerId}`.localeCompare(`${b.sport}::${b.playerId}`))
  return out
}

export type DailyRecomputeSummary = {
  sportsProcessed: string[]
  samplesCollected: number
  playersUpdated: number
  skippedRows: number
  computedForDate: string
}

export function buildDailyRecomputeSummary(input: {
  rollup: PlayerSportAdpRollup[]
  collectSkipped: number
  computedForDate: Date
}): DailyRecomputeSummary {
  const sports = [...new Set(input.rollup.map((r) => r.sport))].sort()
  return {
    sportsProcessed: sports,
    samplesCollected: input.rollup.reduce((n, r) => n + r.sampleCount, 0),
    playersUpdated: input.rollup.length,
    skippedRows: input.collectSkipped,
    computedForDate: input.computedForDate.toISOString().slice(0, 10),
  }
}
