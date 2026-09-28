/**
 * A roster in another platform's id space must never be read as Sleeper ids — the shared rule.
 *
 * 🛑 MEASURED ON PRODUCTION 2026-09-27: 44 of the 248 ids on the one Fleaflicker league's rosters are
 * also real Sleeper ids. Fleaflicker, MFL, Fantrax and Yahoo rosters hold the provider's own numbers,
 * and the shared translators passed them through untouched while the crosswalk callers fell back to
 * the raw id — so the Trades value cards, portfolio insights, Season Outlook, My Team and the matchup
 * board named and priced strangers. Every guard downstream only examined a MISS; a collision is a HIT.
 *
 * Fixture shape: "4034" and "6794" are Fleaflicker ids that equal real Sleeper ids.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      // The ESPN bridge: one ESPN id links to a Sleeper id.
      findMany: vi.fn(async ({ where }: { where: { espnId?: { in: string[] } } }) =>
        (where.espnId?.in ?? []).includes('3139477') ? [{ espnId: '3139477', sleeperId: '10236' }] : [],
      ),
    },
  },
}))

import {
  isForeignIdSpace,
  stripForeignIds,
  translateRostersByLeague,
  translateRostersToSleeperIds,
} from '@/lib/core-app/rosterIdSpace'
import { sleeperLookupId } from '@/lib/core-app/rosterIdCrosswalk'

const FLEA_PD = {
  players: ['4034', '6794', '777'],
  starters: ['4034'],
  reserve: ['6794'],
  taxi: [],
  ir: ['777'],
  devy: ['x'],
  lineup_sections: { starters: [{ id: '4034', position: 'RB' }], bench: [{ id: '6794' }], note: 'kept' },
  settings: { keep: true },
}

describe('isForeignIdSpace', () => {
  it('is the platforms whose ids are the provider’s own', () => {
    for (const p of ['fleaflicker', 'mfl', 'fantrax', 'yahoo', 'Fleaflicker']) expect(isForeignIdSpace(p)).toBe(true)
    for (const p of ['sleeper', 'manual', 'allfantasy', '', null, undefined, 'espn']) expect(isForeignIdSpace(p)).toBe(false)
  })
})

describe('stripForeignIds', () => {
  it('empties every id-bearing key, including ir, devy and each lineup section — and nothing else', () => {
    expect(stripForeignIds(FLEA_PD)).toEqual({
      players: [],
      starters: [],
      reserve: [],
      taxi: [],
      ir: [],
      devy: [],
      lineup_sections: { starters: [], bench: [], note: 'kept' },
      settings: { keep: true },
    })
  })
})

describe('the translators', () => {
  it('strip a foreign roster, leave a Sleeper roster alone, and still translate ESPN', async () => {
    const out = await translateRostersByLeague(
      [
        { leagueId: 'F', playerData: FLEA_PD },
        { leagueId: 'S', playerData: { players: ['4034'], starters: ['4034'] } },
        { leagueId: 'E', playerData: { players: ['3139477'], starters: ['3139477'] } },
      ],
      new Map([
        ['F', 'fleaflicker'],
        ['S', 'sleeper'],
        ['E', 'espn'],
      ]),
    )
    const by = Object.fromEntries(out.map((r) => [r.leagueId, r.playerData as Record<string, unknown>]))
    expect(by.F!.players).toEqual([])
    expect(by.F!.starters).toEqual([])
    expect(by.S!.players).toEqual(['4034'])
    expect(by.E!.players).toEqual(['10236'])
  })

  it('one league: a foreign roster comes back stripped, counted, translated zero', async () => {
    const res = await translateRostersToSleeperIds('mfl', [{ playerData: FLEA_PD }])
    expect(res.idSpace).toBe('other')
    expect(res.translated).toBe(0)
    expect(res.total).toBe(3)
    expect((res.rosters[0]!.playerData as Record<string, unknown>).players).toEqual([])
  })
})

describe('sleeperLookupId', () => {
  const crosswalk = new Map([['fl-9', '9']])
  it('a foreign league resolves only what the crosswalk bridges — never the raw id', () => {
    expect(sleeperLookupId('fleaflicker', 'fl-9', crosswalk)).toBe('9')
    expect(sleeperLookupId('fleaflicker', '4034', crosswalk)).toBeNull()
  })
  it('a Sleeper league’s roster id IS its Sleeper id; an unmatched ESPN id keeps the old fallback', () => {
    expect(sleeperLookupId('sleeper', '4034', crosswalk)).toBe('4034')
    expect(sleeperLookupId('espn', '3139477', crosswalk)).toBe('3139477')
  })
})
