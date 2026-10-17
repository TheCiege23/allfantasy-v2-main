import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `attachPlayerMedia` / `attachPlayerMediaBatch` — the trade evaluator, trade finder and
 * recent-trades media.
 *
 * 🛑 Every `SportsPlayer` source stamps the same `sleeperId`, and TheSportsDB's rows got theirs by
 * NAME: its 11304 is G Elgton Jenkins (CLE) and its 6273 is G Jackson Powers-Johnson. "Freshest
 * row first" served their cutouts and clubs for TE E.J. Jenkins (PHI) and DT P.J. Johnson (LV).
 */

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ players: [] as Row[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    sportsPlayer: {
      // Returns rows freshest first, as `orderBy: { fetchedAt: 'desc' }` would.
      findFirst: vi.fn(async (args: { where: Row }) => match(args.where)[0] ?? null),
      findMany: vi.fn(async (args: { where: Row }) => match(args.where)),
    },
    sportsPlayerRecord: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    teamAsset: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
  },
}))

function match(where: Row): Row[] {
  const sid = where.sleeperId as string | { in: string[] }
  const ids = typeof sid === 'string' ? [sid] : sid.in
  return state.players
    .filter((r) => ids.includes(r.sleeperId as string))
    .sort((a, b) => (b.fetchedAt as Date).getTime() - (a.fetchedAt as Date).getTime())
}

// Fresh module per test: `player-media` caches resolved players for six hours.
const load = () => import('@/lib/player-media')

const ELGTON_CUTOUT = 'https://www.thesportsdb.com/images/media/player/cutout/elgton-jenkins.png'
const PJ_CUTOUT = 'https://www.thesportsdb.com/images/media/player/cutout/powers-johnson.png'

beforeEach(() => {
  vi.resetModules()
  state.players = [
    { sleeperId: '11304', source: 'sleeper', name: 'E.J. Jenkins', position: 'TE', team: 'PHI', imageUrl: null, fetchedAt: new Date('2026-10-01') },
    { sleeperId: '11304', source: 'thesportsdb', name: 'Elgton Jenkins', position: 'G', team: 'CLE', imageUrl: ELGTON_CUTOUT, fetchedAt: new Date('2026-10-11') },
    { sleeperId: '6273', source: 'sleeper', name: 'P.J. Johnson', position: 'DT', team: 'LV', imageUrl: null, fetchedAt: new Date('2026-10-01') },
    { sleeperId: '6273', source: 'thesportsdb', name: 'Jackson Powers-Johnson', position: 'G', team: 'LV', imageUrl: PJ_CUTOUT, fetchedAt: new Date('2026-10-11') },
    // Same man in both feeds: the cutout may fill the Sleeper row's gap.
    { sleeperId: '6794', source: 'sleeper', name: 'Justin Jefferson', position: 'WR', team: 'MIN', imageUrl: null, fetchedAt: new Date('2026-10-01') },
    { sleeperId: '6794', source: 'thesportsdb', name: 'Justin Jefferson', position: 'WR', team: 'MIN', imageUrl: 'https://img/jj.png', fetchedAt: new Date('2026-10-11') },
  ]
})

describe('player media — the Sleeper row speaks for a Sleeper id', () => {
  it('🛑 single: E.J. Jenkins gets neither Elgton Jenkins\' cutout nor Cleveland', async () => {
    const { attachPlayerMedia } = await load()
    const r = await attachPlayerMedia({ playerId: '11304', sport: 'nfl' })
    expect(r.teamAbbr).toBe('PHI')
    expect(r.media.headshotUrl).not.toBe(ELGTON_CUTOUT)
  })

  it('🛑 batch: neither namesake\'s cutout or club is served', async () => {
    const { attachPlayerMediaBatch } = await load()
    const out = await attachPlayerMediaBatch([
      { playerId: '6273', sport: 'nfl' },
      { playerId: '11304', sport: 'nfl', teamAbbr: null },
    ])
    expect(out.get('11304')?.teamAbbr).toBe('PHI')
    expect(out.get('11304')?.media.headshotUrl).not.toBe(ELGTON_CUTOUT)
    expect(out.get('6273')?.teamAbbr).toBe('LV')
    expect(out.get('6273')?.media.headshotUrl).not.toBe(PJ_CUTOUT)
  })

  it('an agreeing row still fills the Sleeper row\'s missing image', async () => {
    const { attachPlayerMediaBatch } = await load()
    const out = await attachPlayerMediaBatch([{ playerId: '6794', sport: 'nfl' }])
    expect(out.get('6794')?.media.headshotUrl).toBe('https://img/jj.png')
  })
})
