/**
 * A non-Sleeper league's roster id reaches the trade analyzer (2026-11-19).
 *
 * The Trade Center sends a roster player's `playerId` as the league's OWN id — a Fantrax id in a
 * Fantrax league. `getPlayer` keys records by Sleeper-shaped ids, so it missed, and the name search
 * was skipped because a `playerId` was present: an NHL Fantrax trade (Jack Hughes for Brandon Montour
 * + Roope Hintz) came back "Could not resolve 3 players in the NHL database" and never reached the
 * NHL points grader. These pin the repair: the id is read through the platform's identity column,
 * and a miss falls back to the name.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>())
const searchRows = vi.hoisted(() => ({ list: [] as Record<string, unknown>[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/data/players', () => ({
  getPlayer: vi.fn(async (id: string) => rows.get(id) ?? null),
  searchPlayers: vi.fn(async () => searchRows.list),
}))

import { resolveAssets } from '@/lib/trade-value-console/leagueTradePricing'
import type { ResolvedProviderPlayer } from '@/lib/player-identity/resolveProviderRosterPlayers'
import type { ValuationContext } from '@/lib/hybrid-valuation'

const nflCtx = { asOfDate: '2026-11-19', isSuperFlex: false, numTeams: 12, fantasyCalcPlayers: [] } as unknown as ValuationContext

function record(id: string, name: string, position: string, team = 'TST') {
  return {
    id, sport: 'NHL', name, position, team, dataSource: 'provider',
    headshotUrl: null, headshotUrlLg: null, headshotUrlSm: null, logoUrl: null, injuryStatus: null,
  }
}

function identities(map: Record<string, Partial<ResolvedProviderPlayer> & { name: string }>) {
  return vi.fn(async (_platform: string, ids: readonly string[]) => {
    const out = new Map<string, ResolvedProviderPlayer>()
    for (const id of ids) {
      const hit = map[id]
      if (hit) out.set(id, { position: null, team: null, imageUrl: null, sport: 'NHL', sleeperId: null, ...hit })
    }
    return out
  })
}

async function resolveNhl(
  item: { playerId: string; name: string },
  opts: { platform?: string | null; resolveProviderIds?: ReturnType<typeof identities> },
) {
  return resolveAssets([{ kind: 'player', ...item }], {
    effectiveSport: 'NHL', nflCtx, waiverBudget: 100, dataGaps: [], fcPlayers: [], resolveEnrichmentIds: false,
    ...opts,
  })
}

beforeEach(() => {
  rows.clear()
  searchRows.list = []
})

describe('a Fantrax roster id in the trade analyzer', () => {
  it('resolves through the identity map to the linked record', async () => {
    rows.set('9001', record('NHL:9001', 'Jack Hughes', 'C', 'NJ'))
    const resolve = identities({ fx1: { name: 'Jack Hughes', position: 'C', sleeperId: '9001' } })
    const out = await resolveNhl({ playerId: 'fx1', name: 'Jack Hughes' }, { platform: 'fantrax', resolveProviderIds: resolve })
    expect(resolve).toHaveBeenCalledWith('fantrax', ['fx1'], 'NHL')
    expect(out.unresolved).toEqual([])
    expect(out.lines[0]).toMatchObject({ name: 'Jack Hughes', playerId: 'NHL:9001', unpriced: true })
  })

  it('falls back to the name when the identity has no record link', async () => {
    searchRows.list = [record('NHL:hintz', 'Roope Hintz', 'C', 'DAL')]
    const resolve = identities({ fx2: { name: 'Roope Hintz', position: 'C' } })
    const out = await resolveNhl({ playerId: 'fx2', name: 'Roope Hintz' }, { platform: 'fantrax', resolveProviderIds: resolve })
    expect(out.unresolved).toEqual([])
    expect(out.lines[0]).toMatchObject({ name: 'Roope Hintz', playerId: 'NHL:hintz' })
  })

  it('separates namesakes by the identity position', async () => {
    searchRows.list = [record('NHL:aho-c', 'Sebastian Aho', 'C', 'CAR'), record('NHL:aho-d', 'Sebastian Aho', 'D', 'NYI')]
    const resolve = identities({ fx3: { name: 'Sebastian Aho', position: 'D' } })
    const out = await resolveNhl({ playerId: 'fx3', name: 'Sebastian Aho' }, { platform: 'fantrax', resolveProviderIds: resolve })
    expect(out.unresolved).toEqual([])
    expect(out.lines[0]).toMatchObject({ playerId: 'NHL:aho-d' })
  })

  it('keeps the name match when sources label the position differently', async () => {
    searchRows.list = [record('NHL:montour', 'Brandon Montour', 'D', 'SEA')]
    const resolve = identities({ fx4: { name: 'Brandon Montour', position: 'F' } })
    const out = await resolveNhl({ playerId: 'fx4', name: 'Brandon Montour' }, { platform: 'fantrax', resolveProviderIds: resolve })
    expect(out.unresolved).toEqual([])
  })

  it('resolves by name when the id is unknown to the identity map too', async () => {
    searchRows.list = [record('NHL:montour', 'Brandon Montour', 'D', 'SEA')]
    const out = await resolveNhl({ playerId: 'fx-unknown', name: 'Brandon Montour' }, { platform: 'fantrax', resolveProviderIds: identities({}) })
    expect(out.unresolved).toEqual([])
    expect(out.lines[0]).toMatchObject({ playerId: 'NHL:montour' })
  })

  it('still reports a player nobody can find as unresolved', async () => {
    const out = await resolveNhl({ playerId: 'fx-none', name: 'Nobody Atall' }, { platform: 'fantrax', resolveProviderIds: identities({}) })
    expect(out.unresolved).toEqual(['Nobody Atall'])
  })

  it('does not read the identity map for a Sleeper league', async () => {
    rows.set('NHL:5', record('NHL:5', 'Some Skater', 'C'))
    const resolve = identities({})
    const out = await resolveNhl({ playerId: 'NHL:5', name: 'Some Skater' }, { platform: 'sleeper', resolveProviderIds: resolve })
    expect(resolve).not.toHaveBeenCalled()
    expect(out.unresolved).toEqual([])
  })
})
