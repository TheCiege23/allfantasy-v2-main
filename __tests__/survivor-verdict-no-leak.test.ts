// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Nothing names a ballot or the voted-out manager before the last step of the read:
 * not league chat, not notifications, not the elimination, not Chimmy's context.
 */
const m = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn(), updateMany: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    survivorAuditEntry: { create: vi.fn(), findMany: vi.fn(async () => []), findFirst: vi.fn() },
    survivorNotification: { create: vi.fn() },
    survivorChatChannel: { findFirst: vi.fn() }, survivorChatMessage: { create: vi.fn() },
    survivorPlayer: { findMany: vi.fn(async () => []), findUnique: vi.fn() },
    platformNotification: { create: vi.fn() },
    roster: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    leagueTeam: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }))
vi.mock('@/lib/survivor/survivorShotInTheDark', () => ({ getCouncilShots: vi.fn(async () => []) }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: vi.fn() }))
import { publishCouncilVerdictIfComplete, revealCouncil } from '@/lib/survivor/survivorVoteTallyService'

const ballots = [
  { order: 0, targetUserId: 'u-out', targetName: 'Out Manager', status: 'counts', isExtraVote: false },
  { order: 1, targetUserId: 'u-other', targetName: 'Other Manager', status: 'counts', isExtraVote: false },
  { order: 2, targetUserId: 'u-out', targetName: 'Out Manager', status: 'counts', isExtraVote: false },
]
let council: Record<string, unknown>
let verdictPosted: boolean
const everythingPublished = () => JSON.stringify([
  m.db.survivorChatMessage.create.mock.calls, m.db.survivorNotification.create.mock.calls,
  m.db.platformNotification.create.mock.calls, m.db.survivorAuditEntry.create.mock.calls.filter(([c]) => c.data.isVisibleToPublic),
  m.db.survivorTribalCouncil.create.mock.calls,
])

beforeEach(() => {
  vi.clearAllMocks()
  verdictPosted = false
  council = { id: 'c1', leagueId: 'l1', configId: 'cfg', councilNumber: 1, week: 6, phase: 'pre_merge', status: 'closed', isRevealed: false, revealStartsAt: null, revealStep: 0,
    revealSequence: ballots, isTie: false, tiePhase: null, tiePlayerIds: [], eliminatedName: 'Out Manager', eliminatedUserId: 'u-out', attendingTribeId: 't1' }
  m.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m.db))
  m.db.survivorTribalCouncil.findFirst.mockImplementation(async () => council)
  m.db.survivorTribalCouncil.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(council, data))
  m.db.survivorTribalCouncil.create.mockResolvedValue({ id: 'revote' })
  m.db.survivorTribalCouncil.aggregate.mockResolvedValue({ _max: { councilNumber: 1 } })
  m.db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: null })
  m.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'chat' })
  m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'dramatic_sequential' })
  m.db.survivorAuditEntry.findFirst.mockImplementation(async () => verdictPosted ? { id: 'marker' } : null)
  m.db.survivorAuditEntry.create.mockImplementation(async ({ data }: { data: { action: string } }) => { if (data.action === 'council_verdict_published') verdictPosted = true })
})

