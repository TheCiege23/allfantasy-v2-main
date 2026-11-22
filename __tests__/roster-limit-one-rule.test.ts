/**
 * Waivers, free-agent adds and trades enforce ONE roster limit, read from the same saved roster
 * slots the draft is sized from (lib/league/rosterLimit.ts).
 *
 * The case that went wrong, from a real NBA Guilly league: 4 UTIL + 1 Super UTIL + 4 BN + 1 IR.
 * The draft fills 9 active spots; `League.rosterSize` is 10 because it includes the IR spot. Waivers
 * and the league trade engine compared EVERY player to 10, so a team with an empty IR spot could add
 * a 10th healthy player its lineup has no room for. The rule is now the trade runtime's: 9 active
 * spots, and a player sitting in IR does not count against them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirstLeague = vi.fn()
const findUniqueLeague = vi.fn()
const findFirstRoster = vi.fn()
const findManyRoster = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...a: unknown[]) => findFirstLeague(...a), findUnique: (...a: unknown[]) => findUniqueLeague(...a) },
    roster: { findFirst: (...a: unknown[]) => findFirstRoster(...a), findMany: (...a: unknown[]) => findManyRoster(...a) },
    leagueWaiverSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
// NBA adds are checked against the current player pool first; this suite is about the roster limit.
vi.mock('@/lib/waiver-wire/current-nba-player-pool', () => ({ assertCurrentNbaWaiverPlayer: async () => undefined }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForProjectedRoster: async () => null }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'free_agency', maxDropsPerWeek: null }),
}))

import { countTowardRosterLimit, leagueRosterLimit } from '@/lib/league/rosterLimit'
import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'
import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { buildEngineTestLeague, buildEngineTestRoster } from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

/** 4 UTIL + 1 Super UTIL + 4 BN + 1 IR, saved the way the roster editor saves it. */
const NBA_SETTINGS = { roster: { config: { sections: [{ slots: { UTIL: 4, SUPER_UTIL: 1, BN: 4, IR: 1 } }] } } }
const players = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)
/** A roster: `active` healthy players on the bench/starters, `onIr` in the IR spot. */
function playerData(active: string[], onIr: string[] = []) {
  return { players: [...active, ...onIr], lineup_sections: { starters: active.slice(0, 5), bench: active.slice(5), ir: onIr } }
}

describe('leagueRosterLimit', () => {
  it('a league with saved slots: the active spots, with IR left out', () => {
    expect(leagueRosterLimit({ sport: 'NBA', settings: NBA_SETTINGS, rosterSize: 10 }, 20)).toEqual({ limit: 9, counts: 'active' })
  })
  it('a league with no saved slots keeps the old rule: everyone against League.rosterSize', () => {
    expect(leagueRosterLimit({ sport: 'NBA', settings: {}, rosterSize: 13 }, 20)).toEqual({ limit: 13, counts: 'all' })
    expect(leagueRosterLimit({ sport: 'NBA', settings: null, rosterSize: null }, 20)).toEqual({ limit: 20, counts: 'all' })
  })
  it('a player in IR does not count against the active limit', () => {
    const data = playerData(players(8), ['hurt'])
    expect(countTowardRosterLimit(data, 'active')).toBe(8)
    expect(countTowardRosterLimit(data, 'all')).toBe(9)
  })
})

describe('waiver / free-agent add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findFirstLeague.mockResolvedValue({ id: 'L', rosterSize: 10, sport: 'NBA', settings: NBA_SETTINGS, lockAllMoves: false, lifecycleState: 'in_season' })
    findUniqueLeague.mockResolvedValue({ settings: NBA_SETTINGS })
  })
  const add = () => assertWaiverClaimEligibility({ leagueId: 'L', rosterId: 'r1', addPlayerId: 'free-agent', dropPlayerId: null, faabBid: 0 })

  it('🛑 a team with 9 healthy players and an EMPTY IR spot must drop to add a 10th', async () => {
    const data = playerData(players(9))
    findFirstRoster.mockResolvedValue({ id: 'r1', playerData: data, faabRemaining: 0 })
    findManyRoster.mockResolvedValue([{ id: 'r1', playerData: data }])
    await expect(add()).rejects.toThrow(/roster is already at the limit/)
  })

  it('a team with 8 healthy players and one on IR can still add', async () => {
    const data = playerData(players(8), ['hurt'])
    findFirstRoster.mockResolvedValue({ id: 'r1', playerData: data, faabRemaining: 0 })
    findManyRoster.mockResolvedValue([{ id: 'r1', playerData: data }])
    await expect(add()).resolves.toBeUndefined()
  })
})

describe('trade', () => {
  const league = buildEngineTestLeague({ sport: 'NBA', rosterSize: 10, settings: NBA_SETTINGS as never })
  const settings = resolveLeagueTradeSettings(league)
  const oneForNothing = (from: string, to: string, player: string) => [
    { itemType: 'player' as const, itemReference: player, fromRosterId: from, toRosterId: to, metadata: {} },
  ]

  it('🛑 refuses sending a 10th healthy player to a team whose 9 active spots are full', () => {
    const proposer = buildEngineTestRoster('r1', league.id, 'u1', playerData(players(5, 'a')))
    const receiver = buildEngineTestRoster('r2', league.id, 'u2', playerData(players(9, 'b')))
    const v = validateTradeAssets({ league, settings, proposer, receiver, assets: oneForNothing('r1', 'r2', 'a1'), currentWeek: 3 })
    expect(v).toMatchObject({ ok: false, code: 'ROSTER_ILLEGAL' })
  })

  it('allows it when the receiver has an active spot open (its 9th player is on IR)', () => {
    const proposer = buildEngineTestRoster('r1', league.id, 'u1', playerData(players(5, 'a')))
    const receiver = buildEngineTestRoster('r2', league.id, 'u2', playerData(players(8, 'b'), ['hurt']))
    const v = validateTradeAssets({ league, settings, proposer, receiver, assets: oneForNothing('r1', 'r2', 'a1'), currentWeek: 3 })
    expect(v.ok).toBe(true)
  })

  it('sending away an IR player frees no active spot', () => {
    // r2 gives its IR player and takes two healthy ones: 9 active + 1 = 10 > 9.
    const proposer = buildEngineTestRoster('r1', league.id, 'u1', playerData(players(5, 'a')))
    const receiver = buildEngineTestRoster('r2', league.id, 'u2', playerData(players(8, 'b'), ['hurt']))
    const v = validateTradeAssets({
      league,
      settings,
      proposer,
      receiver,
      assets: [...oneForNothing('r1', 'r2', 'a1'), ...oneForNothing('r1', 'r2', 'a2'), ...oneForNothing('r2', 'r1', 'hurt')],
      currentWeek: 3,
    })
    expect(v).toMatchObject({ ok: false, code: 'ROSTER_ILLEGAL' })
  })
})
