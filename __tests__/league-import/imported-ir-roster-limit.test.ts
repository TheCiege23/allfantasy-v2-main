/**
 * An IMPORTED league's injured-reserve players do not count against its roster limit (owner's call,
 * 2026-10-26; lib/league/rosterLimit.ts). Sleeper's `rosterSize` is `roster_positions.length`, which
 * holds no IR spots — they are `settings.reserve_slots` — so an injured player counted against a limit
 * that never had room for him. Measured read-only that day: of 200 taxi-configured Sleeper NFL
 * leagues, 191 had a team over its own limit with taxi aside, 40 with IR aside too.
 *
 * Native AF leagues are untouched: 'all' (no saved slots) and 'active' (saved slots) count exactly
 * as before. Waiver claims, free-agent adds, the waiver run and trades all read the same count.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirstLeague = vi.fn()
const findUniqueLeague = vi.fn()
const findFirstRoster = vi.fn()
const findManyRoster = vi.fn()
const projectedLegality = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...a: unknown[]) => findFirstLeague(...a), findUnique: (...a: unknown[]) => findUniqueLeague(...a) },
    roster: { findFirst: (...a: unknown[]) => findFirstRoster(...a), findMany: (...a: unknown[]) => findManyRoster(...a) },
    leagueWaiverSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({
  evaluateLegalityForProjectedRoster: (...a: unknown[]) => projectedLegality(...a),
}))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'free_agency', maxDropsPerWeek: null }),
}))

import { countTowardRosterLimit, importedIrOverflow, leagueRosterLimit, uncountedPlayerIds } from '@/lib/league/rosterLimit'
import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'
import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { buildEngineTestLeague, buildEngineTestRoster } from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

/** What the Sleeper import writes (SleeperLeagueCreationBootstrapService): flat arrays + lineup_sections. */
function sleeperRoster(active: string[], ir: string[] = [], taxi: string[] = []) {
  return {
    players: [...active, ...ir, ...taxi],
    starters: active.slice(0, 2),
    reserve: ir,
    taxi,
    lineup_sections: { starters: active.slice(0, 2), bench: active.slice(2), ir, taxi, devy: [] },
  }
}

const SLEEPER = { platform: 'sleeper', sport: 'NFL', settings: { reserve_slots: 2, taxi_slots: 3 }, rosterSize: 3, irSlots: 2 }
const NATIVE = { platform: 'manual', sport: 'NFL', settings: {}, rosterSize: 3, irSlots: 2 }

describe('leagueRosterLimit — which leagues leave IR out', () => {
  it('an imported league with no saved slots counts every player but IR and taxi', () => {
    expect(leagueRosterLimit(SLEEPER, 20)).toEqual({ limit: 3, counts: 'imported', irSlots: 2 })
    expect(leagueRosterLimit({ ...SLEEPER, platform: 'espn', settings: {}, irSlots: 0 }, 20)).toEqual({ limit: 3, counts: 'imported', irSlots: null })
  })

  it('a native league is unchanged — and a row with no platform reads as native, the stricter count', () => {
    expect(leagueRosterLimit(NATIVE, 20)).toEqual({ limit: 3, counts: 'all' })
    expect(leagueRosterLimit({ sport: 'NFL', settings: {}, rosterSize: 3 }, 20)).toEqual({ limit: 3, counts: 'all' })
  })

  it('saved roster slots still win on either kind of league', () => {
    const settings = { roster: { config: { sections: [{ slots: { QB: 1, BN: 2, IR: 1 } }] } } }
    expect(leagueRosterLimit({ ...SLEEPER, settings }, 20)).toEqual({ limit: 3, counts: 'active' })
    expect(leagueRosterLimit({ ...NATIVE, settings }, 20)).toEqual({ limit: 3, counts: 'active' })
  })
})

