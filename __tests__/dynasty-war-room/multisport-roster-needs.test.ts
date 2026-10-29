/**
 * @vitest-environment node
 *
 * 🛑 EVERY FLEX/UTIL SLOT BECAME RB/WR/TE DEMAND, IN EVERY SPORT.
 *
 * `buildDynastyWarRoomContext` split all flex starters 40/40/20 into RB/WR/TE, so an NBA dynasty
 * roster's two UTIL slots invented RB/WR/TE "needs" that then drove trade targets and waiver adds.
 * NBA/MLB/NHL demand now comes from the sport's own slot catalog; NFL must not move.
 *
 * Drives the real context builder and the real needs engine; only the database and unrelated
 * readers are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Slot = {
  slotName: string
  allowedPositions: string[]
  starterCount: number
  benchCount: number
  reserveCount: number
  taxiCount: number
  devyCount: number
  isFlexibleSlot: boolean
  slotOrder: number
}
const db = vi.hoisted(() => ({
  league: null as unknown,
  rosters: [] as unknown[],
  slots: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league) },
    roster: { findMany: vi.fn(async () => db.rosters) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    rookieDraftWindow: { findMany: vi.fn(async () => []) },
    futureDraftPick: { findMany: vi.fn(async () => []) },
    draftFact: { groupBy: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/league-access', () => ({
  resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })),
}))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ template: { slots: db.slots } })),
}))
vi.mock('@/lib/redraft-war-room/redraftInjuryNews', () => ({
  fetchRedraftInjuryNews: vi.fn(async () => ({ injuryByName: new Map(), newsCount: 0, injuriesAsOf: null })),
  injuryNameKey: (n: string) => String(n ?? '').trim().toLowerCase(),
}))
vi.mock('@/lib/dynasty-war-room/dynastyFreeAgentPool', () => ({
  fetchDynastyValueByKey: vi.fn(async () => new Map()),
  fetchDynastyFreeAgentPool: vi.fn(async () => []),
  dynastyRosteredKeys: () => new Set(),
}))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({
  getEffectiveDynastySettings: vi.fn(async () => null),
}))

import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'
import { evaluateDynastyTeamNeeds } from '@/lib/dynasty-war-room/dynastyRosterNeedsEngine'

let order = 0
function slot(slotName: string, starterCount: number, allowedPositions: string[], isFlexibleSlot = false): Slot {
  return {
    slotName,
    allowedPositions,
    starterCount,
    benchCount: 0,
    reserveCount: 0,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot,
    slotOrder: order++,
  }
}
const bench = (n: number) => ({ ...slot('BN', 0, []), benchCount: n })

/** The NBA dynasty template (lib/nba-roster): PG SG G SF PF F C×2 UTIL×2. */
const NBA_SLOTS = [
  slot('PG', 1, ['PG']),
  slot('SG', 1, ['SG']),
  slot('G', 1, ['PG', 'SG'], true),
  slot('SF', 1, ['SF']),
  slot('PF', 1, ['PF']),
  slot('F', 1, ['SF', 'PF'], true),
  slot('C', 2, ['C']),
  slot('UTIL', 2, ['PG', 'SG', 'SF', 'PF', 'C'], true),
  bench(8),
]
/** The MLB dynasty template's starters. */
const MLB_SLOTS = [
  slot('C', 1, ['C']),
  slot('1B', 1, ['1B']),
  slot('2B', 1, ['2B']),
  slot('3B', 1, ['3B']),
  slot('SS', 1, ['SS']),
  slot('CI', 1, ['1B', '3B'], true),
  slot('MI', 1, ['2B', 'SS'], true),
  slot('OF', 5, ['OF', 'LF', 'CF', 'RF']),
  slot('UTIL', 2, ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'TWP'], true),
  slot('SP', 3, ['SP']),
  slot('RP', 2, ['RP']),
  slot('P', 4, ['SP', 'RP', 'P'], true),
  bench(12),
]
/** The NHL dynasty template's starters. */
const NHL_SLOTS = [
  slot('C', 2, ['C']),
  slot('LW', 2, ['LW']),
  slot('RW', 2, ['RW']),
  slot('D', 4, ['D']),
  slot('UTIL', 2, ['C', 'LW', 'RW', 'D'], true),
  slot('G', 2, ['G']),
  bench(10),
]
/** NFL dynasty: QB RB×2 WR×3 TE FLEX×2 SUPERFLEX. */
const NFL_SLOTS = [
  slot('QB', 1, ['QB']),
  slot('RB', 2, ['RB']),
  slot('WR', 3, ['WR']),
  slot('TE', 1, ['TE']),
  slot('FLEX', 2, ['RB', 'WR', 'TE'], true),
  slot('SUPERFLEX', 1, ['QB', 'RB', 'WR', 'TE'], true),
  bench(15),
]

