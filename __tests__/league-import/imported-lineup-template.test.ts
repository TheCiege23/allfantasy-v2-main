/**
 * An IMPORTED league's lineup template comes from the provider's own roster positions
 * (`settings.roster_positions`), not the AllFantasy default (owner, 2026-10-27;
 * lib/league/importedLineupTemplate.ts). The default made the add/drop gate refuse most adds in
 * imported leagues: measured read-only that day, 4,871 of 6,734 Sleeper NFL rosters overflow it.
 *
 * Fixture shapes are what the importers store: Sleeper's list from SleeperLeagueMapper, the
 * `SLOT:COUNT` pairs from the ESPN / Yahoo / MFL / Fantrax adapters, ESPN's tokens as production
 * holds them (`QB:1`, `D/ST:1`, `BE:7`, `SUPER_FLEX:2`). No provider was called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindFirst, leagueFindUnique, rosterFindFirst, rosterFindMany, rosterTemplateFindUnique } = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  rosterTemplateFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: leagueFindFirst, findUnique: leagueFindUnique },
    roster: { findFirst: rosterFindFirst, findMany: rosterFindMany },
    rosterTemplate: { findUnique: rosterTemplateFindUnique },
    leagueWaiverSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'free_agency', maxDropsPerWeek: null }),
}))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({
  loadLeagueWeekContext: async () => ({ season: 2026, week: 8 }),
  resolveFullLineupLockContext: async () => ({ locked: false, policy: 'kickoff', lockedPlayerIds: [], perPlayerReasons: {} }),
  computePerPlayerKickoffLocks: () => ({ lockedPlayerIds: [] }),
}))

import { importedLineupTemplateSlots, parseProviderRosterPositions, withImportedPlayerPositions } from '@/lib/league/importedLineupTemplate'
import { getRosterTemplate } from '@/lib/multi-sport/RosterTemplateService'
import { getNormalizedLineupSections, getSlotLimitsFromTemplate } from '@/lib/roster/LineupTemplateValidation'
import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'
import { NBA_SLOT_MAP } from '@/lib/nba-roster/NbaRosterTemplates'
import { MLB_SLOT_MAP } from '@/lib/mlb-roster/MlbRosterTemplates'

type Slots = NonNullable<ReturnType<typeof importedLineupTemplateSlots>>
const starters = (slots: Slots) => Object.fromEntries(slots.filter((s) => s.starterCount > 0).map((s) => [s.slotName, s.starterCount]))
const limits = (slots: Slots) => getSlotLimitsFromTemplate({ templateId: 't', sportType: 'NFL', name: 't', formatType: 'standard', slots })
const allowed = (slots: Slots, name: string) => slots.find((s) => s.slotName === name)?.allowedPositions

/** A 2QB / superflex Sleeper dynasty lineup: 10 starters, 15 bench, IR and taxi as settings counts. */
const SLEEPER_SF_POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', ...Array(15).fill('BN')]

