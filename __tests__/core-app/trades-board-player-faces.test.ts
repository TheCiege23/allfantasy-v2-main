// @vitest-environment node
/**
 * 🛑 A PLAYER WITH TWO GOOD STORED PHOTOS RENDERED AS INITIALS.
 *
 * `sleeperId` is not unique in `SportsPlayer`: one athlete is a `sleeper`, a `thesportsdb`
 * and a `rolling_insights` row. The Trades board kept the LAST row returned, and Rolling
 * Insights stores the literal `contact_support` where a headshot belongs (null once the
 * sync clears it). Whenever that row came last the face was a broken `src`, then initials —
 * Quinshon Judkins, David Montgomery and Drake Maye on one board on 2026-10-01, while
 * De'Von Achane, who has only a `sleeper` row, rendered fine. The row shapes below are the
 * test database's rows for those players (ep-muddy-leaf, read 2026-10-01).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ sportsPlayers: [] as Array<Record<string, unknown>> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const rows: Record<string, (args: { where?: Record<string, unknown> }) => unknown[]> = {
    leagueTeam: (args) =>
      args.where?.claimedByUserId
        ? [
            {
              leagueId: 'L1',
              league: {
                id: 'L1',
                name: 'Pirate League',
                platform: 'sleeper',
                settings: {},
                leagueType: 'dynasty',
                platformLeagueId: 'S1',
                logoUrl: null,
                avatarUrl: null,
                userId: 'u1',
                updatedAt: new Date('2026-09-30T00:00:00Z'),
                season: 2026,
              },
            },
          ]
        : [],
    leagueTradeHistory: () => [{ id: 'H1', sleeperLeagueId: 'S1', sleeperUsername: '111' }],
    leagueTrade: () => [
      {
        transactionId: 'T1',
        historyId: 'H1',
        season: 2026,
        week: 4,
        tradeDate: new Date('2026-09-30T12:00:00Z'),
        playersGiven: ['12512', '5892'],
        playersReceived: ['11564', '9226'],
        picksGiven: [],
        picksReceived: [],
        partnerName: null,
        partnerRosterId: null,
        platform: 'sleeper',
        sport: 'nfl',
      },
    ],
    sportsPlayer: () => h.sportsPlayers,
  }
  const model = (name: string) => {
    const fn = (args: { where?: Record<string, unknown> }) => Promise.resolve(rows[name]?.(args) ?? [])
    return new Proxy(
      {},
      {
        get: (_t, op) =>
          op === 'findMany' ? fn : op === 'findFirst' || op === 'findUnique' ? () => Promise.resolve(null) : () => Promise.resolve([]),
      },
    )
  }
  const prisma = new Proxy({}, { get: (_t, name) => (name === '$queryRaw' || name === '$queryRawUnsafe' ? () => Promise.resolve([]) : model(String(name))) })
  return { prisma }
})

import { getTradesBoard } from '@/lib/core-app/tradesBoard'

const TSDB = (k: string) => `https://r2.thesportsdb.com/images/media/player/cutout/${k}.png`
const SLEEPER = (id: string) => `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`

beforeEach(() => {
  // Rolling Insights LAST for every duplicated player — the order that lost the face.
  h.sportsPlayers = [
    { sleeperId: '12512', sport: 'NFL', name: 'Quinshon Judkins', position: 'RB', team: 'CLE', imageUrl: SLEEPER('12512') },
    { sleeperId: '12512', sport: 'NFL', name: 'Quinshon Judkins', position: 'RB', team: 'Cleveland Browns', imageUrl: 'contact_support' },
    { sleeperId: '5892', sport: 'NFL', name: 'David Montgomery', position: 'RB', team: 'Houston Texans', imageUrl: TSDB('9qxzi91774793554') },
    { sleeperId: '5892', sport: 'NFL', name: 'David Montgomery', position: 'RB', team: 'HOU', imageUrl: SLEEPER('5892') },
    { sleeperId: '5892', sport: 'NFL', name: 'David Montgomery', position: 'RB', team: 'Houston Texans', imageUrl: 'contact_support' },
    { sleeperId: '11564', sport: 'NFL', name: 'Drake Maye', position: 'QB', team: 'New England Patriots', imageUrl: TSDB('jvjgp51725180398') },
    // Post-cleanup shape: the Rolling Insights row's placeholder cleared to null.
    { sleeperId: '11564', sport: 'NFL', name: 'Drake Maye', position: 'QB', team: 'New England Patriots', imageUrl: null },
    { sleeperId: '9226', sport: 'NFL', name: "De'Von Achane", position: 'RB', team: 'MIA', imageUrl: SLEEPER('9226') },
  ]
})

function facesOf(data: Awaited<ReturnType<typeof getTradesBoard>>): Map<string, { imageUrl: string | null; team: string | null }> {
  const out = new Map<string, { imageUrl: string | null; team: string | null }>()
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) return o.forEach(walk)
    if (!o || typeof o !== 'object') return
    const r = o as Record<string, unknown>
    if (r.kind === 'player' && typeof r.id === 'string') {
      out.set(r.id, { imageUrl: (r.imageUrl as string | null) ?? null, team: (r.team as string | null) ?? null })
    }
    Object.values(r).forEach(walk)
  }
  walk(data)
  return out
}

describe('Trades board player faces', () => {
  it('every player in the trade gets a stored photo, whichever vendor row came last', async () => {
    const faces = facesOf(await getTradesBoard('u1', 4))
    expect([...faces.keys()].sort()).toEqual(['11564', '12512', '5892', '9226'])
    expect(faces.get('12512')?.imageUrl).toBe(SLEEPER('12512'))
    expect(faces.get('5892')?.imageUrl).toBe(TSDB('9qxzi91774793554'))
    expect(faces.get('11564')?.imageUrl).toBe(TSDB('jvjgp51725180398'))
    expect(faces.get('9226')?.imageUrl).toBe(SLEEPER('9226'))
  })

  it('never hands the page a non-URL as a photo', async () => {
    for (const { imageUrl } of facesOf(await getTradesBoard('u1', 4)).values()) {
      expect(imageUrl === null || /^https?:\/\//.test(imageUrl)).toBe(true)
    }
  })

  it('folds an NFL club name to the code the crest lookup needs', async () => {
    expect(facesOf(await getTradesBoard('u1', 4)).get('11564')?.team).toBe('NE')
  })
})
