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
 * ── R4b.1 — format flows from the caller through to both the live profile row and the
 * season snapshot, and its absence must not change any existing behaviour ──────────────
 *
 * `manager_psych_profiles.format` and `manager_psych_profile_seasons.format` existed and
 * were queryable and were 100% null in production (1,749 / 97 rows respectively) because
 * nothing ever wrote them — the engine hardcoded `format: null` with a comment naming this
 * item as the thing that would fix it. This is that fix landing on the write path.
 */
describe('R4b.1 — league format is written through to the profile and its season snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aggregate.mockResolvedValue({})
    summarize.mockReturnValue({ anySufficient: true, overallConfidence: 'high' })
    update.mockResolvedValue({ id: 'p1' })
    deleteMany.mockResolvedValue({ count: 0 })
    writeSnapshot.mockResolvedValue(true)
  })

  it('an UPDATE (existing profile) writes format onto the live row', async () => {
    findUnique.mockResolvedValue({ id: 'p1', evidence: [] })
    await runPsychologicalProfileEngine({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: 2026, format: 'dynasty',
    })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0].data.format).toBe('dynasty')
  })

  it('a CREATE (new profile) writes format onto the live row', async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({ id: 'p2' })
    await runPsychologicalProfileEngine({
      leagueId: 'L1', managerId: 'm2', sport: 'NFL', season: 2026, format: 'redraft',
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].data.format).toBe('redraft')
  })

  it('format reaches the season snapshot alongside the profile row', async () => {
    findUnique.mockResolvedValue({ id: 'p1', evidence: [] })
    await runPsychologicalProfileEngine({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: 2026, format: 'guillotine',
    })
    expect(writeSnapshot).toHaveBeenCalledTimes(1)
    expect(writeSnapshot.mock.calls[0][0].format).toBe('guillotine')
  })

  it('an omitted format writes null, not undefined or a crash — unmigrated callers keep working', async () => {
    findUnique.mockResolvedValue({ id: 'p1', evidence: [] })
    await runPsychologicalProfileEngine({ leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: 2026 })
    expect(update.mock.calls[0][0].data.format).toBeNull()
    expect(writeSnapshot.mock.calls[0][0].format).toBeNull()
  })

  it('an explicit null format writes null, same as omission', async () => {
    findUnique.mockResolvedValue({ id: 'p1', evidence: [] })
    await runPsychologicalProfileEngine({
      leagueId: 'L1', managerId: 'm1', sport: 'NFL', season: 2026, format: null,
    })
    expect(update.mock.calls[0][0].data.format).toBeNull()
  })
})