describe('importedLineupTemplateSlots — per provider', () => {
  it('Sleeper: one entry per slot; IR and taxi from reserve_slots / taxi_slots', () => {
    const slots = importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: SLEEPER_SF_POSITIONS, reserve_slots: 3, taxi_slots: 5 }, taxiSlots: 0, irSlots: 0 })!
    expect(starters(slots)).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1 })
    expect(limits(slots)).toEqual({ starters: 10, bench: 15, ir: 3, taxi: 5, devy: 0 })
    expect(allowed(slots, 'SUPERFLEX')).toEqual(['QB', 'RB', 'FB', 'WR', 'TE'])
    expect(allowed(slots, 'FLEX')).toEqual(['RB', 'FB', 'WR', 'TE'])
  })

  it('Sleeper: WRRB_FLEX, REC_FLEX, K, DEF and the IDP slots', () => {
    const slots = importedLineupTemplateSlots({
      sport: 'NFL',
      settings: { roster_positions: ['QB', 'RB', 'WR', 'TE', 'WRRB_FLEX', 'REC_FLEX', 'K', 'DEF', 'DL', 'LB', 'DB', 'IDP_FLEX', 'BN', 'BN'] },
    })!
    expect(starters(slots)).toEqual({ QB: 1, RB: 1, WR: 1, TE: 1, WRRB_FLEX: 1, REC_FLEX: 1, K: 1, DST: 1, DL: 1, LB: 1, DB: 1, IDP_FLEX: 1 })
    expect(allowed(slots, 'WRRB_FLEX')).toEqual(['RB', 'FB', 'WR'])
    expect(allowed(slots, 'REC_FLEX')).toEqual(['WR', 'TE'])
    expect(allowed(slots, 'DST')).toEqual(['DEF', 'DST', 'D/ST'])
    expect(allowed(slots, 'DL')).toEqual(['DL', 'DE', 'DT'])
    expect(allowed(slots, 'DB')).toEqual(['DB', 'CB', 'S'])
    expect(allowed(slots, 'IDP_FLEX')).toEqual(['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'])
    // No reserve_slots / taxi_slots stored and the League columns at their 0 default: none.
    expect(limits(slots)).toMatchObject({ bench: 2, ir: 0, taxi: 0 })
  })

  it('ESPN: SLOT:COUNT pairs as production stores them — BE is the bench, IR counted, D/ST is the defence', () => {
    const slots = importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'D/ST:1', 'K:1', 'BE:7', 'IR:1', 'FLEX:1'] } })!
    expect(starters(slots)).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, DST: 1, K: 1, FLEX: 1 })
    expect(limits(slots)).toEqual({ starters: 9, bench: 7, ir: 1, taxi: 0, devy: 0 })
  })

  it('ESPN: superflex, RB/WR and WR/TE slots', () => {
    const slots = importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: ['QB:1', 'RB:1', 'RB/WR:1', 'WR/TE:1', 'SUPER_FLEX:2', 'FLEX:4', 'BE:5', 'IR:2'] } })!
    expect(starters(slots)).toEqual({ QB: 1, RB: 1, WRRB_FLEX: 1, REC_FLEX: 1, SUPERFLEX: 2, FLEX: 4 })
    expect(limits(slots)).toMatchObject({ starters: 10, bench: 5, ir: 2 })
  })

  it('Yahoo: W/R/T, W/T, Q/W/R/T, DEF and the IDP D slot', () => {
    const slots = importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: ['QB:1', 'WR:3', 'RB:2', 'TE:1', 'W/R/T:1', 'W/T:1', 'Q/W/R/T:1', 'K:1', 'DEF:1', 'D:2', 'BN:6', 'IR:2'] } })!
    expect(starters(slots)).toEqual({ QB: 1, WR: 3, RB: 2, TE: 1, FLEX: 1, REC_FLEX: 1, SUPERFLEX: 1, K: 1, DST: 1, IDP_FLEX: 2 })
    expect(limits(slots)).toMatchObject({ bench: 6, ir: 2 })
  })

  it('Yahoo MLB: catalog slots, IL as IR, NA (minors) as taxi', () => {
    const slots = importedLineupTemplateSlots(
      { sport: 'MLB', settings: { roster_positions: ['C:1', '1B:1', '2B:1', '3B:1', 'SS:1', 'OF:3', 'Util:2', 'SP:2', 'RP:2', 'P:4', 'BN:5', 'IL:3', 'NA:2'] } },
      MLB_SLOT_MAP,
    )!
    expect(starters(slots)).toEqual({ C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 2, SP: 2, RP: 2, P: 4 })
    expect(limits(slots)).toMatchObject({ bench: 5, ir: 3, taxi: 2 })
  })

  it('Fantrax NBA: the catalog keys the fetch service maps rosterInfo onto', () => {
    const slots = importedLineupTemplateSlots({ sport: 'NBA', settings: { roster_positions: ['PG:1', 'SG:1', 'SF:1', 'PF:1', 'C:1', 'G:1', 'F:1', 'UTIL:3', 'BN:4'] } }, NBA_SLOT_MAP)!
    expect(starters(slots)).toEqual({ PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3 })
    expect(allowed(slots, 'G')).toEqual(['PG', 'SG'])
    expect(limits(slots)).toMatchObject({ starters: 10, bench: 4 })
  })

  it('MFL: starters and taxi only, no bench size — null, the caller keeps its old template', () => {
    expect(importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: ['QB:1', 'RB:2', 'WR:3', 'TE:1', 'PK:1', 'DEF:1', 'TAXI:3'] } })).toBeNull()
  })

  it('no stored positions (Fleaflicker, Fantrax football), an unknown slot, or a non-football league with no catalog: null', () => {
    expect(importedLineupTemplateSlots({ sport: 'NFL', settings: { rosterSettings: { benchSlots: 10 } } })).toBeNull()
    expect(importedLineupTemplateSlots({ sport: 'NCAAF', settings: { roster_positions: [] } })).toBeNull()
    expect(importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: ['QB:1', 'EDR:1', 'BE:6'] } })).toBeNull()
    expect(importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: ['QB', 'MYSTERY', 'BN'] } })).toBeNull()
    expect(importedLineupTemplateSlots({ sport: 'NBA', settings: { roster_positions: ['PG:1', 'BN:3'] } }, null)).toBeNull()
  })

  it('parses both stored shapes and refuses a mixed one', () => {
    expect(parseProviderRosterPositions(['qb', 'BN'])).toEqual({ entries: [{ token: 'QB', count: 1 }, { token: 'BN', count: 1 }], pairs: false })
    expect(parseProviderRosterPositions(['D/ST:1', 'BE:7'])).toEqual({ entries: [{ token: 'D/ST', count: 1 }, { token: 'BE', count: 7 }], pairs: true })
    expect(parseProviderRosterPositions(['QB:1', 'BN'])).toBeNull()
    expect(parseProviderRosterPositions(null)).toBeNull()
  })
})

