import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ session: vi.fn(), roster: vi.fn(), league: vi.fn(), dispatch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: h.session }, roster: { findUnique: h.roster }, league: { findUnique: h.league } } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/notifications/resolveAppUserIds', () => ({ resolveAppUserIds: async (ids: string[]) => ids }))
vi.mock('@/lib/draft-notifications/draftEmails', () => ({ buildDraftStartingEmail: vi.fn() }))
vi.mock('@/lib/draft-room/loadDraftQueueForUser', () => ({ loadDraftQueueForUser: vi.fn() }))
import { createDraftNotificationForUsers, notifyOnTheClockAfterPick, notifyDraftLifecycle, notifyDraftTimeSet } from '@/lib/draft-notifications'
beforeEach(() => {
  vi.resetAllMocks()
  h.league.mockResolvedValue({ name: 'League' })
  h.roster.mockImplementation(async ({ where }) => ({ platformUserId: `user-${where.id}` }))
  h.dispatch.mockResolvedValue({ delivered: 1, failed: 0 })
  h.session.mockResolvedValue({ id: 'draft1', status: 'in_progress', teamCount: 4, rounds: 3, draftType: 'snake', thirdRoundReversal: false,
    slotOrder: ['A', 'B', 'C', 'D'].map((rosterId, i) => ({ rosterId, slot: i + 1, displayName: rosterId })),
    picks: [{ overall: 1, playerName: 'Player One', position: 'QB' }],
    tradedPicks: [{ round: 2, originalRosterId: 'D', newRosterId: 'X', newOwnerName: 'X', previousOwnerName: 'D' }],
  })
})
describe('draft three picks away', () => {
  it('warns the actual owner after a traded pick across a snake turn', async () => {
    await notifyOnTheClockAfterPick('league')
    const notices = h.dispatch.mock.calls.map(c => c[0])
    expect(notices.find(n => n.type === 'draft_on_the_clock')?.userIds).toEqual(['user-B'])
    expect(notices.find(n => n.type === 'draft_on_the_clock')?.smsBody).toContain('AllFantasy')
    expect(notices.find(n => n.type === 'draft_next_pick')).toMatchObject({ userIds: ['user-C'], category: 'draft_alerts', skipChannels: { email: true } })
    expect(notices.find(n => n.type === 'draft_two_picks_away')).toMatchObject({ userIds: ['user-D'], category: 'draft_alerts', dedupePrefix: 'draft_two_picks_away:league:draft1:4' })
    expect(notices.find(n => n.type === 'draft_three_picks_away')).toMatchObject({ userIds: ['user-X'], category: 'draft_alerts', dedupePrefix: 'draft_three_picks_away:league:draft1:5' })
  })
  it('does not send an upcoming snake-pick warning in an auction', async () => {
    const session = await h.session()
    h.session.mockResolvedValue({ ...session, draftType: 'auction' })
    await notifyOnTheClockAfterPick('league')
    expect(h.dispatch.mock.calls.map(c => c[0].type)).not.toContain('draft_three_picks_away')
  })
})

describe('draft lifecycle channels', () => {
  it('exports lifecycle and schedule senders from the draft package', () => {
    expect(typeof notifyDraftLifecycle).toBe('function')
    expect(typeof notifyDraftTimeSet).toBe('function')
  })
  it.each(['draft_time_set', 'draft_started', 'draft_paused', 'draft_ended'] as const)('%s uses push, in-app and consented SMS', async (type) => {
    await createDraftNotificationForUsers(['manager'], type, { leagueId: 'league', leagueName: 'League', eventKey: 'draft1:7', draftTime: '2026-11-01T18:00:00Z' })
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['manager'], type, category: 'draft_alerts', leagueId: 'league',
      skipChannels: { email: true }, dedupePrefix: `${type}:league:draft1:7`, smsBody: expect.stringContaining('AllFantasy'),
    }))
  })
})
