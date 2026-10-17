import { describe, expect, it } from 'vitest'
import { reconcileSeasonStatSnapshots } from '@/lib/tournament/seasonStatSnapshotReconciliation'
import type { SeasonStatBatch } from '@/lib/tournament/seasonStatAdapter'

function snapshot(): SeasonStatBatch {
  return {
    requestId: 'one', expectedRevision: 0, period: 1,
    provider: 'rolling_insights' as const, format: 'canonical_game_v1' as const,
    observedAt: '2026-10-21T05:00:00Z', coverage: 'complete' as const,
    games: [{ providerGameId: 'g1', actualStartsAt: '2026-10-20T23:00:00Z', startVerified: true as const,
      seasonType: 'regular' as const, status: 'final' as const,
      rows: [{ providerPlayerId: 'p1', revision: 1, stats: { points: 10 } }, { providerPlayerId: 'p2', revision: 1, stats: { points: 5 } }] }],
  }
}
const copy = <T,>(value: T): T => structuredClone(value)

describe('full-period stat snapshot correction reconciliation', () => {
  it('pins a baseline and treats response ordering or request IDs as the same source snapshot', () => {
    const first = snapshot(), second = copy(first)
    second.requestId = 'two'; second.expectedRevision = 1
    second.games[0]!.rows.reverse()
    const baseline = reconcileSeasonStatSnapshots(null, first)
    const refresh = reconcileSeasonStatSnapshots(first, second)
    expect(refresh).toMatchObject({ previousSnapshotDigest: baseline.snapshotDigest, snapshotDigest: baseline.snapshotDigest,
      baselineRows: 2, correctedRows: 0, backfilledRows: 0, versionAdvancedRows: 0 })
  })
  it('records corrected facts, finality changes and backfilled rows with explicit newer revisions', () => {
    const first = snapshot(), second = copy(first)
    second.games[0]!.rows[0]!.revision = 2
    second.games[0]!.rows[0]!.stats.points = 11
    second.games[0]!.rows.push({ providerPlayerId: 'p3', revision: 1, stats: { points: 2 } })
    expect(reconcileSeasonStatSnapshots(first, second)).toMatchObject({ correctedRows: 1, backfilledRows: 1, versionAdvancedRows: 1, statusChangedGames: 0 })
    second.games[0]!.status = 'provisional'
    second.games[0]!.rows[1]!.revision = 2
    expect(reconcileSeasonStatSnapshots(first, second)).toMatchObject({ correctedRows: 2, statusChangedGames: 1 })
  })
  it('refuses silent removals, revision regressions and changed facts without a new revision', () => {
    const first = snapshot(), second = copy(first)
    second.games[0]!.rows.pop()
    expect(() => reconcileSeasonStatSnapshots(first, second)).toThrow('vanished')
    second.games[0]!.rows = copy(first.games[0]!.rows)
    second.games[0]!.rows[0]!.stats.points = 12
    expect(() => reconcileSeasonStatSnapshots(first, second)).toThrow('newer player revision')
    second.games[0]!.rows[0]!.revision = 2
    second.games[0]!.actualStartsAt = '2026-10-20T23:05:00Z'
    expect(() => reconcileSeasonStatSnapshots(first, second)).toThrow('Schedule correction review')
  })
  it('refuses a full coverage downgrade, game deletion and duplicate player rows', () => {
    const first = snapshot(), second = copy(first)
    second.coverage = 'provisional'
    expect(() => reconcileSeasonStatSnapshots(first, second)).toThrow('cannot be downgraded')
    second.coverage = 'complete'
    second.games = []
    expect(() => reconcileSeasonStatSnapshots(first, second)).toThrow('game vanished')
    second.games = copy(first.games)
    second.games[0]!.rows.push(copy(second.games[0]!.rows[0]!))
    expect(() => reconcileSeasonStatSnapshots(first, second)).toThrow('Duplicate player')
  })
})
