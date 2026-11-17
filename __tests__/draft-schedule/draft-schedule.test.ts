import { describe, expect, it, vi } from 'vitest'

import { bestSlot, draftReminderDue, formatSlot, groupByTimeZone, parseSlots, safeTimeZone } from '@/lib/draft-schedule/draftSchedule'
import { readViewerPoll } from '@/lib/chat-core/messagePolls'

// Mocks for the draft-time notification test at the bottom; the pure tests above never touch them.
const h = vi.hoisted(() => ({ dispatched: [] as Array<{ userIds: string[]; body?: string }> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async (p: { userIds: string[]; body?: string }) => { h.dispatched.push(p) }) }))
vi.mock('@/lib/notifications/resolveAppUserIds', () => ({ resolveAppUserIds: async (ids: string[]) => ids }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: async () => [{ platformUserId: 'east' }, { platformUserId: 'west' }, { platformUserId: 'nozone' }] },
    league: { findUnique: async () => ({ userId: 'east', name: 'Dynasty Bros' }) },
    userProfile: { findMany: async () => [{ userId: 'east', timezone: 'America/New_York' }, { userId: 'west', timezone: 'America/Los_Angeles' }, { userId: 'nozone', timezone: null }] },
    leagueSettings: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
  },
}))


const NOW = new Date('2026-08-01T12:00:00Z')
const H = 60 * 60 * 1000
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

describe('offered times', () => {
  it('sorts, dedupes and accepts two to eight future times an hour apart', () => {
    // The same time twice is one time: not enough to choose between.
    expect(parseSlots([at(24 * H), at(24 * H)], NOW)).toEqual({ ok: false, error: 'too_few' })
    expect(parseSlots([at(48 * H), at(24 * H)], NOW)).toEqual({ ok: true, slots: [at(24 * H), at(48 * H)] })
  })

  it('refuses a time too soon, two times too close, junk and too many', () => {
    expect(parseSlots([at(H), at(24 * H)], NOW)).toEqual({ ok: false, error: 'in_the_past' })
    expect(parseSlots([at(24 * H), at(24 * H + 30 * 60 * 1000)], NOW)).toEqual({ ok: false, error: 'too_close' })
    expect(parseSlots(['tomorrow', at(24 * H)], NOW)).toEqual({ ok: false, error: 'invalid_time' })
    expect(parseSlots(Array.from({ length: 9 }, (_, i) => at((24 + i * 2) * H)), NOW)).toEqual({ ok: false, error: 'too_many' })
  })
})

describe('the best time', () => {
  it('most managers wins; a tie goes to the earlier time; nobody answering is no recommendation', () => {
    const slots = [
      { id: 'a', startsAt: at(48 * H), count: 6 },
      { id: 'b', startsAt: at(24 * H), count: 6 },
      { id: 'c', startsAt: at(30 * H), count: 4 },
    ]
    expect(bestSlot(slots)?.id).toBe('b')
    expect(bestSlot(slots.map((s) => ({ ...s, count: 0 })))).toBeNull()
  })
})

describe('time zones', () => {
  it('writes one moment in each reader’s own clock, with the zone named', () => {
    const iso = '2026-08-30T00:00:00.000Z'
    expect(formatSlot(iso, 'America/New_York')).toBe('Sat, Aug 29, 8:00 PM EDT')
    expect(formatSlot(iso, 'America/Los_Angeles')).toBe('Sat, Aug 29, 5:00 PM PDT')
  })

  it('a bad or missing zone falls back rather than throwing', () => {
    expect(safeTimeZone('Mars/Olympus')).toBe('America/New_York')
    expect(safeTimeZone(null, 'America/Chicago')).toBe('America/Chicago')
  })

  it('groups members by the zone their message is written in', () => {
    const g = groupByTimeZone([{ userId: 'a', timeZone: 'America/Los_Angeles' }, { userId: 'b', timeZone: null }, { userId: 'c', timeZone: 'America/Los_Angeles' }], 'America/New_York')
    expect(g).toEqual(new Map([['America/Los_Angeles', ['a', 'c']], ['America/New_York', ['b']]]))
  })
})

describe('pre-draft reminders', () => {
  const draft = new Date(NOW.getTime() + 30 * H)
  it('the day-before window is 25h to 2h out; the hour-before window is the last 90 minutes', () => {
    expect(draftReminderDue(draft, new Date(draft.getTime() - 26 * H))).toBeNull()
    expect(draftReminderDue(draft, new Date(draft.getTime() - 24 * H))).toBe('24h')
    expect(draftReminderDue(draft, new Date(draft.getTime() - 3 * H))).toBe('24h')
    expect(draftReminderDue(draft, new Date(draft.getTime() - 100 * 60 * 1000))).toBeNull()
    expect(draftReminderDue(draft, new Date(draft.getTime() - 60 * 60 * 1000))).toBe('1h')
    expect(draftReminderDue(draft, new Date(draft.getTime() + 1000))).toBeNull()
  })
})

describe('a time option in a chat poll', () => {
  it('carries its moment, so the poll can show it in the reader’s zone', () => {
    const poll = readViewerPoll({ poll: { question: 'When?', options: [{ id: 's1', text: 'Sat, Aug 29, 8:00 PM EDT', startsAt: '2026-08-30T00:00:00.000Z', votes: ['u1'] }, { id: 's2', text: 'No time', startsAt: 'never', votes: [] }] } }, 'u1')
    expect(poll?.options[0]).toMatchObject({ id: 's1', startsAt: '2026-08-30T00:00:00.000Z', count: 1, mine: true })
    expect(poll?.options[1]).not.toHaveProperty('startsAt')
  })
})

describe('🛑 the draft-time notice is in each member’s own zone, not "ET" for everyone', () => {
  it('sends one message per zone, each with the time in that zone', async () => {
    const { notifyDraftTimeSet } = await import('@/lib/draft-notifications/DraftNotificationService')
    await notifyDraftTimeSet('L1', new Date('2026-08-30T00:00:00.000Z'))
    const byUser = Object.fromEntries(h.dispatched.flatMap((d) => d.userIds.map((u) => [u, d.body])))
    expect(byUser.east).toBe('The draft is scheduled for Sat, Aug 29, 8:00 PM EDT.')
    expect(byUser.west).toBe('The draft is scheduled for Sat, Aug 29, 5:00 PM PDT.')
    // No zone on the profile: the league's zone, named — never a silent "ET".
    expect(byUser.nozone).toBe('The draft is scheduled for Sat, Aug 29, 7:00 PM CDT.')
  })
})
