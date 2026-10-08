import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
const store = vi.hoisted(() => ({ row: null as unknown, upsertFails: false, upserts: 0 }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async () => (store.row ? { data: store.row } : null)),
      upsert: vi.fn(async ({ create }: { create: { data: unknown } }) => {
        store.upserts++
        if (store.upsertFails) throw new Error('db down')
        store.row = create.data
        return {}
      }),
    },
  },
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))

import { checkIn, dayKey, shiftDay, summarizeStreak, type StreakRecord } from '@/lib/core-app/dailyStreak'
import { loadDailyStreak } from '@/lib/core-app/dailyStreakStore'
import { DailyStreakCardView, StreakGlanceView } from '@/components/core-app/home/DailyStreakCardView'

const rec = (days: string[], best = 0): StreakRecord => ({ version: 1, days, best })

describe('daily streak — the days', () => {
  it('counts US Eastern calendar days: 11pm Pacific is still "today" in New York terms', () => {
    // 2026-10-09T02:30Z is Oct 8, 10:30pm ET.
    expect(dayKey(new Date('2026-10-09T02:30:00Z'))).toBe('2026-10-08')
    expect(dayKey(new Date('2026-10-09T04:30:00Z'))).toBe('2026-10-09')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('extends on consecutive days, resets after a missed day, and keeps the best', () => {
    let r = checkIn(null, '2026-10-01')
    r = checkIn(r, '2026-10-02')
    r = checkIn(r, '2026-10-03')
    expect(summarizeStreak(r, r, '2026-10-03').current).toBe(3)
    const after = checkIn(r, '2026-10-05') // missed the 4th
    const s = summarizeStreak(r, after, '2026-10-05')
    expect(s.current).toBe(1)
    expect(s.best).toBe(3)
  })

  it('is idempotent within a day and only celebrates the visit that extended it', () => {
    const before = rec(['2026-10-06', '2026-10-07'], 2)
    const after = checkIn(before, '2026-10-08')
    expect(checkIn(after, '2026-10-08')).toEqual(after)
    expect(summarizeStreak(before, after, '2026-10-08')).toMatchObject({ current: 3, justExtended: true, reached: 3 })
    expect(summarizeStreak(after, after, '2026-10-08')).toMatchObject({ current: 3, justExtended: false, reached: null })
  })

  it('a streak not yet checked in today is at risk, not broken', () => {
    const r = rec(['2026-10-06', '2026-10-07'], 2)
    expect(summarizeStreak(r, r, '2026-10-08')).toMatchObject({ current: 2, checkedInToday: false })
    expect(summarizeStreak(r, r, '2026-10-09').current).toBe(0)
  })

  it('names the next milestone and draws the last seven days ending today', () => {
    const r = checkIn(rec(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'], 4), '2026-10-08')
    const s = summarizeStreak(r, r, '2026-10-08')
    expect(s.next).toEqual({ at: 7, left: 2 })
    expect(s.week.map((d) => d.checked)).toEqual([false, false, true, true, true, true, true])
    expect(s.week[6]).toMatchObject({ day: '2026-10-08', isToday: true, weekday: 4 })
  })
})

describe('daily streak — the store', () => {
  const NOW = new Date('2026-10-08T15:00:00Z')
  beforeEach(() => {
    store.row = null
    store.upsertFails = false
    store.upserts = 0
  })

  it('checks in on a real visit and writes once per day', async () => {
    store.row = rec(['2026-10-07'], 1)
    expect(await loadDailyStreak('u1', NOW, { record: true })).toMatchObject({ current: 2, justExtended: true })
    expect(await loadDailyStreak('u1', NOW, { record: true })).toMatchObject({ current: 2, justExtended: false })
    expect(store.upserts).toBe(1)
  })

  it('never writes on a prefetch or filtered view', async () => {
    store.row = rec(['2026-10-07'], 1)
    expect(await loadDailyStreak('u1', NOW, { record: false })).toMatchObject({ current: 1, checkedInToday: false })
    expect(store.upserts).toBe(0)
  })

  it('🛑 a failed write is not celebrated as a streak that advanced', async () => {
    store.row = rec(['2026-10-07'], 1)
    store.upsertFails = true
    expect(await loadDailyStreak('u1', NOW, { record: true })).toMatchObject({ current: 1, justExtended: false, checkedInToday: false })
  })
})

describe('daily streak — the strip', () => {
  it('celebrates the extending visit and shows the glance chips', () => {
    const before = rec(['2026-10-06', '2026-10-07'], 2)
    const s = summarizeStreak(before, checkIn(before, '2026-10-08'), '2026-10-08')
    const { container } = render(
      <DailyStreakCardView streak={s}>
        <StreakGlanceView
          items={[
            { key: 'lineups', tone: 'warn', count: 2, href: '/core/my-team?league=L1' },
            { key: 'injuries', tone: 'ok', count: 0, href: '/my-players' },
            { key: 'trades', tone: 'ok', count: 3, href: '/core/trades' },
          ]}
        />
      </DailyStreakCardView>,
    )
    expect(screen.getByText('Day 3!')).toBeTruthy()
    expect(screen.getByText('🏅 3-day milestone!')).toBeTruthy()
    expect(container.querySelector('.af-streak')?.getAttribute('data-celebrate')).toBe('true')
    expect(screen.getByText('2 lineups to fix')).toBeTruthy()
    expect(screen.getByText('No injury flags')).toBeTruthy()
    expect(screen.getByText('3 new trades')).toBeTruthy()
  })

  it('says a streak is at risk when today has no check-in yet', () => {
    const r = rec(['2026-10-06', '2026-10-07'], 2)
    const { container } = render(<DailyStreakCardView streak={summarizeStreak(r, r, '2026-10-08')} />)
    expect(screen.getByText('2-day streak')).toBeTruthy()
    expect(screen.getByText('Check in today to keep it alive')).toBeTruthy()
    expect(container.querySelector('.af-streak')?.getAttribute('data-at-risk')).toBe('true')
  })
})