describe('countTowardRosterLimit', () => {
  it('imported: IR (lineup_sections.ir or the flat reserve array) and taxi are left out', () => {
    expect(countTowardRosterLimit(sleeperRoster(['a', 'b', 'c'], ['hurt'], ['kid']), 'imported')).toBe(3)
    expect(countTowardRosterLimit({ players: ['a', 'hurt'], reserve: ['hurt'] }, 'imported')).toBe(1)
    expect(countTowardRosterLimit({ players: ['a', 'hurt'], lineup_sections: { ir: ['hurt'] } }, 'imported')).toBe(1)
  })

  it('native: IR keeps counting under the legacy rule, exactly as before', () => {
    expect(countTowardRosterLimit(sleeperRoster(['a', 'b', 'c'], ['hurt'], ['kid']), 'all')).toBe(4)
  })

  it('a player filed on IR who has since recovered still does not count until a sync moves him', () => {
    // The slot decides, not the injury status: the import has not re-filed him yet.
    const data = { ...sleeperRoster(['a', 'b', 'c'], ['healed']), player_metadata: { healed: { injury_status: null } } }
    expect(countTowardRosterLimit(data, 'imported')).toBe(3)
    // …and once a sync puts him back on the bench, he counts.
    expect(countTowardRosterLimit(sleeperRoster(['a', 'b', 'c', 'healed']), 'imported')).toBe(4)
  })

  it('an id listed on IR but not on the roster changes nothing', () => {
    expect(countTowardRosterLimit({ players: ['a', 'b'], reserve: ['gone'] }, 'imported')).toBe(2)
  })
})

describe('importedIrOverflow — reported, never enforced', () => {
  it('more IR players than the provider has IR spots', () => {
    const data = sleeperRoster(['a'], ['h1', 'h2', 'h3'])
    expect(importedIrOverflow(data, leagueRosterLimit(SLEEPER, 20))).toEqual({ held: 3, slots: 2 })
    expect(importedIrOverflow(sleeperRoster(['a'], ['h1', 'h2']), leagueRosterLimit(SLEEPER, 20))).toBeNull()
  })
  it('unknown slot count, or a native league: nothing to report', () => {
    const data = sleeperRoster(['a'], ['h1', 'h2', 'h3'])
    expect(importedIrOverflow(data, leagueRosterLimit({ ...SLEEPER, platform: 'espn', settings: {}, irSlots: 0 }, 20))).toBeNull()
    expect(importedIrOverflow(data, leagueRosterLimit(NATIVE, 20))).toBeNull()
  })
})

describe('waiver / free-agent add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectedLegality.mockResolvedValue(null)
    findUniqueLeague.mockResolvedValue({ settings: {} })
  })
  const useLeague = (league: Record<string, unknown>, data: unknown) => {
    findFirstLeague.mockResolvedValue({ id: 'L', lockAllMoves: false, lifecycleState: 'in_season', ...league })
    findFirstRoster.mockResolvedValue({ id: 'r1', playerData: data, faabRemaining: 0 })
    findManyRoster.mockResolvedValue([{ id: 'r1', playerData: data }])
  }
  const add = (onNotice?: (m: string) => void) =>
    assertWaiverClaimEligibility({ leagueId: 'L', rosterId: 'r1', addPlayerId: 'free-agent', dropPlayerId: null, faabBid: 0, onNotice })

  it('🛑 an imported team with two healthy players and one on IR, at a limit of 3, can still add', async () => {
    useLeague(SLEEPER, sleeperRoster(['a', 'b'], ['hurt'], ['kid']))
    await expect(add()).resolves.toBeUndefined()
  })

  it('an imported team with three healthy players must still drop', async () => {
    useLeague(SLEEPER, sleeperRoster(['a', 'b', 'c'], ['hurt']))
    await expect(add()).rejects.toThrow(/roster is already at the limit/)
  })

  it('a native league with the same roster is refused — its IR counting is unchanged', async () => {
    useLeague(NATIVE, sleeperRoster(['a', 'b'], ['hurt']))
    await expect(add()).rejects.toThrow(/roster is already at the limit/)
  })

  it('an over-full imported IR is reported, not refused', async () => {
    useLeague(SLEEPER, sleeperRoster(['a'], ['h1', 'h2', 'h3']))
    const notices: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(add((m) => notices.push(m))).resolves.toBeUndefined()
    warn.mockRestore()
    expect(notices.join(' ')).toMatch(/IR holds 3 players; the imported league has 2 IR spots/)
  })

  it("the lineup template's IR findings do not block an import's add, but still block a native one", async () => {
    // Imports store IR as bare ids, so every IR player reads as `ir_ineligible_status` to the template.
    const result = {
      blockingReasons: [
        { code: 'IR_INELIGIBLE', sourceIssueCode: 'ir_ineligible_status', message: 'Player hurt is not eligible for IR.', section: 'ir' },
        { code: 'SECTION_OVERFLOW', sourceIssueCode: 'section_overflow', message: 'IR has 3 players, max 2.', section: 'ir' },
      ],
      irViolations: [{ playerId: 'hurt', message: 'x' }],
      taxiViolations: [],
      devyViolations: [],
    }
    projectedLegality.mockResolvedValue({ result, week: 3, season: 2026 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const notices: string[] = []
    useLeague(SLEEPER, sleeperRoster(['a'], ['hurt']))
    await expect(add((m) => notices.push(m))).resolves.toBeUndefined()
    expect(notices).toEqual(['Player hurt is not eligible for IR.', 'IR has 3 players, max 2.'])

    useLeague({ ...NATIVE, rosterSize: 10 }, sleeperRoster(['a'], ['hurt']))
    await expect(add()).rejects.toThrow(/resolve IR, taxi, or devy/)
    warn.mockRestore()
  })

  it('a non-IR template finding still blocks an imported add', async () => {
    projectedLegality.mockResolvedValue({
      result: { blockingReasons: [{ code: 'DUPLICATE_PLAYER', sourceIssueCode: 'duplicate_player', message: 'Duplicate player.' }], irViolations: [], taxiViolations: [], devyViolations: [] },
      week: 3,
      season: 2026,
    })
    useLeague(SLEEPER, sleeperRoster(['a'], ['hurt']))
    await expect(add()).rejects.toThrow(/Duplicate player/)
  })
})

