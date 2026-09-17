import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildTradeTargetVerdict,
  loadLeaguePlayerNames,
  locateTarget,
  type TradeTargetDeps,
} from '@/lib/chimmy/tradeTargetVerdict'
import type { RawPlayerMetadataRow } from '@/lib/decision-os/world/facts'
import { indexRosterNames } from '@/lib/chimmy/leagueRosterIndex'
import type { PlayerTradeVisual } from '@/lib/core-app/playerTradeVisual'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

/**
 * "Should I trade for X?" — the facts are read from the asker's own league. The world, the names,
 * the trade read and the weekly feed are injected; the lineup maths (`leagueWeekPricing`,
 * `computeRosterImpact`, `computeLeagueProjectedPoints`) is the real code.
 */

const team = (teamId: string, managerUserId: string, displayName: string, wins: number, losses: number, rank: number) =>
  ({
    teamId,
    managerUserId,
    displayName,
    ownerName: `${displayName} owner`,
    record: { wins, losses, ties: 0 },
    rank,
    pointsFor: 400,
  }) as unknown as CanonicalWorld['teams'][number]

const roster = (rosterId: string, teamId: string, playerIds: string[], reserveIds: string[] = []) =>
  ({ rosterId, teamId, playerIds, reserveIds, taxiIds: [], starterIds: [], benchIds: [] }) as unknown as CanonicalWorld['rosters'][number]

const RULES = { rec: 1, rec_yd: 0.1, rush_yd: 0.1, pass_yd: 0.04 }

function world(over: { sport?: string; slots?: string[] | null } = {}): CanonicalWorld {
  return {
    league: {
      leagueId: 'league-1',
      sport: over.sport ?? 'NFL',
      season: 2026,
      isDynasty: true,
      scoringSettings: RULES,
      rosterSettings: {
        rosterSize: 20,
        starterSlots: over.slots === undefined ? ['QB', 'RB', 'WR', 'WR', 'FLEX'] : over.slots,
        irSlots: 2,
        taxiSlots: 0,
      },
    },
    teams: [
      team('t1', 'viewer-1', 'My Team', 3, 1, 2),
      team('t2', 'rival-2', 'Rival', 1, 3, 11),
      team('t3', 'other-3', 'Third', 2, 2, 6),
    ],
    rosters: [
      roster('r1', 't1', ['p-qb', 'p-rb1', 'p-rb2', 'p-wr1', 'p-wr2', 'p-wr-ir'], ['p-wr-ir']),
      roster('r2', 't2', ['p-rice', 'p-kelce', 'p-allen-qb']),
      roster('r3', 't3', ['p-allen-lb']),
    ],
  } as unknown as CanonicalWorld
}

const NAMES = new Map<string, { name: string | null; position: string | null }>([
  ['p-qb', { name: 'Joe Burrow', position: 'QB' }],
  ['p-rb1', { name: 'Bijan Robinson', position: 'RB' }],
  ['p-rb2', { name: 'Kyren Williams', position: 'RB' }],
  ['p-wr1', { name: 'Garrett Wilson', position: 'WR' }],
  ['p-wr2', { name: 'Jaylen Waddle', position: 'WR' }],
  ['p-wr-ir', { name: 'Chris Godwin', position: 'WR' }],
  ['p-rice', { name: 'Rashee Rice', position: 'WR' }],
  ['p-kelce', { name: 'Travis Kelce', position: 'TE' }],
  ['p-allen-qb', { name: 'Josh Allen', position: 'QB' }],
  ['p-allen-lb', { name: 'Josh Allen', position: 'LB' }],
])

/*
 * This week's component lines. Under RULES:
 *   Burrow 10 · Bijan 9 · Kyren 6.5 · Wilson 11 · Waddle 7 · Rice 15 · Godwin (IR) 12
 * Lineup QB/RB/WR/WR/FLEX without Rice: 10 + 9 + 11 + 7 + 6.5 (Kyren at FLEX) = 43.5
 * With Rice:                            10 + 9 + 15 + 11 + 7   (Waddle at FLEX) = 52.0  → +8.5, Kyren out
 * With Rice, Waddle sent:               10 + 9 + 15 + 11 + 6.5                 = 51.5  → +8.0
 */
