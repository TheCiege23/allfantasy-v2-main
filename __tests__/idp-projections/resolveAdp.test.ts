import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetAdpSentinelCache,
  adpSlug,
  loadAdpBySleeperId,
  normalizeAdpName,
} from '@/lib/adp/resolveAdp'

/**
 * `AdpDataRecord` held 94,116 rows that no consumer could read, because the table is keyed by
 * name slugs and `SportsPlayer` uuids while every caller passes Sleeper ids. These pin the
 * translation, and — just as importantly — pin what it refuses to translate.
 */

type AdpRow = {
  playerId: string
  playerName: string
  adp: number
  position: string | null
  format: string
  scoring: string | null
  source?: string | null
}

const fakePrisma = (
  players: Array<{ id: string; sleeperId: string; name: string; position: string | null; team: string | null }>,
  adp: AdpRow[],
  groups: Array<{ format: string; adp: number; count: number }> = [],
) =>
  ({
    sportsPlayer: {
      findMany: vi.fn(async () => players.map((p) => ({ ...p, updatedAt: new Date() }))),
    },
    adpDataRecord: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const idIn = (where.playerId as { in?: string[] } | undefined)?.in
        const nameIn = (where.playerName as { in?: string[] } | undefined)?.in
        if (idIn) return adp.filter((r) => idIn.includes(r.playerId))
        if (nameIn) return adp.filter((r) => nameIn.includes(r.playerName))
        return []
      }),
      groupBy: vi.fn(async () =>
        groups.map((g) => ({ format: g.format, adp: g.adp, _count: { _all: g.count } })),
      ),
    },
  }) as never

const player = (over: Partial<{ id: string; sleeperId: string; name: string; position: string; team: string }> = {}) => ({
  id: 'uuid-1',
  sleeperId: '111',
  name: 'Matt Milano',
  position: 'LB',
  team: 'BUF',
  ...over,
})

const row = (over: Partial<AdpRow> = {}): AdpRow => ({
  playerId: 'NFL:matt-milano:LB:BUF',
  playerName: 'Matt Milano',
  adp: 443.7,
  position: 'LB',
  format: 'dynasty',
  scoring: 'standard',
  source: 'consensus',
  ...over,
})

beforeEach(() => __resetAdpSentinelCache())

describe('normalizeAdpName — the slug drops what we would keep', () => {
  it('removes punctuation rather than replacing it', () => {
    // `T.J. Watt` is slugged `tj-watt`, not `t-j-watt`. Replacing would miss every initialled name.
    expect(normalizeAdpName('T.J. Watt')).toBe('tj watt')
    expect(normalizeAdpName("Ja'Marr Chase")).toBe('jamarr chase')
  })

  it('drops generational suffixes, because the slug does', () => {
    // `Brian Thomas Jr.` -> `brian-thomas`. Keeping the suffix misses every junior in the league,
    // which is a systematically biased miss rather than a random one.
    expect(normalizeAdpName('Brian Thomas Jr.')).toBe('brian thomas')
    expect(normalizeAdpName('Marvin Harrison Jr.')).toBe('marvin harrison')
  })

  it('keeps internal hyphens as word breaks', () => {
    expect(normalizeAdpName('Jaxon Smith-Njigba')).toBe('jaxon smith njigba')
    expect(normalizeAdpName('Amon-Ra St. Brown')).toBe('amon ra st brown')
  })
})

describe('adpSlug', () => {
  it('builds the key the ADP writer produces', () => {
    expect(adpSlug('NFL', 'Brian Thomas Jr.', 'WR', 'JAX')).toBe('NFL:brian-thomas:WR:JAX')
    expect(adpSlug('NFL', 'T.J. Watt', 'LB', 'PIT')).toBe('NFL:tj-watt:LB:PIT')
  })

  it('refuses to build a partial key', () => {
    // A slug missing its team would match a different player's row or none at all.
    expect(adpSlug('NFL', 'Matt Milano', 'LB', null)).toBeNull()
    expect(adpSlug('NFL', '', 'LB', 'BUF')).toBeNull()
  })
})

