import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { summarizeMusicSearchUsage } from '@/lib/admin-dashboard/MusicSearchUsageService'
import { APP_DAILY, PER_USER_DAILY } from '@/lib/app-music/youtubeSearch'

const NOW = new Date('2026-11-16T15:00:00Z')
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const row = (d: string, endpoint: string, callsMade: number) => ({ endpoint, callsMade, windowStart: day(d) })

describe('summarizeMusicSearchUsage', () => {
  it('works out cache savings, people and refusals per day, newest first', () => {
    const u = summarizeMusicSearchUsage(
      [
        row('2026-11-16', 'searches', 30),
        row('2026-11-16', 'app', 12),
        row('2026-11-16', 'user:a', 9),
        row('2026-11-16', 'user:b', PER_USER_DAILY),
        row('2026-11-16', 'refused-user', 2),
        row('2026-11-15', 'searches', 5),
        row('2026-11-15', 'app', 5),
        row('2026-11-15', 'user:a', 5),
      ],
      7,
      NOW,
    )
    expect(u.daily).toHaveLength(7)
    expect(u.daily[0]).toEqual({
      day: '2026-11-16',
      searches: 30,
      fresh: 12,
      fromCache: 18,
      people: 2,
      peopleAtLimit: 1,
      refusedPerson: 2,
      refusedApp: 0,
    })
    expect(u.daily[1]).toMatchObject({ day: '2026-11-15', searches: 5, fromCache: 0, people: 1 })
    expect(u.daily[6]).toMatchObject({ day: '2026-11-10', searches: 0, fresh: 0 })
    expect(u.totals).toMatchObject({ searches: 35, fresh: 17, fromCache: 18, uncountedDays: 0, refused: 2, peopleAtLimitDays: 1, appLimitDays: 0 })
    expect(u.headline).toMatch(/Someone used all 20/)
  })

  it('shows the total as UNKNOWN, not as the fresh count, on days before counting began', () => {
    const u = summarizeMusicSearchUsage([row('2026-11-14', 'app', 4), row('2026-11-14', 'user:a', 4)], 7, NOW)
    const d = u.daily.find((x) => x.day === '2026-11-14')!
    expect(d.searches).toBeNull()
    expect(d.fromCache).toBeNull()
    expect(d.fresh).toBe(4)
    // Totals cover the counted days only, and say how many were left out.
    expect(u.totals.searches).toBe(0)
    expect(u.totals.uncountedDays).toBe(1)
    expect(u.totals.fresh).toBe(4)
  })

  it('still totals the counted days when the window reaches back before counting began', () => {
    const u = summarizeMusicSearchUsage(
      [row('2026-11-16', 'searches', 20), row('2026-11-16', 'app', 8), row('2026-11-13', 'app', 3)],
      7,
      NOW,
    )
    expect(u.totals).toMatchObject({ searches: 20, fromCache: 12, fresh: 11, uncountedDays: 1 })
  })

  it('says when music as a whole ran out', () => {
    const u = summarizeMusicSearchUsage(
      [row('2026-11-16', 'searches', 90), row('2026-11-16', 'app', APP_DAILY), row('2026-11-16', 'refused-app', 7)],
      7,
      NOW,
    )
    expect(u.totals.appLimitDays).toBe(1)
    expect(u.headline).toMatch(/used up its 60 YouTube searches on 1 day/)
  })

  it('says plainly when there is room, naming the busiest day', () => {
    const u = summarizeMusicSearchUsage([row('2026-11-16', 'searches', 10), row('2026-11-16', 'app', 6)], 7, NOW)
    expect(u.headline).toBe('Plenty of room in the last 7 days: the busiest day used 6 of 60 YouTube searches.')
  })

  it('says so when nobody searched', () => {
    expect(summarizeMusicSearchUsage([], 1, NOW).headline).toBe('No one has searched YouTube from the Music tab today.')
  })

  it('ignores rows older than the window and people with a zero count', () => {
    const u = summarizeMusicSearchUsage(
      [row('2026-10-01', 'app', 50), row('2026-11-16', 'searches', 1), row('2026-11-16', 'user:gaveback', 0)],
      7,
      NOW,
    )
    expect(u.totals.fresh).toBe(0)
    expect(u.daily[0].people).toBe(0)
  })
})
