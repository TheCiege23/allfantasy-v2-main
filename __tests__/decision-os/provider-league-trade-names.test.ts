/**
 * A trade in an imported Fantrax league stores Fantrax player ids and Fantrax's "Last, First" names.
 * The grade path named players only through `SportsPlayer.sleeperId`, so every such trade fell back to
 * "Judge, Aaron", matched no value on FantasyCalc's chart or the projections board, and was withheld —
 * in every sport, at every league size (Fantrax-scale simulation, 2026-11-07). Worse, a name it DID find
 * was tagged as a Sleeper identity carrying the Fantrax id.
 *
 * Shapes follow production: `PlayerIdentityMap.fantraxId` is written by the import
 * (`linkNflFantraxIdentities`) and the weekly `ingestProFantraxIdentities`; names come from the committed
 * Fantrax captures (`tests/fixtures/fantrax/mlb-player-map-public.json` spells "Judge, Aaron").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  leagues: new Map<string, { platform: string | null; sport: string }>(),
  identities: [] as Array<{ fantraxId: string | null; sleeperId: string | null; canonicalName: string; position: string | null; sport: string }>,
  sportsPlayers: [] as Array<{ sleeperId: string; name: string }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.leagues.get(where.id) ?? null) },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { fantraxId?: { in: string[] }; sport: string } }) =>
        db.identities
          .filter((r) => r.sport === where.sport && r.fantraxId && where.fantraxId?.in.includes(r.fantraxId))
          .map((r) => ({ ...r, currentTeam: null, espnId: null, fleaflickerId: null, mflId: null }))),
    },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { sleeperId?: { in: string[] } } }) =>
        db.sportsPlayers.filter((p) => where.sleeperId?.in.includes(p.sleeperId)).map((p) => ({ ...p, imageUrl: null, position: null, team: null }))),
    },
  },
}))

import { loadNativePlayerNames, providerNameInChartOrder } from '@/lib/decision-os/trade/leagueTradeGrader'
import { gradeInputsFromNativeItems } from '@/lib/decision-os/trade/tradeGradeInputs'

const item = (itemReference: string, playerName: string, position = 'OF') => ({ itemType: 'player', itemReference, metadata: { playerName, position } })

beforeEach(() => {
  db.leagues.clear()
  db.identities = []
  db.sportsPlayers = []
  db.leagues.set('fx-nfl', { platform: 'fantrax', sport: 'NFL' })
  db.leagues.set('fx-mlb', { platform: 'fantrax', sport: 'MLB' })
  db.leagues.set('sl-nfl', { platform: 'sleeper', sport: 'NFL' })
  // Linked: the import / weekly cron put the Fantrax id on his identity row.
  db.identities.push({ fantraxId: '04yk2', sleeperId: '4034', canonicalName: 'Aaron Judge', position: 'OF', sport: 'MLB' })
  db.identities.push({ fantraxId: 'n0006j', sleeperId: '6794', canonicalName: 'Justin Jefferson', position: 'WR', sport: 'NFL' })
  db.sportsPlayers.push({ sleeperId: '6794', name: 'Justin Jefferson' })
})

describe('trade names in a Fantrax league', () => {
  it('names a linked player by his identity, in first-name order', async () => {
    const names = await loadNativePlayerNames([item('04yk2', 'Judge, Aaron')], 'fx-mlb')
    expect(names('04yk2')).toBe('Aaron Judge')
  })

  it('keeps an unlinked player priceable by name, in the order every chart uses', async () => {
    const names = await loadNativePlayerNames([item('03yrz', 'Ohtani, Shohei', 'UT')], 'fx-mlb')
    expect(names('03yrz')).toBe('Shohei Ohtani')
    expect(names.sleeperIdFor?.('03yrz')).toBeNull()
  })

  it('prices an NFL player by the Sleeper id his identity links to — never by the Fantrax id', async () => {
    const items = [item('n0006j', 'Jefferson, Justin', 'WR'), item('n00xyz', 'Nacua, Puka', 'WR')]
    const names = await loadNativePlayerNames(items, 'fx-nfl')
    const inputs = gradeInputsFromNativeItems(items, names)
    expect(inputs.unpriceable).toEqual([])
    expect(inputs.assets).toEqual([
      { kind: 'player', name: 'Justin Jefferson', providerIdentity: { provider: 'sleeper', id: '6794', position: 'WR' } },
      // Unlinked: a name to look up, and no identity at all — a Fantrax id is not a Sleeper id.
      { kind: 'player', name: 'Puka Nacua' },
    ])
  })

  it('leaves a Sleeper league exactly as before', async () => {
    const items = [{ itemType: 'player', itemReference: '6794', metadata: {} }]
    for (const leagueId of ['sl-nfl', undefined]) {
      const names = await loadNativePlayerNames(items, leagueId)
      expect(names('6794')).toBe('Justin Jefferson')
      expect(gradeInputsFromNativeItems(items, names).assets).toEqual([
        { kind: 'player', name: 'Justin Jefferson', providerIdentity: { provider: 'sleeper', id: '6794' } },
      ])
    }
  })
})

describe('providerNameInChartOrder', () => {
  it('turns only Fantrax "Last, First" around', () => {
    expect(providerNameInChartOrder('fantrax', 'Judge, Aaron')).toBe('Aaron Judge')
    expect(providerNameInChartOrder('fantrax', 'Walker Jr., Kenneth')).toBe('Kenneth Walker Jr.')
    expect(providerNameInChartOrder('fantrax', 'Shohei Ohtani')).toBe('Shohei Ohtani')
    expect(providerNameInChartOrder('espn', 'Judge, Aaron')).toBe('Judge, Aaron')
  })
})