describe('loadAdpBySleeperId — translation', () => {
  it('returns rows keyed by the SLEEPER id the caller asked about', async () => {
    /*
     * THE WHOLE POINT. `resolveTradeEnrichment` indexes the result as `adpByPlayerId[r.playerId]`
     * and then looks that map up by its own ids, so handing back the ADP table's key would
     * rebuild the same silent miss one layer up.
     */
    const res = await loadAdpBySleeperId({
      prisma: fakePrisma([player()], [row()]),
      sport: 'NFL',
      sleeperIds: ['111'],
    })
    expect(res.get('111')?.adp).toBe(443.7)
    expect(res.get('111')?.via).toBe('slug')
  })

  it('resolves the legacy uuid rows, which are SportsPlayer ids', async () => {
    const res = await loadAdpBySleeperId({
      prisma: fakePrisma([player()], [row({ playerId: 'uuid-1' })]),
      sport: 'NFL',
      sleeperIds: ['111'],
    })
    expect(res.get('111')?.via).toBe('sports_player_id')
  })

  it('collapses specific defensive positions onto the group the board ranks', async () => {
    // Our side says CB; the ADP board says DB. Without the collapse no corner ever matches.
    const res = await loadAdpBySleeperId({
      prisma: fakePrisma(
        [player({ sleeperId: '222', name: 'Jalen Ramsey', position: 'CB', team: 'MIA' })],
        [row({ playerId: 'other', playerName: 'Jalen Ramsey', position: 'DB', adp: 383 })],
      ),
      sport: 'NFL',
      sleeperIds: ['222'],
    })
    expect(res.get('222')?.adp).toBe(383)
    expect(res.get('222')?.via).toBe('name')
  })
})

describe('loadAdpBySleeperId — what it refuses', () => {
  it('drops a name that matches more than one of our players', async () => {
    /*
     * Same-name players are real — the dedupe pass on this database found plenty. Picking one
     * silently attaches a stranger's draft position to a manager's asset.
     */
    const res = await loadAdpBySleeperId({
      prisma: fakePrisma(
        [
          player({ id: 'u1', sleeperId: '1', name: 'Mike Williams', position: 'WR', team: null }),
          player({ id: 'u2', sleeperId: '2', name: 'Mike Williams', position: 'WR', team: null }),
        ],
        [row({ playerId: 'x', playerName: 'Mike Williams', position: 'WR', adp: 50 })],
      ),
      sport: 'NFL',
      sleeperIds: ['1', '2'],
    })
    expect(res.size).toBe(0)
  })

  it('discards a value that dominates its board, because that is a placeholder', async () => {
    /*
     * THE DEFECT THIS CATCHES. The `espn` feed writes a flat 170 for every player it does not
     * rank — one distinct value across 20,000 rows — and `consensus` averages it in, so 14,335
     * redraft rows read as "goes 170th". The players hit are backups nobody drafts at all, so a
     * wrong number gets used where a missing one would have been refused.
     */
    const res = await loadAdpBySleeperId({
      prisma: fakePrisma(
        [player({ sleeperId: '333', name: 'Myles Bryant', position: 'DB', team: 'NE' })],
        [row({ playerId: 'NFL:myles-bryant:DB:NE', playerName: 'Myles Bryant', position: 'DB', adp: 170, format: 'redraft' })],
        [
          { format: 'redraft', adp: 170, count: 4800 },
          { format: 'redraft', adp: 12.3, count: 20 },
        ],
      ),
      sport: 'NFL',
      sleeperIds: ['333'],
    })
    expect(res.size).toBe(0)
  })

  it('keeps a value that merely repeats a little — the test is dominance, not repetition', async () => {
    const res = await loadAdpBySleeperId({
      prisma: fakePrisma(
        [player()],
        [row({ adp: 443.7 })],
        [
          { format: 'dynasty', adp: 443.7, count: 30 },
          { format: 'dynasty', adp: 12.3, count: 9000 },
        ],
      ),
      sport: 'NFL',
      sleeperIds: ['111'],
    })
    expect(res.get('111')?.adp).toBe(443.7)
  })

  it('returns nothing rather than throwing when the player is unknown to us', async () => {
    const res = await loadAdpBySleeperId({ prisma: fakePrisma([], []), sport: 'NFL', sleeperIds: ['999'] })
    expect(res.size).toBe(0)
  })

  it('does no work at all for an empty id list', async () => {
    const prisma = fakePrisma([], [])
    const res = await loadAdpBySleeperId({ prisma, sport: 'NFL', sleeperIds: [] })
    expect(res.size).toBe(0)
  })
})