describe('withImportedPlayerPositions', () => {
  it('fills bare-id lineup rows from player_metadata, leaves known and unknown positions alone', () => {
    const out = withImportedPlayerPositions({
      players: ['p-qb-101', 'p-wr-102', 'p-xx-103', 'p-te-104'],
      lineup_sections: { starters: ['p-qb-101', { id: 'p-wr-102', position: 'RB' }], bench: ['p-xx-103', 'p-te-104'], ir: [], taxi: [], devy: [] },
      player_metadata: { 'p-qb-101': { position: 'QB' }, 'p-wr-102': { position: 'WR' }, 'p-te-104': { position: 'te' } },
    })
    const sections = getNormalizedLineupSections(out)
    expect(sections.starters.map((r) => [r.id, r.position])).toEqual([['p-qb-101', 'QB'], ['p-wr-102', 'RB']])
    expect(sections.bench.map((r) => [r.id, r.position])).toEqual([['p-xx-103', 'UTIL'], ['p-te-104', 'TE']])
  })
})

function leagueRow(overrides: Record<string, unknown>) {
  return {
    id: 'league-sf-501',
    sport: 'NFL',
    season: 2026,
    leagueType: 'dynasty',
    isDynasty: true,
    leagueVariant: null,
    bestBallMode: false,
    guillotineMode: false,
    keeperPhaseActive: false,
    lifecycleState: 'in_season',
    lockAllMoves: false,
    rosterSize: SLEEPER_SF_POSITIONS.length,
    irSlots: 0,
    taxiSlots: 3,
    taxiAllowNonRookies: true,
    taxiYearsLimit: null,
    irAllowOut: true,
    irAllowCovid: true,
    irAllowSuspended: true,
    irAllowNA: true,
    irAllowDNR: true,
    irAllowDoubtful: true,
    ...overrides,
  }
}

describe('getRosterTemplate — imported leagues', () => {
  beforeEach(() => rosterTemplateFindUnique.mockResolvedValue(null))

  it('an imported Sleeper league resolves its own positions; the same settings on a native league do not', async () => {
    const settings = { roster_positions: SLEEPER_SF_POSITIONS, reserve_slots: 2, taxi_slots: 3 }
    leagueFindUnique.mockResolvedValue(leagueRow({ platform: 'sleeper', settings }))
    const imported = await getRosterTemplate('NFL', 'standard', 'league-sf-501')
    expect(imported.templateId).toBe('imported-sleeper-league-sf-501')
    expect(getSlotLimitsFromTemplate(imported)).toEqual({ starters: 10, bench: 15, ir: 2, taxi: 3, devy: 0 })

    leagueFindUnique.mockResolvedValue(leagueRow({ platform: 'manual', settings }))
    const native = await getRosterTemplate('NFL', 'standard', 'league-sf-501')
    expect(native.templateId).toBe('default-NFL-standard')
  })

  it('an imported league with no stored positions keeps the old resolution', async () => {
    leagueFindUnique.mockResolvedValue(leagueRow({ platform: 'fleaflicker', settings: { taxi_slots: 3 } }))
    expect((await getRosterTemplate('NFL', 'standard', 'league-sf-501')).templateId).toBe('default-NFL-standard')
  })

  it('the provider beats a saved starter_slots layout on an import (8 Sleeper leagues carry one)', async () => {
    leagueFindUnique.mockResolvedValue(
      leagueRow({ platform: 'sleeper', isDynasty: false, leagueType: 'redraft', settings: { roster_positions: SLEEPER_SF_POSITIONS, starter_slots: { QB: 1, RB: 2, WR: 2, TE: 1 } } }),
    )
    const template = await getRosterTemplate('NFL', 'standard', 'league-sf-501')
    expect(template.templateId).toBe('imported-sleeper-league-sf-501')
  })
})

