import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The draft is what gives a zombie league its season, so post-draft artifacts is where the league
 * starts. A failure there must not cost the rest of the post-draft work.
 */

const m = vi.hoisted(() => ({
  finalizeRosterAssignments: vi.fn(),
  sync: vi.fn(),
  ensureGuillotineSeason: vi.fn(),
  activate: vi.fn(),
  rankings: vi.fn(),
}))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({ finalizeRosterAssignments: m.finalizeRosterAssignments }))
vi.mock('@/lib/redraft/finalizeDraftToRedraftSeason', () => ({ syncCompletedDraftToRedraftSeason: m.sync }))
vi.mock('@/lib/guillotine/ensureGuillotineSeason', () => ({ ensureGuillotineSeason: m.ensureGuillotineSeason }))
vi.mock('@/lib/zombie/activateNativeZombieLeague', () => ({ ensureZombieSeasonActivated: m.activate }))
vi.mock('@/lib/post-draft-manager-ranking', () => ({ computeAndPersistDraftRankings: m.rankings }))

import { runPostDraftFinalizationArtifacts } from '@/lib/live-draft-engine/postDraftFinalizeArtifacts'

beforeEach(() => {
  vi.clearAllMocks()
  m.finalizeRosterAssignments.mockResolvedValue({})
  m.sync.mockResolvedValue({ skipped: false, seasonId: 's1', redraftRostersCreated: 8, redraftPlayersCreated: 128, redraftPlayersAlreadyPresent: 0, skippedPicks: 0 })
  m.ensureGuillotineSeason.mockResolvedValue({ ok: false, reason: 'NOT_GUILLOTINE' })
  m.activate.mockResolvedValue({ ok: false, reason: 'NOT_ZOMBIE' })
  m.rankings.mockResolvedValue(undefined)
})

describe('runPostDraftFinalizationArtifacts — zombie', () => {
  it('starts the zombie league on the season the draft just created', async () => {
    await runPostDraftFinalizationArtifacts('L1')
    expect(m.activate).toHaveBeenCalledWith({ leagueId: 'L1', redraftSeasonId: 's1' })
  })

  it('a failed activation does not cost the rest of the post-draft work', async () => {
    m.activate.mockRejectedValue(new Error('db blip'))
    await runPostDraftFinalizationArtifacts('L1')
    expect(m.rankings).toHaveBeenCalledWith('L1')
  })

  it('does not try when the draft produced no season', async () => {
    m.sync.mockResolvedValue({ skipped: true, reason: 'draft_not_completed' })
    await runPostDraftFinalizationArtifacts('L1')
    expect(m.activate).not.toHaveBeenCalled()
  })
})