const LINES: Record<string, { position: string; componentStats: Record<string, number> }> = {
  'p-qb': { position: 'QB', componentStats: { pass_yd: 250 } },
  'p-rb1': { position: 'RB', componentStats: { rush_yd: 90 } },
  'p-rb2': { position: 'RB', componentStats: { rush_yd: 65 } },
  'p-wr1': { position: 'WR', componentStats: { rec: 5, rec_yd: 60 } },
  'p-wr2': { position: 'WR', componentStats: { rec: 3, rec_yd: 40 } },
  'p-wr-ir': { position: 'WR', componentStats: { rec: 6, rec_yd: 60 } },
  'p-rice': { position: 'WR', componentStats: { rec: 7, rec_yd: 80 } },
}

function visual(over: Partial<PlayerTradeVisual> = {}): PlayerTradeVisual {
  return {
    leagueId: 'league-1',
    leagueName: 'Draft Junkies',
    platform: 'sleeper',
    platformLeagueId: '123',
    season: 2026,
    target: { sleeperId: 'p-rice', name: 'Rashee Rice', position: 'WR', value: 3421, trend30Day: -436, age: 26 },
    you: { teamName: 'My Team', ownerName: null, externalId: '1', stance: 'contender', needs: [], surpluses: ['RB'] },
    partner: { teamName: 'Rival', ownerName: null, externalId: '2', stance: 'rebuilder', needs: ['WR'], surpluses: [] },
    values: { mode: 'dynasty', source: 'fc', fetchedAt: '2026-09-17T00:00:00Z', ppr: 1, numQbs: 1, scoringAdjustment: null },
    packages: [],
    recommended: {
      id: 'pkg-1',
      give: [{ kind: 'player', playerId: 'p-wr2', name: 'Jaylen Waddle', position: 'WR', value: 3300 }],
      receive: [{ kind: 'player', playerId: 'p-rice', name: 'Rashee Rice', position: 'WR', value: 3421 }],
      giveTotal: 3300,
      receiveTotal: 3421,
      delta: 121,
      fairness: 'balanced',
      confidence: 0.8,
      reasons: [],
      warnings: [],
    },
    grade: {
      available: true,
      data: {
        verdict: 'accept',
        verdictConfidence: 'high',
        fairnessScore: 60,
        fairnessDelta: 3,
        starterDeltaPts: 2,
        lineupNote: '',
        acceptance: 0.62,
        explanations: [],
      },
    },
    bidInstead: null,
    tradesAllowed: true,
    ...over,
  }
}

const resolveWorld = vi.fn()
const loadPlayerNames = vi.fn()
const tradeVisual = vi.fn()
const latestWeek = vi.fn()
const loadWeekLines = vi.fn()
let deps: TradeTargetDeps

beforeEach(() => {
  vi.clearAllMocks()
  resolveWorld.mockResolvedValue(world())
  loadPlayerNames.mockResolvedValue(NAMES)
  tradeVisual.mockResolvedValue({ available: true, data: visual() })
  latestWeek.mockResolvedValue({ season: '2026', week: 3 })
  loadWeekLines.mockImplementation(async ({ playerIds }: { playerIds: string[] }) =>
    new Map(playerIds.filter((id) => LINES[id]).map((id) => [id, LINES[id]!])),
  )
  deps = { resolveWorld, loadPlayerNames, tradeVisual, leagueWeek: { latestWeek, loadWeekLines } }
})

const run = (playerName: string, userId = 'viewer-1') =>
  buildTradeTargetVerdict({ playerName, leagueId: 'league-1', userId }, deps)