describe('league chat follows the scroll', () => {
  it('opening a one-at-a-time read publishes no ballot and no verdict anywhere', async () => {
    expect(await revealCouncil('l1', 'c1', 'host')).toMatchObject({ ok: true, alreadyRevealed: false })
    expect(m.db.survivorChatMessage.create).toHaveBeenCalledOnce()
    expect(everythingPublished()).not.toMatch(/Out Manager|Other Manager|u-out|Ballot|voted off/)
  })

  it('a tie opens no revote (and says nothing) until the read is complete', async () => {
    Object.assign(council, { isTie: true, tiePhase: 'revote_required', tiePlayerIds: ['u-out', 'u-other'], eliminatedName: null, eliminatedUserId: null })
    await revealCouncil('l1', 'c1', 'host')
    expect(m.db.survivorTribalCouncil.create).not.toHaveBeenCalled()
    expect(everythingPublished()).not.toMatch(/tied|revote/i)
  })

  it('a tied council in a double-elimination week opens its revote with the week\'s next free number', async () => {
    // Council 1 of the week tied; council 2 already holds number 2. councilNumber + 1 would collide.
    Object.assign(council, { isTie: true, tiePhase: 'revote_required', tiePlayerIds: ['u-out', 'u-other'], eliminatedName: null, eliminatedUserId: null })
    m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'simultaneous' })
    m.db.survivorTribalCouncil.aggregate.mockResolvedValue({ _max: { councilNumber: 2 } })
    await revealCouncil('l1', 'c1', 'host')
    expect(m.db.survivorTribalCouncil.aggregate).toHaveBeenCalledWith({ where: { configId: 'cfg', week: 6 }, _max: { councilNumber: true } })
    expect(m.db.survivorTribalCouncil.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phase: 'revote', week: 6, councilNumber: 3 }) }))
  })

  it('the verdict goes out once the last ballot is released, exactly once', async () => {
    await revealCouncil('l1', 'c1', 'host')
    const start = (council.revealStartsAt as Date).getTime()
    expect(await publishCouncilVerdictIfComplete('l1', 'c1', new Date(start + 2500))).toEqual({ ok: true, complete: false })
    expect(everythingPublished()).not.toMatch(/Out Manager|Ballot/)
    expect(await publishCouncilVerdictIfComplete('l1', 'c1', new Date(start + 5000))).toMatchObject({ ok: true, complete: true, published: true })
    expect(m.db.survivorChatMessage.create.mock.calls[1][0].data.content).toContain('Ballot 3: Out Manager.')
    expect(m.db.survivorChatMessage.create.mock.calls[1][0].data.content).toContain('Out Manager has been voted off the main island.')
    expect(await publishCouncilVerdictIfComplete('l1', 'c1', new Date(start + 9000))).toMatchObject({ complete: true, published: false })
    expect(m.db.survivorChatMessage.create).toHaveBeenCalledTimes(2)
  })

  it('the one Torch Ceremony message carries the week recap card; the opening never does', async () => {
    m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'simultaneous', settings: {} })
    await revealCouncil('l1', 'c1', 'host')
    const [opening, verdict] = m.db.survivorChatMessage.create.mock.calls.map(([args]) => args.data)
    expect(opening.cardData).toBeUndefined()
    expect(verdict.contentType).toBe('host_announcement')
    expect(verdict.cardData).toEqual({ type: 'share_card', momentId: 'recap-c1', momentType: 'recap', week: 6 })
  })

  it('no recap card when the vote is tied or the league has share cards off', async () => {
    m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'simultaneous', settings: { shareCardsEnabled: false } })
    await revealCouncil('l1', 'c1', 'host')
    expect(m.db.survivorChatMessage.create.mock.calls[1][0].data.cardData).toBeUndefined()
    vi.clearAllMocks()
    verdictPosted = false
    m.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m.db))
    m.db.survivorTribalCouncil.findFirst.mockImplementation(async () => council)
    m.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'chat' })
    m.db.survivorGameState.findUnique.mockResolvedValue({ pausedSnapshot: null })
    m.db.survivorTribalCouncil.aggregate.mockResolvedValue({ _max: { councilNumber: 1 } })
    m.db.survivorTribalCouncil.create.mockResolvedValue({ id: 'revote' })
    m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'simultaneous', settings: {} })
    council = { ...council, status: 'tie_pending', isRevealed: false, revealStartsAt: null, isTie: true, tiePhase: 'revote_required', eliminatedUserId: null, eliminatedName: null }
    await revealCouncil('l1', 'c1', 'host')
    const posts = m.db.survivorChatMessage.create.mock.calls.map(([args]) => args.data)
    expect(posts.length).toBeGreaterThan(0)
    expect(posts.every(post => post.cardData === undefined)).toBe(true)
  })

  it('commissioner pacing never runs on the clock — only reveal_next completes it', async () => {
    m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'commissioner' })
    await revealCouncil('l1', 'c1', 'host')
    expect(await publishCouncilVerdictIfComplete('l1', 'c1', new Date(Date.now() + 86_400_000))).toEqual({ ok: true, complete: false })
    council.revealStep = 3
    expect(await publishCouncilVerdictIfComplete('l1', 'c1')).toMatchObject({ complete: true, published: true })
  })

  it('all at once publishes the verdict with the opening', async () => {
    m.db.league.findUnique.mockResolvedValue({ survivorRevealMode: 'simultaneous' })
    await revealCouncil('l1', 'c1', 'host')
    expect(m.db.survivorChatMessage.create).toHaveBeenCalledTimes(2)
    expect(m.db.survivorChatMessage.create.mock.calls[1][0].data.content).toContain('Out Manager has been voted off')
  })
})
