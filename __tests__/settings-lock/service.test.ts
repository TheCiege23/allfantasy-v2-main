import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The settings lock against a fake store: League.settings + season, league-chat poll messages, and
 * whether the season is under way (a started draft). The vote is decided by the poll's real votes.
 */

const m = vi.hoisted(() => ({
  league: { settings: {} as Record<string, unknown>, season: 2026 as number | null },
  messages: {} as Record<string, { metadata: Record<string, unknown> }>,
  draftStarted: false,
  audit: vi.fn(),
  postPoll: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const prisma: Record<string, unknown> = {
    league: {
      findUnique: vi.fn(async () => ({ settings: structuredClone(m.league.settings), season: m.league.season })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
        m.league.settings = structuredClone(data.settings)
        return {}
      }),
    },
    leagueChatMessage: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => m.messages[where.id] ?? null) },
    draftSession: { findFirst: vi.fn(async () => (m.draftStarted ? { id: 'd' } : null)) },
    redraftSeason: { findFirst: vi.fn(async () => null) },
    leagueAuditLog: { create: m.audit },
    $queryRaw: vi.fn(async () => []),
  }
  let chain: Promise<unknown> = Promise.resolve()
  prisma.$transaction = vi.fn((fn: (t: unknown) => Promise<unknown>) => {
    const run = chain.then(() => fn(prisma))
    chain = run.catch(() => undefined)
    return run
  })
  return { prisma }
})
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: m.postPoll }))

import { currentSettingsLock, lockedGroups, lockedGroupsForPatch, readLockView, setLockedGroups, startUnlockVote } from '@/lib/league/settingsLockService'
import { UNLOCK_WINDOW_MS } from '@/lib/league/settingsLock'

const T0 = new Date('2026-10-20T12:00:00Z')
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000)

