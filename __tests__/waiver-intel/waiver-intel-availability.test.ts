import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Waiver Intelligence's "Top available" suggested a ~$600 FAAB bid on Jordan Mason — IR after thumb
 * surgery, expected back around week 7 — to a manager trying to survive one guillotine week
 * (Elimination Station 2, 2026-10-03). The list ranks by season-long market value and never asked
 * who can play THIS week. It now flags those who cannot, says why, and ranks them after everyone who can.
 */

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  absences: new Map<string, unknown>() as Map<string, unknown>,
  absencesThrow: false,
  week: { season: '2026', week: 4 } as { season: string; week: number } | null,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
  },
}))
vi.mock('@/lib/league-context/leagueContextService', () => ({
  getLeagueContext: vi.fn(async () => ({ season: '2026', roster: { starters: { RB: 1 } } })),
}))
vi.mock('@/lib/sports-data/sleeperMarketService', () => ({
  getSeasonStatsBoard: vi.fn(async () => ({ players: {} })),
  getSeasonBoard: vi.fn(async () => ({
    players: {
      mason: { playerId: 'mason', name: 'Jordan Mason', position: 'RB', team: 'MIN' },
      healthy: { playerId: 'healthy', name: 'Healthy Back', position: 'RB', team: 'NYJ' },
      byeguy: { playerId: 'byeguy', name: 'Bye Back', position: 'RB', team: 'KC' },
    },
  })),
}))
vi.mock('@/lib/trade-intel/marketValueService', () => ({
  getMarketValues: vi.fn(async () => ({ mode: 'redraft', faab: { anchorValue: 500, anchorRank: 150 } })),
  // Mason is the most valuable — exactly why he topped the list.
  playerValue: (_v: unknown, id: string) => ({ mason: 574, healthy: 120, byeguy: 300 } as Record<string, number>)[id] ?? null,
}))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: vi.fn(async () => h.week) }))
vi.mock('@/lib/core-app/unavailableStarters', () => ({
  loadAbsencesBySport: vi.fn(async () => {
    if (h.absencesThrow) throw new Error('db down')
    return new Map([['NFL', h.absences]])
  }),
}))

/** Sleeper's API, as the service reads it: one league, two rosters, no transactions. */
function stubSleeper() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = (() => {
        if (/\/league\/L1\/rosters$/.test(url)) return [{ roster_id: 1, owner_id: 'me', players: [], settings: { waiver_budget_used: 0 } }]
        if (/\/league\/L1\/users$/.test(url)) return [{ user_id: 'me', display_name: 'Me' }]
        if (/\/league\/L1\/transactions\/\d+$/.test(url)) return []
        if (/\/league\/L1$/.test(url)) return { league_id: 'L1', season: '2026', status: 'in_season', previous_league_id: null, settings: { waiver_budget: 1000 } }
        return null
      })()
      return { ok: body != null, json: async () => body } as Response
    }),
  )
}

const { getWaiverIntel } = await import('@/lib/waiver-intel/waiverIntelService')

beforeEach(() => {
  h.absences = new Map()
  h.absencesThrow = false
  h.week = { season: '2026', week: 4 }
  stubSleeper()
})
afterEach(() => vi.unstubAllGlobals())

describe('Waiver Intelligence — who can play this week', () => {
  it('flags an IR player, says why, and ranks him after everyone who can play', async () => {
    h.absences = new Map([['mason', { kind: 'ruled_out', status: 'IR' }]])
    const intel = await getWaiverIntel('L1', 'me')
    const names = intel!.targets.map((t) => t.name)
    expect(names[0]).not.toBe('Jordan Mason') // he was first on value alone
    expect(names.at(-1)).toBe('Jordan Mason')
    const mason = intel!.targets.find((t) => t.name === 'Jordan Mason')!
    expect(mason.unavailable).toEqual({ kind: 'ruled_out', status: 'IR' })
    expect(mason.reasoning[0]).toBe('IR — he cannot play this week, so any bid is a stash')
    // The bid stays — a stash is a real move in a dynasty or keeper league.
    expect(mason.suggestedBid).toBe(600)
  })

  it('says "on bye" for a bye, not an injury', async () => {
    h.absences = new Map([['byeguy', { kind: 'bye' }]])
    const intel = await getWaiverIntel('L1', 'me')
    const bye = intel!.targets.find((t) => t.name === 'Bye Back')!
    expect(bye.unavailable).toEqual({ kind: 'bye' })
    expect(bye.reasoning[0]).toMatch(/^on bye this week/)
  })

  it('CONTROL: with nobody out, the list is ranked on value as before and nothing is flagged', async () => {
    const intel = await getWaiverIntel('L1', 'me')
    // By market value: Mason 574, Bye Back 300, Healthy Back 120.
    expect(intel!.targets.map((t) => t.name)).toEqual(['Jordan Mason', 'Bye Back', 'Healthy Back'])
    expect(intel!.targets.every((t) => t.unavailable === undefined)).toBe(true)
  })

  it('fails open: a failed availability read flags nobody', async () => {
    h.absencesThrow = true
    const intel = await getWaiverIntel('L1', 'me')
    expect(intel!.targets[0]!.name).toBe('Jordan Mason')
    expect(intel!.targets.every((t) => t.unavailable === undefined)).toBe(true)
  })
})
