// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cross-feature (exile-scroll x share-cards): the out / played-idol share moments are captured only
 * once the Tribal Council read is COMPLETE (survivorRevealGate), never when the read merely opens.
 */
const m = vi.hoisted(() => ({
  afterCouncilRevealed: vi.fn(),
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn(), updateMany: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    survivorAuditEntry: { create: vi.fn(), findMany: vi.fn(async () => []), findFirst: vi.fn() },
    survivorNotification: { create: vi.fn() },
    survivorChatChannel: { findFirst: vi.fn() }, survivorChatMessage: { create: vi.fn() },
    survivorPlayer: { findMany: vi.fn(async () => []) },
    platformNotification: { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }))
vi.mock('@/lib/survivor/survivorShotInTheDark', () => ({ getCouncilShots: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: vi.fn() }))
vi.mock('@/lib/survivor/shareCards/hooks', () => ({ afterCouncilRevealed: m.afterCouncilRevealed }))
import { publishCouncilVerdictIfComplete, revealCouncil } from '@/lib/survivor/survivorVoteTallyService'

const ballots = [
  { order: 0, targetUserId: 'u-out', targetName: 'Out Manager', status: 'counts', isExtraVote: false },
  { order: 1, targetUserId: 'u-other', targetName: 'Other Manager', status: 'counts', isExtraVote: false },
  { order: 2, targetUserId: 'u-out', targetName: 'Out Manager', status: 'counts', isExtraVote: false },
]
let council: Record<string, unknown>
let verdictPosted: boolean

beforeEach(() => {
  vi.clearAllMocks()
  verdictPosted = false
  council = { id: 'c1', leagueId: 'l1', configId: 'cfg', councilNumber: 1, week: 6, phase: 'pre_merge', status: 'closed', isRevealed: false, revealStartsAt: null, revealStep: 0,
    revealSequence: ballots, isTie: false, tiePhase: null, tiePlayerIds: [], eliminatedName: 'Out Manager', eliminatedUserId: 'u-out', attendingTribeId: 't1' }
  m.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m.db))
  m.db.survivorTribalCouncil.findFirst.mockImplementation(async () => council)
  m.db.survivorTribalCouncil.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(council, data))
  m.db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: null })
  m.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'chat' })
  m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'dramatic_sequential' })
  m.db.survivorAuditEntry.findFirst.mockImplementation(async () => verdictPosted ? { id: 'marker' } : null)
  m.db.survivorAuditEntry.create.mockImplementation(async ({ data }: { data: { action: string } }) => { if (data.action === 'council_verdict_published') verdictPosted = true })
})

describe('share moments wait for the end of the read', () => {
  it('opening a one-at-a-time read captures nothing; the last ballot captures once', async () => {
    await revealCouncil('l1', 'c1', 'host')
    expect(m.afterCouncilRevealed).not.toHaveBeenCalled()
    const start = (council.revealStartsAt as Date).getTime()
    await publishCouncilVerdictIfComplete('l1', 'c1', new Date(start + 2500))
    expect(m.afterCouncilRevealed).not.toHaveBeenCalled()
    await publishCouncilVerdictIfComplete('l1', 'c1', new Date(start + 5000))
    expect(m.afterCouncilRevealed).toHaveBeenCalledTimes(1)
    expect(m.afterCouncilRevealed).toHaveBeenCalledWith('l1', 'c1')
    await publishCouncilVerdictIfComplete('l1', 'c1', new Date(start + 9000))
    expect(m.afterCouncilRevealed).toHaveBeenCalledTimes(1)
  })

  it('all-at-once completes with the opening, so it captures then', async () => {
    m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'simultaneous' })
    await revealCouncil('l1', 'c1', 'host')
    expect(m.afterCouncilRevealed).toHaveBeenCalledTimes(1)
  })

  it('commissioner pacing captures only after the host releases the last ballot', async () => {
    m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'commissioner' })
    await revealCouncil('l1', 'c1', 'host')
    await publishCouncilVerdictIfComplete('l1', 'c1', new Date(Date.now() + 86_400_000))
    expect(m.afterCouncilRevealed).not.toHaveBeenCalled()
    council.revealStep = 3
    await publishCouncilVerdictIfComplete('l1', 'c1')
    expect(m.afterCouncilRevealed).toHaveBeenCalledTimes(1)
  })
})
