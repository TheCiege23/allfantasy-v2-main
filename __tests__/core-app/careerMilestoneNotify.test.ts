import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CareerRow } from '@/lib/core-app/careerModel'
import type { StoredCareerProfile } from '@/lib/core-app/careerProfile'
import { row } from './careerFixtures'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  dispatchNotification: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { platformNotification: { findFirst: mocks.findFirst } } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: mocks.dispatchNotification }))

import { notifyCareerMilestones } from '@/lib/core-app/careerMilestoneNotify'

const profile = (rows: CareerRow[]): StoredCareerProfile => ({
  version: 2,
  builtAt: '2026-10-01T00:00:00Z',
  stamp: 's',
  rows,
  platforms: ['sleeper'],
  rosterless: 0,
  trades: [],
})

/** Five live leagues that all finish as titles in one rebuild — five title events and more. */
function bigFinish() {
  const live = Array.from({ length: 5 }, (_, i) =>
    row({ key: `L${i}`, leagueName: `League ${i}`, season: 2026, counted: false, status: 'in_season' }),
  )
  const done = live.map((r) => ({ ...r, counted: true, status: 'complete', isChampion: true }))
  return { prev: profile(live), next: profile(done) }
}

describe('notifyCareerMilestones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue(null)
    mocks.dispatchNotification.mockResolvedValue(undefined)
  })

  it('sends nothing on a first build', async () => {
    expect(await notifyCareerMilestones('u1', null, bigFinish().next)).toBe(0)
    expect(mocks.dispatchNotification).not.toHaveBeenCalled()
  })

  it('caps one rebuild at three alerts, titles first, under the career_milestones category', async () => {
    const { prev, next } = bigFinish()
    expect(await notifyCareerMilestones('u1', prev, next)).toBe(3)
    const calls = mocks.dispatchNotification.mock.calls.map((c) => c[0])
    expect(calls.every((c) => c.category === 'career_milestones' && c.userIds[0] === 'u1')).toBe(true)
    expect(calls.map((c) => c.dedupePrefix)).toEqual([
      'career-milestone:title:L0',
      'career-milestone:title:L1',
      'career-milestone:title:L2',
    ])
  })

  it('skips a milestone already sent, and treats a failed lookup as sent', async () => {
    const { prev, next } = bigFinish()
    mocks.findFirst
      .mockResolvedValueOnce({ id: 'already' })
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(null)
    expect(await notifyCareerMilestones('u1', prev, next)).toBe(1)
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { sourceKey: 'career-milestone:title:L0:u1' }, select: { id: true } })
    expect(mocks.dispatchNotification.mock.calls[0][0].dedupePrefix).toBe('career-milestone:title:L2')
  })
})