describe('add/drop gate — imported Sleeper 2QB / superflex league', () => {
  // 10 starters (positions on file in player_metadata, as the import stores them), a full 15-man
  // bench, 2 on taxi. Distinct ids throughout: player, roster and league ids never collide.
  const starterIds = ['sl-qb-201', 'sl-rb-202', 'sl-rb-203', 'sl-wr-204', 'sl-wr-205', 'sl-wr-206', 'sl-te-207', 'sl-rb-208', 'sl-wr-209', 'sl-qb-210']
  const starterPositions = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'RB', 'WR', 'QB']
  const benchIds = Array.from({ length: 15 }, (_, i) => `sl-bn-${301 + i}`)
  const taxiIds = ['sl-tx-401', 'sl-tx-402']
  const metadata = Object.fromEntries([
    ...starterIds.map((id, i) => [id, { position: starterPositions[i] }]),
    ...benchIds.map((id) => [id, { position: 'WR' }]),
    ...taxiIds.map((id) => [id, { position: 'RB' }]),
  ])
  const playerData = {
    players: [...starterIds, ...benchIds, ...taxiIds],
    starters: starterIds,
    reserve: [],
    taxi: taxiIds,
    lineup_sections: { starters: starterIds, bench: benchIds, ir: [], taxi: taxiIds, devy: [] },
    player_metadata: metadata,
  }
  const settings = { roster_positions: SLEEPER_SF_POSITIONS, reserve_slots: 2, taxi_slots: 3 }

  function arrange(platform: string) {
    const league = leagueRow({ platform, settings })
    leagueFindFirst.mockResolvedValue(league)
    leagueFindUnique.mockResolvedValue(league)
    rosterFindFirst.mockResolvedValue({ id: 'roster-team-601', playerData, faabRemaining: 100 })
    rosterFindMany.mockResolvedValue([{ id: 'roster-team-601', playerData }, { id: 'roster-other-602', playerData: { players: ['sl-other-901'] } }])
  }
  const claim = () => assertWaiverClaimEligibility({ leagueId: 'league-sf-501', rosterId: 'roster-team-601', addPlayerId: 'sl-fa-701', dropPlayerId: 'sl-bn-305' })

  beforeEach(() => rosterTemplateFindUnique.mockResolvedValue(null))

  it('the default template refuses the add (native league, same roster)', async () => {
    arrange('manual')
    await expect(claim()).rejects.toThrow(/STARTERS has 10 players, max 9|BENCH has 15 players, max 7|TAXI has 2 players, max 0/)
  })

  it("the provider's own template accepts it", async () => {
    arrange('sleeper')
    await expect(claim()).resolves.toBeUndefined()
  })

  it('a bench over the provider\'s own size is still refused', async () => {
    arrange('sleeper')
    const overFull = { ...playerData, players: [...playerData.players, 'sl-bn-399'], lineup_sections: { ...playerData.lineup_sections, bench: [...benchIds, 'sl-bn-399'] } }
    rosterFindFirst.mockResolvedValue({ id: 'roster-team-601', playerData: overFull, faabRemaining: 100 })
    rosterFindMany.mockResolvedValue([{ id: 'roster-team-601', playerData: overFull }])
    await expect(claim()).rejects.toThrow()
  })

  it('a starter with no position on file and a short lineup are reported, not refused', async () => {
    arrange('sleeper')
    const notices: string[] = []
    const short = {
      ...playerData,
      players: playerData.players.filter((id) => id !== 'sl-qb-210'),
      starters: starterIds.slice(0, 9),
      lineup_sections: { ...playerData.lineup_sections, starters: starterIds.slice(0, 9) },
      player_metadata: { ...metadata, 'sl-qb-201': {} },
    }
    rosterFindFirst.mockResolvedValue({ id: 'roster-team-601', playerData: short, faabRemaining: 100 })
    rosterFindMany.mockResolvedValue([{ id: 'roster-team-601', playerData: short }])
    await expect(
      assertWaiverClaimEligibility({ leagueId: 'league-sf-501', rosterId: 'roster-team-601', addPlayerId: 'sl-fa-701', dropPlayerId: 'sl-bn-305', onNotice: (m) => notices.push(m) }),
    ).resolves.toBeUndefined()
    expect(notices.some((m) => /not eligible/.test(m))).toBe(true)
    expect(notices.some((m) => /Not enough starters \(9\/10\)/.test(m))).toBe(true)
  })
})
