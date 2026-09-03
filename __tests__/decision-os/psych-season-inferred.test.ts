import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { findUnique, update, create, deleteMany, createMany, aggregate, writeSnapshot, summarize } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  aggregate: vi.fn(),
  writeSnapshot: vi.fn(),
  summarize: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    managerPsychProfile: { findUnique, update, create },
    profileEvidenceRecord: { deleteMany, createMany },
  },
}))
vi.mock('@/lib/psychological-profiles/BehaviorSignalAggregator', () => ({ aggregateBehaviorSignals: aggregate }))
vi.mock('@/lib/psychological-profiles/ProfileLabelResolver', () => ({
  resolveProfileLabels: () => ['win-now'],
  resolveScores: () => ({ aggressionScore: 70, activityScore: null, tradeFrequencyScore: null, waiverFocusScore: null, riskToleranceScore: null }),
}))
vi.mock('@/lib/psychological-profiles/ProfileEvidenceBuilder', () => ({ buildEvidenceFromSignals: () => [] }))
vi.mock('@/lib/psychological-profiles/ProfileSeasonSnapshot', () => ({ writeProfileSeasonSnapshot: writeSnapshot }))
vi.mock('@/lib/psychological-profiles/ProfileEvidenceFloor', () => ({ summarizeEvidence: summarize }))

import { runPsychologicalProfileEngine } from '@/lib/psychological-profiles/PsychologicalProfileEngine'

/**
 * ── 🛑 R4b.2 — A GUARD IS ONLY AS STRONG AS THE NARROWEST CALLER THAT REACHES IT ────────────
 *
 * The engine has always refused to snapshot without a season, and the refusal has always been
 * correct. It was also STRUCTURALLY UNREACHABLE: `ProfileRefreshService` computes
 * `input.season ?? league?.season ?? new Date().getFullYear()`, so `season` was never null by the
 * time it arrived and `season != null` refused nothing, ever.
 *
 * A league with no recorded season therefore had its cumulative history filed under whatever year
 * the cron happened to fire — and for a dynasty league that corrupts the very trajectory the
 * snapshot table exists to hold.
 */
describe('R4b.2 — an INVENTED season must not be snapshotted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aggregate.mockResolvedValue({})
    summarize.mockReturnValue({ anySufficient: true, overallConfidence: 'high' })
    findUnique.mockResolvedValue({ id: 'p1', evidence: [] })
    update.mockResolvedValue({ id: 'p1' })
    deleteMany.mockResolvedValue({ count: 0 })
    writeSnapshot.mockResolvedValue(true)
  })

  it('🛑 seasonInferred:true writes NO snapshot, even though a season is present', async () => {
    await runPsychologicalProfileEngine({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: 2026, seasonInferred: true,
    })
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('a REAL season still snapshots — the fix must not refuse everything', async () => {
    // Guards against over-correcting: the failure mode of a fix like this is silently disabling
    // the feature it was meant to make honest.
    await runPsychologicalProfileEngine({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: 2026, seasonInferred: false,
    })
    expect(writeSnapshot).toHaveBeenCalledTimes(1)
    expect(writeSnapshot.mock.calls[0][0].season).toBe(2026)
  })

  it('an ABSENT flag behaves as before — not inferred', async () => {
    // Every existing caller omits it; omission must keep the old behaviour rather than silently
    // switching snapshots off across the codebase.
    await runPsychologicalProfileEngine({ leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: 2026 })
    expect(writeSnapshot).toHaveBeenCalledTimes(1)
  })

  it('a null season still writes nothing, as it always did', async () => {
    await runPsychologicalProfileEngine({ leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: null })
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('⚠ AGGREGATION STILL RECEIVES THE SEASON WHEN IT IS INFERRED — signals are unchanged', async () => {
    // This is the test that proves the fix is surgical. `seasonThrough()` filters `season <= n`,
    // and a dynasty league carries FUTURE draft picks — 2027s and 2028s are routine. Passing null
    // to the aggregator would drop that filter and newly count them, silently changing every
    // signal. Only the SNAPSHOT decision may change.
    await runPsychologicalProfileEngine({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: 2026, seasonInferred: true,
    })
    expect(aggregate).toHaveBeenCalledTimes(1)
    expect(aggregate.mock.calls[0][3]).toMatchObject({ season: 2026 })
  })
})
