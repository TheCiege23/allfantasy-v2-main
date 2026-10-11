/**
 * A player TYPED by name in the open analyzer (no id, no provider identity), outside the NFL.
 *
 * `sports_players` holds a player once per source, so an exact name usually has several rows — and the
 * resolver accepted a name only when exactly one row carried it. "Tarik Skubal" and "Juan Soto" were
 * refused as spelling mistakes on 2026-10-11 while the same players picked from the search graded.
 * `PlayerIdentityMap` (one row per athlete) now decides whether the rows are one person or namesakes.
 * Rows below are production's for those names that day.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePlayerName } from '@/lib/team-abbrev'

type Row = { id: string; sport: string; name: string; team: string; position: string; lastUpdated: Date }
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  people: [] as Array<{ sport: string; normalizedName: string; rollingInsightsId: string | null }>,
  identityFails: false,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findMany: vi.fn(async ({ where, take }: { where: { sport: string; normalizedName: string }; take?: number }) => {
        if (db.identityFails) throw new Error('db down')
        return db.people.filter((p) => p.sport === where.sport && p.normalizedName === where.normalizedName).slice(0, take ?? 1000)
      }),
    },
  },
}))
vi.mock('@/lib/data/players', () => ({
  getPlayer: vi.fn(async () => null),
  // Newest first, as the real search orders them.
  searchPlayers: vi.fn(async (query: string, sport: string) =>
    db.rows
      .filter((r) => r.sport === sport && r.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())),
}))

import { prisma } from '@/lib/prisma'
import { resolveAssets } from '@/lib/trade-value-console/leagueTradePricing'
import type { ValuationContext } from '@/lib/hybrid-valuation'

const nflCtx = { asOfDate: '2026-10-11', isSuperFlex: false, numTeams: 12, fantasyCalcPlayers: [] } as unknown as ValuationContext

function row(id: string, name: string, team: string, position: string, updated: string) {
  db.rows.push({ id, sport: 'MLB', name, team, position, lastUpdated: new Date(updated) })
}
function person(name: string, rollingInsightsId: string | null) {
  db.people.push({ sport: 'MLB', normalizedName: normalizePlayerName(name), rollingInsightsId })
}
async function typed(name: string) {
  return resolveAssets([{ kind: 'player', name }], {
    effectiveSport: 'MLB', nflCtx, waiverBudget: 100, dataGaps: [], fcPlayers: [], resolveEnrichmentIds: false,
  })
}

beforeEach(() => {
  db.rows = []
  db.people = []
  db.identityFails = false
  vi.mocked(prisma.playerIdentityMap.findMany).mockClear()
})

describe('a typed non-NFL name', () => {
  it('resolves one person filed under several sources, on his Rolling Insights row', async () => {
    // The name-slug copy is the newest row; the current club lives on the RI row.
    row('MLB:juan-soto:NEW YORK METS', 'Juan Soto', 'NYM', 'LF', '2026-10-11T13:57:02Z')
    row('MLB:2354', 'Juan Soto', 'NYM', 'LF', '2026-09-25T06:13:05Z')
    row('MLB:tsdb_34166384', 'Juan Soto', 'NYM', 'OF', '2026-09-25T00:20:48Z')
    person('Juan Soto', '2354')
    const out = await typed('Juan Soto')
    expect(out.unresolved).toEqual([])
    expect(out.lines[0]).toMatchObject({ playerId: 'MLB:2354', team: 'NYM' })
  })

  it('takes the current club from that row, not from an old copy', async () => {
    row('MLB:4037', 'Tarik Skubal', 'LAD', 'P', '2026-09-11T06:12:09Z')
    row('MLB:tsdb_34185498', 'Tarik Skubal', 'LAD', 'P', '2026-09-11T00:20:30Z')
    row('MLB:tarik-skubal:DETROIT TIGERS', 'Tarik Skubal', 'DETROIT TIGERS', 'P', '2026-04-26T12:00:58Z')
    person('Tarik Skubal', '4037')
    const out = await typed('Tarik Skubal')
    expect(out.unresolved).toEqual([])
    expect(out.lines[0]).toMatchObject({ playerId: 'MLB:4037', team: 'LAD', position: 'P' })
  })

  it('leaves namesakes unresolved — two athletes share the name', async () => {
    row('MLB:will-smith:KANSAS CITY ROYALS', 'Will Smith', 'KC', 'P', '2026-10-11T13:57:14Z')
    row('MLB:2728', 'Will Smith', 'LAD', 'C', '2026-09-18T06:13:06Z')
    row('MLB:tsdb_34179489', 'Will Smith', 'LAD', 'P', '2026-09-11T00:20:23Z')
    person('Will Smith', '2728')
    person('Will Smith', '215')
    const out = await typed('Will Smith')
    expect(out.unresolved).toEqual(['Will Smith'])
    expect(out.lines).toEqual([])
  })

  it('takes the newest copy when the one person has no Rolling Insights id', async () => {
    row('MLB:x-newer', 'Only Person', 'SEA', 'P', '2026-10-01T00:00:00Z')
    row('MLB:x-older', 'Only Person', 'SEA', 'P', '2026-04-01T00:00:00Z')
    person('Only Person', null)
    const out = await typed('Only Person')
    expect(out.lines[0]).toMatchObject({ playerId: 'MLB:x-newer' })
  })

  it('stays unresolved when nobody by that name is on the identity map, or it cannot be read', async () => {
    row('MLB:a', 'Copy Name', 'SEA', 'P', '2026-10-01T00:00:00Z')
    row('MLB:b', 'Copy Name', 'SEA', 'P', '2026-09-01T00:00:00Z')
    expect((await typed('Copy Name')).unresolved).toEqual(['Copy Name'])
    person('Copy Name', 'a')
    db.identityFails = true
    expect((await typed('Copy Name')).unresolved).toEqual(['Copy Name'])
  })

  it('does not ask the identity map when one row carries the name', async () => {
    row('MLB:9', 'Single Row', 'SEA', 'P', '2026-10-01T00:00:00Z')
    const out = await typed('Single Row')
    expect(out.lines[0]).toMatchObject({ playerId: 'MLB:9' })
    expect(prisma.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })

  it('never counts a longer name as an exact match', async () => {
    row('MLB:1', 'Juan Soto', 'NYM', 'LF', '2026-10-01T00:00:00Z')
    row('MLB:2', 'Juan Soto Jr', 'AAA', 'SS', '2026-10-02T00:00:00Z')
    const out = await typed('Juan Soto')
    expect(out.lines[0]).toMatchObject({ playerId: 'MLB:1' })
  })
})