const SPORT_POSITIONS: Record<string, string[]> = {
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  MLB: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P'],
  NHL: ['C', 'LW', 'RW', 'D', 'G'],
}

function league(sport: string) {
  return { sport, season: 2026, isDynasty: true, leagueVariant: null, platform: 'espn', settings: {} }
}
function rosterOf(players: Array<{ name: string; position: string }>) {
  return [
    {
      id: 'r1',
      platformUserId: 'af-user',
      playerData: {
        lineup_sections: {
          starters: players.map((p, i) => ({ id: `p${i}`, name: p.name, position: p.position })),
        },
      },
      faabRemaining: null,
    },
  ]
}

async function build() {
  const res = await buildDynastyWarRoomContext({ leagueId: 'L1', userId: 'af-user' })
  if (!res.ok) throw new Error(`build failed: ${res.status} ${res.error}`)
  return res.context
}

beforeEach(() => {
  db.rosters = rosterOf([{ name: 'Some Guard', position: 'PG' }])
})

describe.each([
  ['NBA', NBA_SLOTS, 10],
  ['MLB', MLB_SLOTS, 23],
  ['NHL', NHL_SLOTS, 14],
] as const)('%s dynasty roster requirements', (sport, slots, starters) => {
  beforeEach(() => {
    db.league = league(sport)
    db.slots = slots
  })

  it('invents no RB/WR/TE demand from UTIL/flex slots', async () => {
    const ctx = await build()
    const req = ctx.roster.requiredByPosition
    for (const pos of ['RB', 'WR', 'TE', 'QB']) expect(req[pos]).toBeUndefined()
  })

  it('demands only positions the sport has, and exactly as many as it starts', async () => {
    const ctx = await build()
    const req = ctx.roster.requiredByPosition
    for (const pos of Object.keys(req)) expect(SPORT_POSITIONS[sport]).toContain(pos)
    expect(Object.values(req).reduce((a, b) => a + b, 0)).toBe(starters)
    expect(ctx.roster.totalStarterSlots).toBe(starters)
  })

  it('the needs engine never asks this team for an RB, WR or TE', async () => {
    const ctx = await build()
    const needs = evaluateDynastyTeamNeeds(ctx, 'r1')
    const asked = [...needs.tradeTargetPositions, ...needs.needs.map((n) => n.position)]
    for (const pos of ['RB', 'WR', 'TE']) expect(asked).not.toContain(pos)
  })
})

describe('flex demand follows the slot’s own eligibility', () => {
  it('NBA: G/F/UTIL spread over guards, forwards and centers', async () => {
    db.league = league('NBA')
    db.slots = NBA_SLOTS
    const req = (await build()).roster.requiredByPosition
    expect(req).toEqual({ PG: 2, SG: 2, SF: 2, PF: 2, C: 2 })
  })

  it('MLB: UTIL never lands on LF/CF/RF/DH, and P lands on SP/RP', async () => {
    db.league = league('MLB')
    db.slots = MLB_SLOTS
    const req = (await build()).roster.requiredByPosition
    for (const pos of ['LF', 'CF', 'RF', 'DH', 'TWP']) expect(req[pos]).toBeUndefined()
    expect(req.SP + req.RP).toBe(3 + 2 + 4)
    expect(req.OF).toBeGreaterThanOrEqual(5)
  })

  it('NHL: UTIL lands on skaters, never on the goalie', async () => {
    db.league = league('NHL')
    db.slots = NHL_SLOTS
    const req = (await build()).roster.requiredByPosition
    expect(req.G).toBe(2)
    expect(req.C + req.LW + req.RW + req.D).toBe(2 + 2 + 2 + 4 + 2)
  })
})

describe('NFL is unchanged', () => {
  it('FLEX still splits 40/40/20 into RB/WR/TE and SUPERFLEX adds a QB', async () => {
    db.league = league('NFL')
    db.slots = NFL_SLOTS
    const req = (await build()).roster.requiredByPosition
    expect(req).toEqual({ QB: 2, RB: 3, WR: 4, TE: 2 })
  })
})