describe('the verdict is built from this league', () => {
  it('finds him on his roster and prices the trade with the league-scoped read', async () => {
    const r = await run('Rashee Rice')
    expect(r.status).toBe('decided')
    expect(tradeVisual).toHaveBeenCalledWith('league-1', 'p-rice', 'viewer-1')
    if (r.status !== 'decided') return
    expect(r.targetName).toBe('Rashee Rice')
    expect(r.leagueName).toBe('Draft Junkies')
    expect(r.verdict.verdict).toBe('yes')
  })

  it('prices the lineup this week under the LEAGUE\'s rules, with and without him', async () => {
    const r = await run('Rashee Rice')
    if (r.status !== 'decided') throw new Error('expected a verdict')
    const lineup = r.verdict.reasons[0]!
    expect(lineup).toMatch(/Rashee Rice \(15\.0 projected\) would start for you over Kyren Williams — \+8\.5 points in week 3 under Draft Junkies' scoring/)
    expect(lineup).toMatch(/After sending the package below, your lineup moves \+8\.0/)
    // The rules handed to the feed are the league's own, not a default.
    expect(loadWeekLines).toHaveBeenCalledWith(expect.objectContaining({ rules: RULES, week: { season: '2026', week: 3 } }))
  })

  it('a player on injured reserve is not in the lineup maths', async () => {
    await run('Rashee Rice')
    const ids = loadWeekLines.mock.calls.flatMap((c) => c[0].playerIds as string[])
    expect(ids).not.toContain('p-wr-ir')
    expect(ids).toContain('p-rice')
  })

  it('sending an injured-reserve player does not block the lineup read', async () => {
    tradeVisual.mockResolvedValue({
      available: true,
      data: visual({
        recommended: {
          ...visual().recommended!,
          give: [{ kind: 'player', playerId: 'p-wr-ir', name: 'Chris Godwin', position: 'WR', value: 3400 }],
        },
      }),
    })
    const r = await run('Rashee Rice')
    if (r.status !== 'decided') throw new Error('expected a verdict')
    // Godwin cannot start from IR, so sending him leaves the +8.5 intact.
    expect(r.verdict.reasons[0]).toMatch(/your lineup moves \+8\.5/)
  })

  it('a target with no projection this week is named, not called "1 traded player(s)"', async () => {
    loadWeekLines.mockImplementation(async ({ playerIds }: { playerIds: string[] }) =>
      new Map(playerIds.filter((id) => LINES[id] && id !== 'p-rice').map((id) => [id, LINES[id]!])),
    )
    const r = await run('Rashee Rice')
    if (r.status !== 'decided') throw new Error('expected a verdict')
    expect(r.verdict.reasons[0]).toBe("Lineup: not computed — Rashee Rice has no week 3 projection under this league's scoring.")
  })

  it('a package player with no projection is named in the lineup line', async () => {
    loadWeekLines.mockImplementation(async ({ playerIds }: { playerIds: string[] }) =>
      new Map(playerIds.filter((id) => LINES[id] && id !== 'p-wr2').map((id) => [id, LINES[id]!])),
    )
    const r = await run('Rashee Rice')
    if (r.status !== 'decided') throw new Error('expected a verdict')
    expect(r.verdict.reasons[0]).toMatch(/The lineup after paying for him could not be priced: Jaylen Waddle has no week 3 projection\./)
  })

  it('reads the record from the league: 3-1, 2nd of 3', async () => {
    const r = await run('Rashee Rice')
    if (r.status !== 'decided') throw new Error('expected a verdict')
    expect(r.verdict.because).toMatch(/contending at 3-1, 2nd of 3/)
  })

  it('a league the pricing cannot score still gets a verdict, and says the lineup was not computed', async () => {
    resolveWorld.mockResolvedValue(world({ sport: 'NBA' }))
    const r = await run('Rashee Rice')
    if (r.status !== 'decided') throw new Error('expected a verdict')
    expect(r.verdict.reasons[0]).toMatch(/Lineup: not computed — lineup numbers are computed for NFL leagues only/)
    expect(loadWeekLines).not.toHaveBeenCalled()
  })

  it('a league with no lineup slots on file does not invent a lineup', async () => {
    resolveWorld.mockResolvedValue(world({ slots: null }))
    const r = await run('Rashee Rice')
    if (r.status !== 'decided') throw new Error('expected a verdict')
    expect(r.verdict.reasons[0]).toMatch(/starting lineup slots are not on file/)
  })

  it('a no-trade league is a no, even when the read built no bid', async () => {
    tradeVisual.mockResolvedValue({
      available: true,
      data: visual({ tradesAllowed: false, recommended: null, bidInstead: null, grade: { available: false, reason: 'no trades' } }),
    })
    const r = await run('Rashee Rice')
    if (r.status !== 'decided') throw new Error('expected a verdict')
    expect(r.verdict.verdict).toBe('no')
    expect(r.verdict.because).toBe('this league does not allow trades')
  })
})

describe('it refuses rather than guessing who was meant', () => {
  it('a name on no roster', async () => {
    const r = await run('Puka Nacua')
    expect(r).toMatchObject({ status: 'unresolved', reason: 'not_rostered' })
    expect(tradeVisual).not.toHaveBeenCalled()
  })

  it('a name on two rosters', async () => {
    const r = await run('Josh Allen')
    expect(r.status).toBe('unresolved')
    if (r.status !== 'unresolved') return
    expect(r.reason).toBe('ambiguous')
    expect(r.detail).toMatch(/Josh Allen \(QB\), Josh Allen \(LB\)/)
    expect(tradeVisual).not.toHaveBeenCalled()
  })

  it('the asker\'s own player', async () => {
    const r = await run('Garrett Wilson')
    expect(r).toMatchObject({ status: 'unresolved', reason: 'already_yours' })
  })

  it('an asker with no team in the league', async () => {
    const r = await run('Rashee Rice', 'stranger')
    expect(r).toMatchObject({ status: 'unresolved', reason: 'no_team' })
    expect(loadPlayerNames).not.toHaveBeenCalled()
  })

  it('a league that will not load', async () => {
    resolveWorld.mockResolvedValue(null)
    expect(await run('Rashee Rice')).toMatchObject({ status: 'unresolved', reason: 'no_league_world' })
  })

  it('a trade read that cannot answer says why', async () => {
    tradeVisual.mockResolvedValue({ available: false, reason: 'you need a claimed team in this league to build a trade' })
    const r = await run('Rashee Rice')
    expect(r.status).toBe('unresolved')
    if (r.status !== 'unresolved') return
    expect(r.reason).toBe('engine_unavailable')
    expect(r.detail).toMatch(/you need a claimed team in this league to build a trade/)
  })
})

describe('locateTarget', () => {
  const byName = indexRosterNames(world(), NAMES)

  it('a full name matches exactly', () => {
    expect(locateTarget(byName, 'rashee rice').hits.map((h) => h.playerId)).toEqual(['p-rice'])
  })

  it('one word matches a last name', () => {
    expect(locateTarget(byName, 'Rice').hits.map((h) => h.playerId)).toEqual(['p-rice'])
  })

  it('one word shared by two players matches both — the caller refuses', () => {
    expect(locateTarget(byName, 'Allen').hits.map((h) => h.playerId).sort()).toEqual(['p-allen-lb', 'p-allen-qb'])
  })

  it('a full name that is not there matches nothing, and is not retried as a last name', () => {
    expect(locateTarget(byName, 'Jerry Rice').hits).toEqual([])
  })
})

/*
 * 🛑 THE NAMES MUST COME FROM THE RIGHT ID SPACE, AND ALL OF THEM. Measured on staging 2026-09-17:
 * `resolveNames` capped its fallback at 120 rows and ORed `externalId` with `sleeperId`, so a
 * rostered Adam Thielen was "not on any roster". These pin the replacement's two rules.
 */
describe('loadLeaguePlayerNames', () => {
  const row = (over: Partial<RawPlayerMetadataRow>): RawPlayerMetadataRow =>
    ({ externalId: 'x', sleeperId: null, name: null, position: null, team: null, status: null, source: null, ...over }) as RawPlayerMetadataRow

  it('a Sleeper id beats a provider id that happens to be the same number', async () => {
    const loadRows = vi.fn(async () => [
      // A provider row whose externalId is numerically the same as Thielen's Sleeper id — a different person.
      row({ externalId: '4981', sleeperId: null, name: 'Somebody Else', position: 'LB' }),
      row({ externalId: 'rolling:77', sleeperId: '4981', name: 'Adam Thielen', position: 'WR' }),
    ])
    const names = await loadLeaguePlayerNames('NFL', ['4981'], loadRows)
    expect(names.get('4981')).toEqual({ name: 'Adam Thielen', position: 'WR' })
  })

  it('a Sleeper-space row cannot claim another player\'s Sleeper id through its own externalId', async () => {
    const loadRows = vi.fn(async () => [
      row({ externalId: '200', sleeperId: '100', name: 'Player A', position: 'RB' }),
      row({ externalId: 'espn:9', sleeperId: '200', name: 'Player B', position: 'WR' }),
    ])
    const names = await loadLeaguePlayerNames('NFL', ['100', '200'], loadRows)
    expect(names.get('100')?.name).toBe('Player A')
    expect(names.get('200')?.name).toBe('Player B')
  })

  it('reads a whole league, in batches the loader accepts — no cap below the league', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => String(1000 + i))
    const loadRows = vi.fn(async (_sport: string, batch: string[]) =>
      batch.map((id) => row({ externalId: `sleeper:${id}`, sleeperId: null, name: `P${id}`, position: 'WR' })),
    )
    const names = await loadLeaguePlayerNames('NFL', ids, loadRows)
    expect(loadRows).toHaveBeenCalledTimes(3)
    for (const call of loadRows.mock.calls) expect(call[1].length).toBeLessThanOrEqual(200)
    expect(names.size).toBe(450)
    expect(names.get('1449')?.name).toBe('P1449')
  })
})
