import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  survivor: vi.fn(), finalize: vi.fn(), sync: vi.fn(), rankings: vi.fn(), currentDraft: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn().mockResolvedValue(null) }, draftSession: { findFirst: m.currentDraft } } }))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({ finalizeRosterAssignments: m.finalize }))
vi.mock('@/lib/redraft/finalizeDraftToRedraftSeason', () => ({ syncCompletedDraftToRedraftSeason: m.sync }))
vi.mock('@/lib/survivor/SurvivorDraftBootstrapService', () => ({ runSurvivorPostDraftBootstrap: m.survivor }))
vi.mock('@/lib/post-draft-manager-ranking', () => ({ computeAndPersistDraftRankings: m.rankings }))

import { runPostDraftFinalizationArtifacts, syncPostDraftArtifactsIfCompletedThrottled } from '@/lib/live-draft-engine/postDraftFinalizeArtifacts'

describe('Survivor completion handoff and repair', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.restoreAllMocks()
    const cache = (globalThis as typeof globalThis & { __afPostDraftArtifactOkAt?: Map<string, number> }).__afPostDraftArtifactOkAt
    cache?.delete('survivor-handoff')
    m.currentDraft.mockResolvedValue({ status: 'completed' })
    m.sync.mockResolvedValue({ skipped: true })
    m.survivor.mockResolvedValue({ isSurvivor: true, setupComplete: true, warnings: [] })
  })

  it('does not finish the artifact handoff while Survivor initialization is still pending', async () => {
    let release!: (value: unknown) => void
    m.survivor.mockReturnValue(new Promise((resolve) => { release = resolve }))
    let completed = false
    const pending = runPostDraftFinalizationArtifacts('survivor-handoff').then(() => { completed = true })
    await vi.waitFor(() => expect(m.survivor).toHaveBeenCalled())
    expect(completed).toBe(false)
    expect(m.finalize).toHaveBeenCalledWith('survivor-handoff')
    expect(m.survivor).toHaveBeenCalledWith('survivor-handoff', { canonicalOnly: true })
    release({ isSurvivor: true, setupComplete: true, warnings: [] })
    await pending
    expect(completed).toBe(true)
    expect(m.rankings).toHaveBeenCalledWith('survivor-handoff')
  })

  it('retries a failed setup on the next completed-draft poll, then throttles successful repeats', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.survivor.mockRejectedValueOnce(new Error('transaction rolled back'))
    await syncPostDraftArtifactsIfCompletedThrottled('survivor-handoff')
    await syncPostDraftArtifactsIfCompletedThrottled('survivor-handoff')
    expect(m.survivor).toHaveBeenCalledTimes(2)
    expect(m.rankings).toHaveBeenCalledTimes(1)
    await syncPostDraftArtifactsIfCompletedThrottled('survivor-handoff')
    expect(m.survivor).toHaveBeenCalledTimes(2)
  })

  it('reports rule/ownership blockers while allowing the other draft artifacts to finish', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.survivor.mockResolvedValue({ isSurvivor: true, setupComplete: false, warnings: ['Claim the remaining team.'] })
    await runPostDraftFinalizationArtifacts('survivor-handoff')
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ warnings: ['Claim the remaining team.'] }))
    expect(m.rankings).toHaveBeenCalledWith('survivor-handoff')
  })
})
