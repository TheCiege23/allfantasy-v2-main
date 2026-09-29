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
  sleeperReadablePlayerData,
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
  bench: ['6038'],
  lineup_sections: { starters: [{ id: '4034', position: 'RB' }], bench: [{ id: '6794' }], note: 'kept' },
  settings: { keep: true },
}

describe('isForeignIdSpace', () => {
  it('is the platforms whose ids are the provider’s own', () => {
    for (const p of ['fleaflicker', 'mfl', 'fantrax', 'yahoo', 'Fleaflicker']) expect(isForeignIdSpace(p)).toBe(true)
    for (const p of ['sleeper', 'manual', 'allfantasy', 'af', 'native', 'Native', '', null, undefined, 'espn']) expect(isForeignIdSpace(p)).toBe(false)
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
      bench: [],
      lineup_sections: { starters: [], bench: [], note: 'kept' },
      settings: { keep: true },
    })
  })
})

describe('sleeperReadablePlayerData', () => {
  /*
   * This pinned ESPN as passed through "as the same object". That was the bug: ESPN 12483 is Matthew
   * Stafford and Sleeper 12483 is Jack Bech (2026-09-29, on 8 production ESPN rosters). Without a read
   * this function cannot translate, so it strips ESPN; `sleeperReadableRosters` translates it.
   */
  it('strips a foreign or ESPN roster; returns a Sleeper or native league’s playerData as the same object', () => {
    expect(sleeperReadablePlayerData('fleaflicker', FLEA_PD)).toEqual(stripForeignIds(FLEA_PD))
    expect(sleeperReadablePlayerData('espn', FLEA_PD)).toEqual(stripForeignIds(FLEA_PD))
    expect(sleeperReadablePlayerData('mfl', ['6038', '4034'])).toEqual([])
    for (const p of ['sleeper', 'manual', '', null]) expect(sleeperReadablePlayerData(p, FLEA_PD)).toBe(FLEA_PD)
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
  /* This pinned "an unmatched ESPN id keeps the old fallback" — ESPN 12483 (Stafford) fell back to Sleeper's Jack Bech. */
  it('a Sleeper league’s roster id IS its Sleeper id; an unmatched ESPN id resolves to nothing', () => {
    expect(sleeperLookupId('sleeper', '4034', crosswalk)).toBe('4034')
    expect(sleeperLookupId('manual', '4034', crosswalk)).toBe('4034')
    expect(sleeperLookupId('espn', '12483', crosswalk)).toBeNull()
    expect(sleeperLookupId('espn', '12483', new Map([['12483', '421']]))).toBe('421')
  })
})
