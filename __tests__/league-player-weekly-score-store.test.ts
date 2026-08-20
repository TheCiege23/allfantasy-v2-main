import { describe, expect, it, vi } from 'vitest'
import {
  buildLeaguePlayerWeeklyScoreCandidate,
  buildLeaguePlayerWeeklyScoreCandidates,
  persistLeaguePlayerWeeklyScoreCandidates,
  toLeaguePlayerWeeklyScoreKey,
} from '@/lib/scoring/league-player-weekly-score-store'
import { resolveWeeklyScoreReadDecision } from '@/lib/scoring/weekly-score-read-precedence'

describe('league-player-weekly-score-store', () => {
  it('builds candidate row shape with defaults', () => {
    const row = buildLeaguePlayerWeeklyScoreCandidate({
      leagueId: 'L1',
      playerId: 'P1',
      season: 2026,
      week: 3,
      sport: 'NFL',
      fantasyPts: 18.126,
    })
    expect(row).toEqual({
      leagueId: 'L1',
      playerId: 'P1',
      season: 2026,
      week: 3,
      sport: 'NFL',
      fantasyPts: 18.13,
      stats: null,
      isFinalized: false,
      source: 'rollup_pgs',
      lineageJobName: null,
      rollupVersion: null,
      scoringProfileId: null,
      scoringRulesHash: null,
    })
  })

  it('uses composite unique key assumptions', () => {
    const a = toLeaguePlayerWeeklyScoreKey({
      leagueId: 'L1',
      playerId: 'P1',
      season: 2026,
      week: 3,
      sport: 'NFL',
    })
    const b = toLeaguePlayerWeeklyScoreKey({
      leagueId: 'L1',
      playerId: 'P1',
      season: 2026,
      week: 4,
      sport: 'NFL',
    })
    expect(a).not.toEqual(b)
  })

  it('deduplicates candidate inputs by composite key', () => {
    const built = buildLeaguePlayerWeeklyScoreCandidates([
      { leagueId: 'L1', playerId: 'P1', season: 2026, week: 3, sport: 'NFL', fantasyPts: 11.1 },
      { leagueId: 'L1', playerId: 'P1', season: 2026, week: 3, sport: 'NFL', fantasyPts: 12.2 },
      { leagueId: 'L1', playerId: 'P2', season: 2026, week: 3, sport: 'NFL', fantasyPts: 9.5 },
    ])
    expect(built.uniqueKeyCount).toBe(2)
    expect(built.duplicateInputCount).toBe(1)
    expect(built.candidates).toHaveLength(2)
  })

  it('dry-run never writes and does not require allowShadowWrite', async () => {
    const adapter = { upsertMany: vi.fn(async () => ({ wroteRows: 99, writtenCreate: 99, writtenUpdate: 0, skipped: 0 })) }
    const res = await persistLeaguePlayerWeeklyScoreCandidates({
      candidates: [
        buildLeaguePlayerWeeklyScoreCandidate({
          leagueId: 'L1',
          playerId: 'P1',
          season: 2026,
          week: 3,
          sport: 'NFL',
          fantasyPts: 15,
        }),
      ],
      write: false,
      adapter,
    })
    expect(res.writeApplied).toBe(false)
    expect(res.wouldUpsert).toBe(1)
    expect(res.wroteRows).toBe(0)
    expect(adapter.upsertMany).not.toHaveBeenCalled()
  })

  it('write is disabled by default unless allowShadowWrite is true', async () => {
    const adapter = { upsertMany: vi.fn(async () => ({ wroteRows: 1, writtenCreate: 1, writtenUpdate: 0, skipped: 0 })) }
    const res = await persistLeaguePlayerWeeklyScoreCandidates({
      candidates: [
        buildLeaguePlayerWeeklyScoreCandidate({
          leagueId: 'L1',
          playerId: 'P1',
          season: 2026,
          week: 3,
          sport: 'NFL',
          fantasyPts: 15,
        }),
      ],
      write: true,
      adapter,
    })
    expect(res.writeApplied).toBe(false)
    expect(res.notes).toContain('write_blocked_allowShadowWrite_required')
    expect(adapter.upsertMany).not.toHaveBeenCalled()
  })

  it('write proceeds only with allowShadowWrite + adapter', async () => {
    const adapter = { upsertMany: vi.fn(async () => ({ wroteRows: 1, writtenCreate: 1, writtenUpdate: 0, skipped: 0 })) }
    const res = await persistLeaguePlayerWeeklyScoreCandidates({
      candidates: [
        buildLeaguePlayerWeeklyScoreCandidate({
          leagueId: 'L1',
          playerId: 'P1',
          season: 2026,
          week: 3,
          sport: 'NFL',
          fantasyPts: 15,
        }),
      ],
      write: true,
      allowShadowWrite: true,
      adapter,
    })
    expect(res.writeApplied).toBe(true)
    expect(res.wroteRows).toBe(1)
    expect(res.writtenCreate).toBe(1)
    expect(res.writtenUpdate).toBe(0)
    expect(res.skipped).toBe(0)
    expect(adapter.upsertMany).toHaveBeenCalledTimes(1)
  })

  it('emits duplicate key and missing hash telemetry signals', async () => {
    const telemetry = vi.fn()
    await persistLeaguePlayerWeeklyScoreCandidates({
      candidates: [
        buildLeaguePlayerWeeklyScoreCandidate({
          leagueId: 'L1',
          playerId: 'P1',
          season: 2026,
          week: 3,
          sport: 'NFL',
          fantasyPts: 10,
        }),
        buildLeaguePlayerWeeklyScoreCandidate({
          leagueId: 'L1',
          playerId: 'P1',
          season: 2026,
          week: 3,
          sport: 'NFL',
          fantasyPts: 11,
        }),
      ],
      write: false,
      telemetry,
      leagueId: 'L1',
      season: 2026,
      week: 3,
      jobName: 'test-job',
    })
    expect(telemetry).toHaveBeenCalledWith(
      'duplicate_candidate_keys',
      expect.objectContaining({
        jobName: 'test-job',
        duplicateInputCount: 1,
      }),
    )
    expect(telemetry).toHaveBeenCalledWith(
      'scoring_rules_hash_missing',
      expect.objectContaining({
        jobName: 'test-job',
        scoringRulesHashMissingCount: 2,
      }),
    )
  })

  it('returns write result counts from adapter', async () => {
    const adapter = { upsertMany: vi.fn(async () => ({ wroteRows: 2, writtenCreate: 1, writtenUpdate: 1, skipped: 3 })) }
    const res = await persistLeaguePlayerWeeklyScoreCandidates({
      candidates: [
        buildLeaguePlayerWeeklyScoreCandidate({
          leagueId: 'L1',
          playerId: 'P1',
          season: 2026,
          week: 3,
          sport: 'NFL',
          fantasyPts: 15,
          scoringRulesHash: 'abc',
        }),
      ],
      write: true,
      allowShadowWrite: true,
      adapter,
    })
    expect(res.wroteRows).toBe(2)
    expect(res.writtenCreate).toBe(1)
    expect(res.writtenUpdate).toBe(1)
    expect(res.skipped).toBe(3)
  })
})

