import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() } } }))

import { baselineFrom, buildRecaps, drainSkillRecaps } from '@/lib/rank/skillRating/skillRecap'
import type { SkillBoard } from '@/lib/rank/skillRating/skillRatingStore'
import { prisma } from '@/lib/prisma'

function board(date: string, rows: Record<string, Array<{ u: string; r: number; g: number; w: number; l: number; t?: number }>>): SkillBoard {
  return {
    date,
    computedAt: `${date}T12:00:00.000Z`,
    sources: { facts: 0, weeks: 0, native: 0 },
    sports: Object.fromEntries(
      Object.entries(rows).map(([sport, rs]) => [
        sport,
        {
          games: 0,
          periods: 0,
          latestPeriod: 0,
          rated: 100,
          percentiles: Array.from({ length: 101 }, (_, i) => 1000 + i * 10),
          rows: rs.map((r) => ({ u: r.u, r: r.r, rd: 50, v: 0.06, g: r.g, w: r.w, l: r.l, t: r.t ?? 0, lp: 0 })),
        },
      ]),
    ),
  }
}

describe('weekly skill recap', () => {
  afterEach(() => {
    delete process.env.SKILL_RECAP_NOTIFICATIONS
  })

  it('recaps only managers who played since the baseline, with the week’s change and record', () => {
    const prev = baselineFrom(
      board('2026-10-06', { NFL: [{ u: 'me', r: 1600, g: 20, w: 12, l: 8 }, { u: 'idle', r: 1550, g: 10, w: 5, l: 5 }] }),
    )
    const now = board('2026-10-13', { NFL: [{ u: 'me', r: 1618, g: 22, w: 14, l: 8 }, { u: 'idle', r: 1550, g: 10, w: 5, l: 5 }] })
    const recaps = buildRecaps(prev, now)
    expect(recaps).toHaveLength(1)
    expect(recaps[0].userId).toBe('me')
    expect(recaps[0].title).toBe('Your NFL skill is up 18 this week')
    expect(recaps[0].body).toContain('NFL +18 (2-0), now 1618')
    expect(recaps[0].sports).toEqual(['NFL'])
  })

  it('covers every sport a manager played in one recap, and says when skill slipped', () => {
    const prev = baselineFrom(board('a', { NFL: [{ u: 'me', r: 1600, g: 20, w: 12, l: 8 }], NBA: [{ u: 'me', r: 1500, g: 5, w: 2, l: 3 }] }))
    const now = board('b', { NFL: [{ u: 'me', r: 1590, g: 21, w: 12, l: 9 }], NBA: [{ u: 'me', r: 1530, g: 8, w: 5, l: 3 }] })
    const [recap] = buildRecaps(prev, now)
    expect(recap.sports).toEqual(['NBA', 'NFL'])
    expect(recap.title).toBe('Your NBA skill is up 30 this week')
    expect(recap.body).toContain('NFL −10 (0-1)')
  })

  it('a manager new since the baseline is measured from the starting rating', () => {
    const [recap] = buildRecaps(baselineFrom(board('a', {})), board('b', { NFL: [{ u: 'new', r: 1540, g: 2, w: 2, l: 0 }] }))
    expect(recap.title).toBe('Your NFL skill is up 40 this week')
  })

  it('sends nothing unless SKILL_RECAP_NOTIFICATIONS=true', async () => {
    const out = await drainSkillRecaps()
    expect(out.sent).toBe(0)
    expect(prisma.sportsDataCache.findUnique).not.toHaveBeenCalled()
  })
})