describe('trade — the same count as the claim', () => {
  const league = buildEngineTestLeague({ platform: 'sleeper', sport: 'NFL', rosterSize: 3, irSlots: 2, settings: { reserve_slots: 2 } as never })
  const native = buildEngineTestLeague({ platform: 'manual', sport: 'NFL', rosterSize: 3, settings: {} as never })
  const move = (from: string, to: string, player: string) => ({ itemType: 'player' as const, itemReference: player, fromRosterId: from, toRosterId: to, metadata: {} })

  it('an imported receiver with two healthy players and one on IR can take a third', () => {
    const proposer = buildEngineTestRoster('r1', league.id, 'u1', sleeperRoster(['x1']))
    const receiver = buildEngineTestRoster('r2', league.id, 'u2', sleeperRoster(['a', 'b'], ['hurt']))
    const ok = validateTradeAssets({ league, settings: resolveLeagueTradeSettings(league), proposer, receiver, assets: [move('r1', 'r2', 'x1')], currentWeek: 3 })
    expect(ok.ok).toBe(true)
    const refused = validateTradeAssets({ league: native, settings: resolveLeagueTradeSettings(native), proposer, receiver, assets: [move('r1', 'r2', 'x1')], currentWeek: 3 })
    expect(refused).toMatchObject({ ok: false, code: 'ROSTER_ILLEGAL' })
  })

  it('sending away an imported IR player frees no counted spot', () => {
    // r2: three healthy + one IR (3 counted). Gives the IR player, takes one healthy: 3 + 1 = 4 > 3.
    const proposer = buildEngineTestRoster('r1', league.id, 'u1', sleeperRoster(['x1']))
    const receiver = buildEngineTestRoster('r2', league.id, 'u2', sleeperRoster(['a', 'b', 'c'], ['hurt']))
    const v = validateTradeAssets({
      league,
      settings: resolveLeagueTradeSettings(league),
      proposer,
      receiver,
      assets: [move('r1', 'r2', 'x1'), move('r2', 'r1', 'hurt')],
      currentWeek: 3,
    })
    expect(v).toMatchObject({ ok: false, code: 'ROSTER_ILLEGAL' })
  })

  it('claim and trade agree on every roster shape', () => {
    const limit = leagueRosterLimit(league, 999)
    for (const data of [sleeperRoster(['a', 'b'], ['hurt']), sleeperRoster(['a'], ['h1', 'h2'], ['kid']), { players: ['a', 'hurt'], reserve: ['hurt'] }]) {
      const counted = countTowardRosterLimit(data, limit.counts)
      const uncounted = uncountedPlayerIds(data, limit.counts)
      expect(counted + [...uncounted].filter((id) => data.players.includes(id)).length).toBe(data.players.length)
    }
  })
})

describe('every caller selects what the count needs', () => {
  // A select without `platform` reads as native — the stricter count — with nothing failing. Prisma's
  // select is the only place that can drop it, so pin it in the two callers that pass a select.
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
  it.each(['lib/waiver-wire/process-engine.ts', 'lib/waiver-wire/transaction-eligibility.ts'])('%s selects platform and irSlots', (file) => {
    const src = read(file)
    expect(src).toMatch(/^\s*(?:select: \{[^}]*)?platform: true/m)
    expect(src).toMatch(/irSlots: true/)
    expect(src).toMatch(/leagueRosterLimit\(league, 20\)/)
  })
})
