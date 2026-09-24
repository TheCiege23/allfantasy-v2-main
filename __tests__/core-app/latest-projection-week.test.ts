import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { season: string; week: number; source: string; fetchedAt: Date }

const h = vi.hoisted(() => ({ rows: [] as Array<{ season: string; week: number; source: string; fetchedAt: Date }> }))

vi.mock('server-only', () => ({}))
/*
 * A fake that APPLIES the query rather than recording it: the `where` the reader passes and its
 * `orderBy` list, key by key. So the test asks what week comes back, not which arguments were
 * written — an ordering that answers the wrong week fails here whatever it is spelled as.
 */
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyProjection: {
      findFirst: async (args: {
        where?: { source?: { not?: string } }
        orderBy: Array<Record<string, 'asc' | 'desc'>>
      }) => {
        const notSource = args.where?.source?.not
        const rows = h.rows.filter((r) => notSource == null || r.source !== notSource)
        const value = (r: Row, k: string) => {
          const v = (r as unknown as Record<string, unknown>)[k]
          return v instanceof Date ? v.getTime() : (v as number | string)
        }
        rows.sort((a, b) => {
          for (const o of args.orderBy) {
            const [k, dir] = Object.entries(o)[0]!
            const av = value(a, k)
            const bv = value(b, k)
            if (av === bv) continue
            return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1)
          }
          return 0
        })
        return rows[0] ?? null
      },
    },
  },
}))

import { latestProjectionWeek } from '@/lib/core-app/playerProjections'

/**
 * "This week" for every projection surface. It is the week the feed is being REFRESHED for — not
 * the highest week on file, which the importer's old date guess had filled a week early all season.
 */
beforeEach(() => {
  h.rows = []
})

describe('latestProjectionWeek', () => {
  it('answers the week being refreshed, not a later week written early', () => {
    // Production on Friday of week 3, 2026, once the fixed importer has run: week 4's lines were
    // written early on the Tuesday; week 3's were refreshed this morning.
    h.rows = [
      { season: '2026', week: 4, source: 'sleeper', fetchedAt: new Date('2026-09-24T11:07:57Z') },
      { season: '2026', week: 3, source: 'sleeper', fetchedAt: new Date('2026-09-25T11:05:00Z') },
      { season: '2026', week: 2, source: 'sleeper', fetchedAt: new Date('2026-09-14T11:11:16Z') },
    ]
    return expect(latestProjectionWeek()).resolves.toEqual({ season: '2026', week: 3 })
  })

  it('moves on when the next week starts being refreshed', () => {
    h.rows = [
      { season: '2026', week: 3, source: 'sleeper', fetchedAt: new Date('2026-09-28T11:05:00Z') },
      { season: '2026', week: 4, source: 'sleeper', fetchedAt: new Date('2026-09-29T11:05:00Z') },
    ]
    return expect(latestProjectionWeek()).resolves.toEqual({ season: '2026', week: 4 })
  })

  it("never lets the engine's own mirror rows decide the week", () => {
    h.rows = [
      { season: '2026', week: 3, source: 'sleeper', fetchedAt: new Date('2026-09-25T11:05:00Z') },
      { season: '2026', week: 5, source: 'allfantasy', fetchedAt: new Date('2026-09-25T12:00:00Z') },
    ]
    return expect(latestProjectionWeek()).resolves.toEqual({ season: '2026', week: 3 })
  })

  it('is null with no feed at all', () => expect(latestProjectionWeek()).resolves.toBeNull())
})