describe('weekly score read precedence contract', () => {
  it('prefers league-scoped when present', () => {
    expect(
      resolveWeeklyScoreReadDecision({
        hasLeagueScopedScore: true,
        hasGlobalScore: true,
        leagueScopedRequired: false,
        allowGlobalFallback: true,
        allowComputeFallback: true,
      }),
    ).toEqual({ source: 'league_scoped', reason: 'league_scoped_row_present' })
  })

  it('does not fallback to global when league-scoped is required', () => {
    const telemetry = vi.fn()
    expect(
      resolveWeeklyScoreReadDecision({
        hasLeagueScopedScore: false,
        hasGlobalScore: true,
        leagueScopedRequired: true,
        allowGlobalFallback: true,
        allowComputeFallback: false,
        telemetry,
      }),
    ).toEqual({ source: 'none', reason: 'league_scoped_required_no_fallback' })
    expect(telemetry).toHaveBeenCalledWith(
      'global_fallback_prevented',
      expect.objectContaining({ hasGlobalScore: true }),
    )
  })

  it('allows compute fallback only when explicitly requested', () => {
    expect(
      resolveWeeklyScoreReadDecision({
        hasLeagueScopedScore: false,
        hasGlobalScore: false,
        leagueScopedRequired: false,
        allowGlobalFallback: false,
        allowComputeFallback: true,
      }),
    ).toEqual({ source: 'compute', reason: 'compute_requested' })
  })
})