/** Cast votes on the stored poll the way league chat stores them. */
function castVotes(messageId: string, yes: number, no: number) {
  const poll = m.messages[messageId].metadata.poll as { options: Array<{ id: string; votes: string[] }> }
  poll.options.find((o) => o.id === 'yes')!.votes = Array.from({ length: yes }, (_, i) => `y${i}`)
  poll.options.find((o) => o.id === 'no')!.votes = Array.from({ length: no }, (_, i) => `n${i}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.league = { settings: { keep: 'me' }, season: 2026 }
  m.messages = {}
  m.draftStarted = false
  m.audit.mockResolvedValue({})
  m.postPoll.mockImplementation(async (_l: string, _u: string, _text: string, opts: { idempotencyKey: string; metadata: Record<string, unknown> }) => {
    m.messages[opts.idempotencyKey] = { metadata: structuredClone(opts.metadata) }
    return { id: opts.idempotencyKey }
  })
})

describe('locking', () => {
  it('locks groups for the season; before the draft the commissioner can unlock by hand', async () => {
    expect(await setLockedGroups('L', 'comm', ['scoring', 'trades'], T0)).toEqual({ ok: true, groups: ['scoring', 'trades'] })
    expect(m.league.settings.keep).toBe('me')
    expect(await lockedGroups('L', ['scoring', 'waivers'], T0)).toEqual(['scoring'])
    expect(await setLockedGroups('L', 'comm', ['trades'], T0)).toEqual({ ok: true, groups: ['trades'] })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'settings_lock_changed' }) }))
  })

  it('🛑 once the season is under way, unlocking by hand is refused — adding is still fine', async () => {
    await setLockedGroups('L', 'comm', ['scoring'], T0)
    m.draftStarted = true
    expect(await setLockedGroups('L', 'comm', [], T0)).toEqual({ ok: false, error: 'vote_required', groups: ['scoring'] })
    expect(await lockedGroups('L', ['scoring'], T0)).toEqual(['scoring'])
    expect(await setLockedGroups('L', 'comm', ['scoring', 'waivers'], T0)).toEqual({ ok: true, groups: ['scoring', 'waivers'] })
  })

  it('a lock from last season is no lock', async () => {
    await setLockedGroups('L', 'comm', ['scoring'], T0)
    m.league.season = 2027
    expect(await lockedGroups('L', ['scoring'], T0)).toEqual([])
    expect((await readLockView('L', T0))?.groups.find((g) => g.group === 'scoring')?.locked).toBe(false)
  })
})

describe('the unlock vote', () => {
  beforeEach(async () => {
    await setLockedGroups('L', 'comm', ['scoring'], T0)
    m.draftStarted = true
  })

  it('posts a yes/no poll to league chat that closes after the chosen days', async () => {
    const r = await startUnlockVote('L', 'comm', { group: 'scoring', days: 3, reason: 'Stat provider changed' }, T0)
    expect(r.ok).toBe(true)
    const [leagueId, userId, text, opts] = m.postPoll.mock.calls[0]
    expect([leagueId, userId]).toEqual(['L', 'comm'])
    expect(text).toContain('Unlock scoring settings?')
    expect(text).toContain('Stat provider changed')
    expect(opts.type).toBe('poll')
    expect(opts.metadata.poll.options.map((o: { id: string }) => o.id)).toEqual(['yes', 'no'])
    expect(opts.metadata.poll.closeAt).toBe(hours(72).toISOString())
  })

  it('refuses an area that is not locked, a second open vote, and odd vote lengths', async () => {
    expect(await startUnlockVote('L', 'comm', { group: 'waivers' }, T0)).toEqual({ ok: false, error: 'not_locked' })
    expect(await startUnlockVote('L', 'comm', { group: 'scoring', days: 4 }, T0)).toEqual({ ok: false, error: 'bad_days' })
    await startUnlockVote('L', 'comm', { group: 'scoring' }, T0)
    expect(await startUnlockVote('L', 'comm', { group: 'scoring' }, T0)).toEqual({ ok: false, error: 'already_voting' })
  })

  it('a passed vote unlocks the area for 72 hours once the poll closes, then it locks again', async () => {
    const r = await startUnlockVote('L', 'comm', { group: 'scoring', days: 1 }, T0)
    const pollId = r.ok ? r.vote.pollMessageId! : ''
    castVotes(pollId, 5, 3)
    expect(await lockedGroups('L', ['scoring'], hours(23))).toEqual(['scoring']) // still voting
    const closed = hours(25)
    expect(await lockedGroups('L', ['scoring'], closed)).toEqual([])
    const lock = await currentSettingsLock('L', closed)
    expect(lock?.votes[0]).toMatchObject({ status: 'passed', yes: 5, no: 3 })
    expect(lock?.unlockedUntil.scoring).toBe(new Date(closed.getTime() + UNLOCK_WINDOW_MS).toISOString())
    expect(await lockedGroups('L', ['scoring'], new Date(closed.getTime() + UNLOCK_WINDOW_MS + 1000))).toEqual(['scoring'])
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'settings_unlock_vote_passed' }) }))
  })

  it('a tie, or nobody voting, keeps it locked', async () => {
    const r = await startUnlockVote('L', 'comm', { group: 'scoring', days: 1 }, T0)
    castVotes(r.ok ? r.vote.pollMessageId! : '', 2, 2)
    expect(await lockedGroups('L', ['scoring'], hours(25))).toEqual(['scoring'])
    expect((await currentSettingsLock('L', hours(25)))?.votes[0].status).toBe('failed')
  })

  it('a vote whose poll message is gone fails at its deadline', async () => {
    const r = await startUnlockVote('L', 'comm', { group: 'scoring', days: 1 }, T0)
    delete m.messages[r.ok ? r.vote.pollMessageId! : '']
    expect((await currentSettingsLock('L', hours(12)))?.votes[0].status).toBe('voting')
    expect((await currentSettingsLock('L', hours(25)))?.votes[0].status).toBe('failed')
  })
})

describe('lockedGroupsForPatch', () => {
  it('refuses only values that actually change in a locked area', async () => {
    await setLockedGroups('L', 'comm', ['trades', 'scoring'], T0)
    const league = { tradeReviewHours: 24, medianGame: false, timezone: 'UTC', settings: { scoring_rules: { pass_td: 4 } }, leagueSettings: { rounds: 15 } }
    expect(await lockedGroupsForPatch('L', league, { leagueId: 'L', tradeReviewHours: 24, medianGame: false, timezone: 'UTC' }, T0)).toEqual([])
    expect(await lockedGroupsForPatch('L', league, { leagueId: 'L', timezone: 'America/Chicago' }, T0)).toEqual([])
    expect(await lockedGroupsForPatch('L', league, { leagueId: 'L', tradeReviewHours: 48 }, T0)).toEqual(['trades'])
    expect(await lockedGroupsForPatch('L', league, { leagueId: 'L', settingsMerge: { scoring_rules: { pass_td: 6 } } }, T0)).toEqual(['scoring'])
    expect(await lockedGroupsForPatch('L', league, { leagueId: 'L', waiverBudget: 500 }, T0)).toEqual([])
  })
})
