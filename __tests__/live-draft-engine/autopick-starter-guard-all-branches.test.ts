import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE STARTER GUARD PROTECTED ONLY AUTOPICK'S LAST BRANCH. The queue went first, and a team whose
 * remaining picks were exactly its open starting spots could still be handed a queued skater with no
 * goalie on the roster — an empty seat every week of a best ball season. One guard
 * (lib/live-draft-engine/autopickStarterGuard.ts) now covers the queue, "draft as me", need-based,
 * best available and the Chimmy / orphan drafter.
 */

const hm = vi.hoisted(() => ({
  draftSession: vi.fn(),
  roster: vi.fn(),
  allowed: vi.fn(),
  submitPick: vi.fn(),
  template: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn().mockResolvedValue(null) },
    draftSession: { findUnique: hm.draftSession, findFirst: hm.draftSession },
    roster: { findUnique: hm.roster },
  },
}))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', async (orig) => ({
  ...(await orig<typeof import('@/lib/live-draft-engine/RosterFitValidation')>()),
  getAllowedPositionsAndRosterSize: hm.allowed,
}))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({ submitPick: hm.submitPick }))
vi.mock('@/lib/league/league-draft-template-payload', async (orig) => ({
  ...(await orig<typeof import('@/lib/league/league-draft-template-payload')>()),
  getLeagueDraftTemplatePayload: hm.template,
}))
vi.setConfig({ testTimeout: 60000 })

import { guardCandidates, starterGuardFor } from '@/lib/live-draft-engine/autopickStarterGuard'

/** NHL best ball: C, W, D, G starters (one each), two bench spots — six rounds. */
const NHL_SLOTS = [
  { slotName: 'C', allowedPositions: ['C'], starterCount: 1 },
  { slotName: 'W', allowedPositions: ['LW', 'RW', 'W'], starterCount: 1 },
  { slotName: 'D', allowedPositions: ['D'], starterCount: 1 },
  { slotName: 'G', allowedPositions: ['G'], starterCount: 1 },
  { slotName: 'BN', allowedPositions: ['C', 'LW', 'RW', 'D', 'G'], starterCount: 0 },
]

describe('starterGuardFor', () => {
  it('does not bite while the open starting spots can still be filled later', () => {
    const g = starterGuardFor(NHL_SLOTS, ['C', 'LW'], 6) // D and G open, four picks left
    expect(g.mustFill).toBe(false)
    expect(g.allows('C')).toBe(true)
  })

  it('once the picks left only just cover the open spots, only a player who starts there is allowed', () => {
    const g = starterGuardFor(NHL_SLOTS, ['C', 'LW', 'D', 'C', 'RW'], 6) // only G open, one pick left
    expect(g.mustFill).toBe(true)
    expect(g.allows('G')).toBe(true)
    expect(g.allows('C')).toBe(false)
    expect(g.allows('D')).toBe(false)
  })

  it('no template or no rounds means no guard, exactly as before', () => {
    expect(starterGuardFor(null, ['C'], 6).mustFill).toBe(false)
    expect(starterGuardFor(NHL_SLOTS, ['C'], Number.NaN).mustFill).toBe(false)
  })

  it('guardCandidates never empties the board: a forced pick with nobody eligible still picks', () => {
    const g = starterGuardFor(NHL_SLOTS, ['C', 'LW', 'D', 'C', 'RW'], 6)
    const pool = [{ position: 'C' }, { position: 'G' }]
    expect(guardCandidates(g, pool, (p) => p.position)).toEqual([{ position: 'G' }])
    expect(guardCandidates(g, [{ position: 'C' }], (p) => p.position)).toEqual([{ position: 'C' }])
  })
})

describe('queue-first autopick obeys the starter guard', () => {
  const ownPicks = (positions: string[]) =>
    positions.map((position, i) => ({ playerName: `Mine ${i}`, position, overall: i * 2 + 1, rosterId: 'roster-1' }))
  const sessionWith = (own: string[], queue: Array<{ playerName: string; position: string }>) => ({
    status: 'in_progress',
    rounds: 6,
    picks: ownPicks(own),
    queues: [{ userId: 'user-1', order: queue.map((q) => ({ ...q, team: 'BOS', playerId: null })) }],
  })

  beforeEach(() => {
    vi.clearAllMocks()
    hm.allowed.mockResolvedValue({
      draftEligiblePositions: new Set(['C', 'LW', 'RW', 'D', 'G']),
      rosterUnionAllowedPositions: new Set(['C', 'LW', 'RW', 'D', 'G', 'BN']),
      totalRosterSize: 6,
    })
    hm.roster.mockResolvedValue({ platformUserId: 'user-1' })
    hm.submitPick.mockResolvedValue({ success: true })
    hm.template.mockResolvedValue({ template: { slots: NHL_SLOTS } })
  })

  it('skips a queued skater when the last pick must be a goalie, and takes the queued goalie', async () => {
    hm.draftSession.mockResolvedValue(
      sessionWith(['C', 'LW', 'D', 'C', 'RW'], [{ playerName: 'Star Center', position: 'C' }, { playerName: 'Backup Goalie', position: 'G' }]),
    )
    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    const result = await tryQueueAutoPick('league-1', 'roster-1')
    expect(result).toMatchObject({ success: true, playerName: 'Backup Goalie' })
    expect(hm.submitPick).toHaveBeenCalledTimes(1)
    expect(hm.submitPick).toHaveBeenCalledWith(expect.objectContaining({ playerName: 'Backup Goalie', position: 'G' }))
  })

  it('yields no queue pick when the queue holds no goalie, so guarded best available makes it', async () => {
    hm.draftSession.mockResolvedValue(sessionWith(['C', 'LW', 'D', 'C', 'RW'], [{ playerName: 'Star Center', position: 'C' }]))
    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    expect(await tryQueueAutoPick('league-1', 'roster-1')).toMatchObject({ success: false })
    expect(hm.submitPick).not.toHaveBeenCalled()
  })

  it('takes the queue in order while the starters can still be filled later', async () => {
    hm.draftSession.mockResolvedValue(sessionWith(['C', 'LW'], [{ playerName: 'Star Center', position: 'C' }, { playerName: 'Backup Goalie', position: 'G' }]))
    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    expect(await tryQueueAutoPick('league-1', 'roster-1')).toMatchObject({ success: true, playerName: 'Star Center' })
  })
})
