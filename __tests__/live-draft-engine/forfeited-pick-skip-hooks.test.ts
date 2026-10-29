/** The forfeit skip runs after every successful pick and when a draft starts — never after its own skip. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  skip: vi.fn(async () => 0),
  lockValue: { success: true } as { success: boolean },
}))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: vi.fn(async () => null) } } }))
vi.mock('@/lib/tournament/seasonDraftRefresh', () => ({ prepareSeasonDraftPool: vi.fn(async () => null) }))
vi.mock('@/lib/draft/draftLock', () => ({ withPickLock: vi.fn(async () => ({ acquired: true, value: m.lockValue })) }))
vi.mock('@/lib/live-draft-engine/forfeitedPickSkips', () => ({ skipForfeitedPicksOnClock: m.skip }))

import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'

beforeEach(() => {
  vi.clearAllMocks()
  m.lockValue = { success: true }
})

describe('submitPick → forfeit skip', () => {
  it('after a successful pick, the next forfeited picks are skipped', async () => {
    await submitPick({ leagueId: 'L', playerName: 'X', position: 'RB' })
    expect(m.skip).toHaveBeenCalledWith('L', submitPick)
  })

  it('not after the forfeit skip itself (the helper loops on its own)', async () => {
    await submitPick({ leagueId: 'L', playerName: '(Forfeited)', position: 'SKIP', source: 'commissioner', pickMetadata: { forfeited: true } })
    expect(m.skip).not.toHaveBeenCalled()
  })

  it('not after a pick that failed', async () => {
    m.lockValue = { success: false }
    await submitPick({ leagueId: 'L', playerName: 'X', position: 'RB' })
    expect(m.skip).not.toHaveBeenCalled()
  })
})
