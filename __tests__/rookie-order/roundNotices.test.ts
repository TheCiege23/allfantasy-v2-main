/**
 * The live rookie order after each playoff round (lib/rookie-order/roundNotices.ts, roundNoticeService.ts):
 * the hourly sweep refreshes the order and tells the commissioner — and the league chat, when chosen —
 * which picks the round locked; each step of the season once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  league: { findUnique: vi.fn(), update: vi.fn() },
  userProfile: { findUnique: vi.fn() },
}))
const refresh = vi.hoisted(() => vi.fn())
const dispatch = vi.hoisted(() => vi.fn())
const chat = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/rookie-order/liveRookieOrderService', () => ({ refreshLiveRookieOrder: refresh }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: chat }))

import {
  describeRoundNotices,
  parseRoundNoticeSettings,
  readRoundNoticeSettings,
  roundNoticeChange,
  roundNoticeText,
  type LastRoundNotice,
} from '@/lib/rookie-order/roundNotices'
import { runRookieOrderRoundNotices } from '@/lib/rookie-order/roundNoticeService'

type St = 'locked' | 'provisional'
const slot = (n: number, teamId: string, status: St, group: 'non_playoff' | 'playoff' = 'playoff') => ({
  slot: n, teamId, name: teamId.toUpperCase(), group, status, finish: null, reason: '',
})
// 6 teams: 2 out of the playoffs, 4 in. Round 1 decides the two semifinal losers; the final decides the rest.
const playoffsStart = { phase: 'playoffs' as const, slots: [slot(1, 'n1', 'locked', 'non_playoff'), slot(2, 'n2', 'locked', 'non_playoff'), slot(3, 'a', 'provisional'), slot(4, 'b', 'provisional'), slot(5, 'c', 'provisional'), slot(6, 'd', 'provisional')] }
const afterSemis = { phase: 'playoffs' as const, slots: [slot(1, 'n1', 'locked'), slot(2, 'n2', 'locked'), slot(3, 'a', 'locked'), slot(4, 'b', 'locked'), slot(5, 'c', 'provisional'), slot(6, 'd', 'provisional')] }
const final = { phase: 'final' as const, slots: afterSemis.slots.map((s) => ({ ...s, status: 'locked' as St })) }

describe('when a notice fires', () => {
  it('the regular season never announces', () => {
    expect(roundNoticeChange({ leagueId: 'L', season: 2026, result: { phase: 'regular_season', slots: [slot(1, 'n1', 'locked')] }, last: null })).toBeNull()
  })

  it('each round announces only the picks it locked, then the final order, then nothing', () => {
    const first = roundNoticeChange({ leagueId: 'L', season: 2026, result: playoffsStart, last: null })!
    expect(first.newlyLocked.map((s) => s.teamId)).toEqual(['n1', 'n2'])
    expect(first).toMatchObject({ lockedCount: 2, total: 6, final: false, key: 'rookie-order-round:L:2026:2' })

    const second = roundNoticeChange({ leagueId: 'L', season: 2026, result: afterSemis, last: first.next })!
    expect(second.newlyLocked.map((s) => s.teamId)).toEqual(['a', 'b'])
    expect(second.key).toBe('rookie-order-round:L:2026:4')

    // Nothing new since: no notice.
    expect(roundNoticeChange({ leagueId: 'L', season: 2026, result: afterSemis, last: second.next })).toBeNull()

    const third = roundNoticeChange({ leagueId: 'L', season: 2026, result: final, last: second.next })!
    expect(third).toMatchObject({ final: true, lockedCount: 6, key: 'rookie-order-round:L:2026:6:final' })
    expect(third.newlyLocked.map((s) => s.teamId)).toEqual(['c', 'd'])
    expect(roundNoticeChange({ leagueId: 'L', season: 2026, result: final, last: third.next })).toBeNull()
  })

  it('a new season starts from nothing', () => {
    const last: LastRoundNotice = { season: 2025, phase: 'final', lockedTeamIds: ['n1', 'n2', 'a', 'b', 'c', 'd'], at: 'x' }
    expect(roundNoticeChange({ leagueId: 'L', season: 2026, result: playoffsStart, last })?.newlyLocked).toHaveLength(2)
  })

  it('settings: tell the commissioner by default, league chat only when chosen', () => {
    expect(readRoundNoticeSettings({})).toEqual({ notify: true, chat: false })
    expect(readRoundNoticeSettings({ rookie_draft_order: { live: { roundNotices: { notify: false, chat: true } } } })).toEqual({ notify: false, chat: true })
    expect(parseRoundNoticeSettings({ chat: true, notify: 'yes' }, { notify: false, chat: false })).toEqual({ notify: false, chat: true })
  })
})

describe('the words', () => {
  const second = roundNoticeChange({ leagueId: 'L', season: 2026, result: afterSemis, last: roundNoticeChange({ leagueId: 'L', season: 2026, result: playoffsStart, last: null })!.next })!

  it('English and Spanish name each locked pick', () => {
    expect(roundNoticeText(second, 2027, 'en')).toEqual({
      title: 'Rookie draft order updated',
      body: 'Locked: 1.03 A, 1.04 B. 4 of 6 picks are set; the rest depend on the playoffs.',
      chat: '2027 rookie draft order: 1.03 A, 1.04 B are locked in (4 of 6).',
    })
    expect(roundNoticeText(second, 2027, 'es').body).toBe('Se fijaron: 1.03 A, 1.04 B. 4 de 6 selecciones están fijadas; el resto depende de los playoffs.')
  })

  it('the final notice says the order is saved for the draft', () => {
    const f = roundNoticeChange({ leagueId: 'L', season: 2026, result: final, last: second.next })!
    expect(roundNoticeText(f, 2027, 'en').title).toBe('The 2027 rookie draft order is final')
    expect(roundNoticeText(f, 2027, 'en').body).toMatch(/All 6 picks are set and saved; the 2027 rookie draft will use this order\.$/)
    expect(roundNoticeText(f, 2027, 'es').title).toBe('El orden del draft de novatos 2027 es final')
  })

  it('a long list is cut short', () => {
    const many = { phase: 'playoffs' as const, slots: Array.from({ length: 9 }, (_, i) => slot(i + 1, `t${i}`, 'locked')).concat([slot(10, 'x', 'provisional')]) }
    expect(roundNoticeText(roundNoticeChange({ leagueId: 'L', season: 2026, result: many, last: null })!, 2027, 'en').body).toMatch(/1\.06 T5, and 3 more\./)
  })

  it('Chimmy reads it in one line, and nothing when automation is off', () => {
    expect(describeRoundNotices({ automation: false, settings: { notify: true, chat: true }, last: null })).toBeNull()
    expect(describeRoundNotices({ automation: true, settings: { notify: true, chat: true }, last: { season: 2026, phase: 'playoffs', lockedTeamIds: ['a', 'b'], at: '2026-12-21T05:00:00Z' } }))
      .toBe('The live rookie draft order updates itself after each playoff round and tells the commissioner and posts in league chat when picks lock. Last update: 2 picks locked (2026-12-21).')
  })
})

describe('the hourly sweep', () => {
  const view = (result: unknown, over: Record<string, unknown> = {}) => ({ basedOnSeason: 2026, draftSeason: 2027, automationActive: true, result, ...over })
  const leagueRow = (live: Record<string, unknown> = {}) => ({ userId: 'commish', name: 'Dynasty Den', settings: { other: 1, rookie_draft_order: { mode: 'x', live: { enabled: true, ...live } } } })

  beforeEach(() => {
    vi.clearAllMocks()
    db.$queryRaw.mockResolvedValue([{ id: 'L' }])
    db.league.update.mockResolvedValue({})
    db.userProfile.findUnique.mockResolvedValue({ preferredLanguage: 'en' })
    chat.mockResolvedValue({ id: 'm' })
  })

  it('refreshes, marks the round, and tells the commissioner once', async () => {
    refresh.mockResolvedValue(view(playoffsStart))
    db.league.findUnique.mockResolvedValue(leagueRow())

    const r = await runRookieOrderRoundNotices()
    expect(refresh).toHaveBeenCalledWith('L')
    expect(r).toMatchObject({ leagues: 1, refreshed: 1, announced: 1, notified: 1, posted: 0 })
    const live = db.league.update.mock.calls[0][0].data.settings.rookie_draft_order.live
    expect(live).toMatchObject({ enabled: true, lastRoundNotice: { season: 2026, phase: 'playoffs', lockedTeamIds: ['n1', 'n2'] } })
    expect(db.league.update.mock.calls[0][0].data.settings.other).toBe(1)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['commish'],
      category: 'commissioner_alerts',
      title: 'Rookie draft order updated',
      body: 'Dynasty Den: Locked: 1.01 N1, 1.02 N2. 2 of 6 picks are set; the rest depend on the playoffs.',
      dedupePrefix: 'rookie-order-round:L:2026:2',
      actionHref: '/league/L?view=settings&settingsPanel=draft',
    }))
    expect(chat).not.toHaveBeenCalled()

    // The next hour, nothing new: no write, no notice.
    vi.clearAllMocks()
    db.$queryRaw.mockResolvedValue([{ id: 'L' }])
    db.league.findUnique.mockResolvedValue(leagueRow({ lastRoundNotice: live.lastRoundNotice }))
    expect(await runRookieOrderRoundNotices()).toMatchObject({ announced: 0, skipped: { no_change: 1 } })
    expect(db.league.update).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('posts in league chat as a host announcement when chosen, in the commissioner language', async () => {
    refresh.mockResolvedValue(view(final))
    db.league.findUnique.mockResolvedValue(leagueRow({ roundNotices: { notify: false, chat: true } }))
    db.userProfile.findUnique.mockResolvedValue({ preferredLanguage: 'es' })

    const r = await runRookieOrderRoundNotices()
    expect(r).toMatchObject({ announced: 1, notified: 0, posted: 1 })
    expect(dispatch).not.toHaveBeenCalled()
    expect(chat).toHaveBeenCalledWith('L', 'commish', expect.stringMatching(/^El orden del draft de novatos 2027 es final\./), expect.objectContaining({
      type: 'host_announcement',
      idempotencyKey: 'rookie-order-round_L_2026_6_final',
      metadata: expect.objectContaining({ senderIsHost: true, contentType: 'rookie_order_update' }),
    }))
  })

  it('does nothing where the automation is not running', async () => {
    refresh.mockResolvedValue(view(playoffsStart, { automationActive: false }))
    expect(await runRookieOrderRoundNotices()).toMatchObject({ refreshed: 1, announced: 0, skipped: { not_entitled: 1 } })
    refresh.mockResolvedValue(null)
    expect(await runRookieOrderRoundNotices()).toMatchObject({ refreshed: 0, skipped: { no_season_data: 1 } })
    expect(db.league.update).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('one league failing does not stop the next', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 'bad' }, { id: 'L' }])
    refresh.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(view(playoffsStart))
    db.league.findUnique.mockResolvedValue(leagueRow())
    const r = await runRookieOrderRoundNotices()
    expect(r.failures).toEqual([{ leagueId: 'bad', error: 'boom' }])
    expect(r.announced).toBe(1)
  })
})
