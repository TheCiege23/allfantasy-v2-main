/**
 * NBA / NHL / MLB redraft: ONE roster layout per sport, read by creation, the lineup screen and
 * lineup validation alike (lib/sportConfig/dailySportRedraftRoster.ts).
 *
 * Before this, five definitions of each sport's redraft roster disagreed — e.g. an NBA league was
 * created with 8 starters / 4 bench in `foundation_defaults`, bootstrapped with 10 starters / 3 bench
 * into `nba_roster_config`, validated against 9 starters / 4 bench when no layout was stored, and
 * drafted 13 rounds. Every assertion below compares a reader against the one table, so a copy that
 * drifts again goes red here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  rosterTemplate: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  DAILY_REDRAFT_SPORTS,
  DAILY_REDRAFT_ROSTER_LAYOUTS,
  dailyRedraftDraftableRosterSize,
  dailyRedraftFlexDefinitions,
  dailyRedraftReserveCount,
  dailyRedraftRosterSlotMap,
  dailyRedraftStarterSlotOrder,
  dailyRedraftStarterSlots,
  dailyRedraftTotalRosterSize,
  type DailyRedraftSport,
} from '@/lib/sportConfig/dailySportRedraftRoster'
import {
  getDraftDefaults,
  getRosterDefaults,
  getWaiverDefaults,
} from '@/lib/sport-defaults/SportDefaultsRegistry'
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { normalizeToken, validateRedraftLineup, type RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import { resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveNhlRosterTemplate } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveMlbRosterTemplate } from '@/lib/mlb-roster/MlbRosterTemplates'
import { getSportConfig } from '@/lib/sportConfig'
import { getRosterTemplate } from '@/lib/multi-sport/RosterTemplateService'
import {
  buildDailyRedraftSettingsSnapshot,
  getDailyRedraftDefaultContract,
} from '@/lib/league-concepts/dailySportRedraftDefaults'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { resolveConceptPreset } from '@/lib/league-concepts/resolveConceptPreset'
import { CONCEPT_PRESET_CATALOG } from '@/lib/league-concepts/conceptPresetCatalog'

const DEFAULT_SCORING: Record<DailyRedraftSport, string> = {
  NBA: 'nba_points',
  NHL: 'nhl_points',
  MLB: 'mlb_points',
}

const BOOTSTRAP_TEMPLATE = {
  NBA: () => resolveNbaRosterTemplate('redraft'),
  NHL: () => resolveNhlRosterTemplate('redraft'),
  MLB: () => resolveMlbRosterTemplate('redraft'),
} as const

function sortedCounts(map: Map<string, number> | Record<string, number>): Array<[string, number]> {
  const entries = map instanceof Map ? [...map.entries()] : Object.entries(map)
  return entries
    .map(([k, v]) => [normalizeToken(k), v] as [string, number])
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => a.localeCompare(b))
}

beforeEach(() => {
  prismaMock.league.findUnique.mockReset()
  prismaMock.rosterTemplate.findUnique.mockReset()
  prismaMock.rosterTemplate.findUnique.mockResolvedValue(null)
})

describe('the chosen layouts', () => {
  it('NBA: PG SG G SF PF F C C UTIL UTIL, 3 bench, 2 IL', () => {
    const nba = DAILY_REDRAFT_ROSTER_LAYOUTS.NBA
    expect(dailyRedraftStarterSlotOrder(nba)).toEqual(['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'UTIL', 'UTIL'])
    expect(nba.benchSlots).toBe(3)
    expect(nba.reserveSlots).toEqual({ IL: 2 })
    expect(dailyRedraftDraftableRosterSize(nba)).toBe(13)
  })

  it('NHL: C C LW LW RW RW D D D D UTIL G G, 4 bench, 2 IR', () => {
    const nhl = DAILY_REDRAFT_ROSTER_LAYOUTS.NHL
    expect(dailyRedraftStarterSlotOrder(nhl)).toEqual(['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'D', 'UTIL', 'G', 'G'])
    expect(nhl.benchSlots).toBe(4)
    expect(nhl.reserveSlots).toEqual({ IR: 2 })
    expect(dailyRedraftDraftableRosterSize(nhl)).toBe(17)
  })

  it('MLB: C 1B 2B 3B SS CI MI OF×3 UTIL SP×2 RP×2 P×3, 6 bench, 2 IL + 1 NA', () => {
    const mlb = DAILY_REDRAFT_ROSTER_LAYOUTS.MLB
    expect(dailyRedraftStarterSlotOrder(mlb)).toEqual([
      'C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'OF', 'OF', 'OF', 'UTIL', 'SP', 'SP', 'RP', 'RP', 'P', 'P', 'P',
    ])
    expect(mlb.benchSlots).toBe(6)
    expect(mlb.reserveSlots).toEqual({ IL: 2, NA: 1 })
    expect(dailyRedraftDraftableRosterSize(mlb)).toBe(24)
  })
})

describe.each(DAILY_REDRAFT_SPORTS)('%s — one source', (sport) => {
  const layout = DAILY_REDRAFT_ROSTER_LAYOUTS[sport]

  it('the sport-defaults registry is the layout', () => {
    const roster = getRosterDefaults(sport)
    expect(roster.starter_slots).toEqual(dailyRedraftStarterSlots(layout))
    expect(roster.bench_slots).toBe(layout.benchSlots)
    expect(roster.IR_slots).toBe(dailyRedraftReserveCount(layout))
    expect(roster.flex_definitions).toEqual(dailyRedraftFlexDefinitions(layout))
  })

  it('draft rounds = roster size (starters + bench), and waivers run Mon/Wed/Fri', () => {
    expect(getDraftDefaults(sport).rounds_default).toBe(dailyRedraftDraftableRosterSize(layout))
    expect(getWaiverDefaults(sport).processing_days).toEqual([1, 3, 5])
  })

  it('the redraft sport config (validation defaults) is the layout', () => {
    const cfg = getRedraftSportConfig(sport)
    expect(cfg.starterSlots).toEqual(dailyRedraftStarterSlotOrder(layout))
    expect(cfg.benchSlots).toBe(layout.benchSlots)
    expect(cfg.irSlots).toBe(dailyRedraftReserveCount(layout))
    expect(cfg.totalRosterSize).toBe(dailyRedraftTotalRosterSize(layout))
    expect(cfg.defaultDraftRounds).toBe(dailyRedraftDraftableRosterSize(layout))
    expect(cfg.defaultWaiverProcessDays).toEqual([1, 3, 5])
    for (const flex of dailyRedraftFlexDefinitions(layout)) {
      expect(cfg.flexPositions[flex.slotName]).toEqual(flex.allowedPositions)
    }
  })

  it('the roster-engine redraft template (what bootstrap installs) is the layout', () => {
    expect(BOOTSTRAP_TEMPLATE[sport]().slots).toEqual(dailyRedraftRosterSlotMap(layout))
  })

  it('the sport config default roster slots are the layout', () => {
    const cfg = getSportConfig(sport)
    const defaults: Record<string, number> = {}
    for (const slot of cfg.defaultRosterSlots) if (slot.defaultCount > 0) defaults[slot.key] = slot.defaultCount
    expect(defaults).toEqual(dailyRedraftStarterSlots(layout))
    expect(cfg.defaultBenchSlots).toBe(layout.benchSlots)
    expect(cfg.defaultIRSlots).toBe(dailyRedraftReserveCount(layout))
  })
})

describe.each(DAILY_REDRAFT_SPORTS)('%s — league creation uses it', (sport) => {
  const layout = DAILY_REDRAFT_ROSTER_LAYOUTS[sport]
  const scoringPreset = DEFAULT_SCORING[sport]

  it('has a redraft concept preset in the catalog sized from the layout', () => {
    const seed = CONCEPT_PRESET_CATALOG.find((p) => p.sport === sport && p.leagueType === 'redraft')
    expect(seed).toBeTruthy()
    expect(seed!.scoringPreset).toBe(scoringPreset)
    expect(seed!.rosterSlots).toBe(Object.values(dailyRedraftStarterSlots(layout)).reduce((a, b) => a + b, 0))
    expect(seed!.benchSlots).toBe(layout.benchSlots)
    expect(seed!.irSlots).toBe(dailyRedraftReserveCount(layout))
  })

  it('the redraft default contract carries the layout, rounds, waivers and playoffs', () => {
    const contract = getDailyRedraftDefaultContract({ sport, draftType: 'snake', scoringPresetId: null, teamCount: 12 })
    expect(contract).toBeTruthy()
    expect(contract!.scoring_preset_id).toBe(scoringPreset)
    expect(contract!.rosterTemplate.starterSlots).toEqual(dailyRedraftStarterSlots(layout))
    expect(contract!.rosterTemplate.starterSlotOrder).toEqual(dailyRedraftStarterSlotOrder(layout))
    expect(contract!.rosterTemplate.rosterSlotMap).toEqual(dailyRedraftRosterSlotMap(layout))
    expect(contract!.rounds).toBe(dailyRedraftDraftableRosterSize(layout))
    expect(contract!.waiverSettings.processingDays).toEqual([1, 3, 5])
    expect(contract!.playoffSettings.playoffTeams).toBe(6)
  })

  it('fits the playoff bracket to a small league', () => {
    const contract = getDailyRedraftDefaultContract({ sport, draftType: 'snake', scoringPresetId: null, teamCount: 5 })
    expect(contract!.playoffSettings.playoffTeams).toBe(4)
  })

  it('getLeagueDefaults (the creation foundation) resolves the same roster and rounds', () => {
    const d = getLeagueDefaults({ sport, format: 'redraft', draftType: 'snake', managerCount: 12, scoringPreset })
    expect(d.rosterSettings.starterSlots).toEqual(dailyRedraftStarterSlots(layout))
    expect(d.rosterSettings.starter_slots).toEqual(dailyRedraftStarterSlots(layout))
    expect(d.rosterSettings.benchSlots).toBe(layout.benchSlots)
    expect(d.rosterSettings.irSlots).toBe(dailyRedraftReserveCount(layout))
    expect(d.rosterSettings.totalRosterSlots).toBe(dailyRedraftTotalRosterSize(layout))
    expect(d.draftSettings.rounds).toBe(dailyRedraftDraftableRosterSize(layout))
    expect(d.waiverSettings.processingDays).toEqual([1, 3, 5])
    expect(d.waiverSettings.processing_days).toEqual([1, 3, 5])
    expect(d.conceptPreset.presetKey).toContain(`concept=redraft|sport=${sport}`)
  })

  it('the preset engine snapshot (persisted League.settings) carries the same roster', () => {
    const out = runPresetEngine({
      concept: 'redraft',
      sport,
      teamCount: 12,
      draftType: 'snake',
      scoringPreset,
      leagueName: 'L',
      commissionerId: 'u1',
    })
    const snap = out.settingsSnapshot as Record<string, any>
    expect(snap.rosterSettings.starterSlots).toEqual(dailyRedraftStarterSlots(layout))
    expect(snap.starter_slots).toEqual(dailyRedraftStarterSlots(layout))
    expect(snap.bench_slots).toBe(layout.benchSlots)
    expect(snap.ir_slots).toBe(dailyRedraftReserveCount(layout))
    expect(snap.draftSettings.rounds).toBe(dailyRedraftDraftableRosterSize(layout))
    expect(snap.waiverSettings.processingDays).toEqual([1, 3, 5])
  })

  it('the concept-preset resolver (legacy create route) resolves the real preset', () => {
    const r = resolveConceptPreset({ sport, leagueType: 'redraft', scoringPreset, draftType: 'snake' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.settingsSnapshot.conceptPresetKey).toBe(r.preset.presetKey)
    expect(r.settingsSnapshot.starter_slots).toEqual(dailyRedraftStarterSlots(layout))
    expect(r.settingsSnapshot.draft_rounds).toBe(dailyRedraftDraftableRosterSize(layout))
  })

  it('[control] football redraft is untouched by the daily contract', () => {
    expect(getDailyRedraftDefaultContract({ sport: 'NFL' })).toBeNull()
    expect(buildDailyRedraftSettingsSnapshot({ sport: 'NCAAF' })).toBeNull()
  })
})

describe.each(DAILY_REDRAFT_SPORTS)('%s — lineup screen and validation agree with it', (sport) => {
  const layout = DAILY_REDRAFT_ROSTER_LAYOUTS[sport]
  const expectedStarters = sortedCounts(dailyRedraftStarterSlots(layout))

  function createdLeagueSettings(): Record<string, unknown> {
    // What a new league stores: the creation snapshot, then the bootstrap's `<sport>_roster_config`.
    const snapshot = buildDailyRedraftSettingsSnapshot({ sport, teamCount: 12 }) ?? {}
    return {
      ...snapshot,
      [`${sport.toLowerCase()}_roster_config`]: { templateKey: 'redraft', slots: BOOTSTRAP_TEMPLATE[sport]().slots },
    }
  }

  it('validation reads the created league as the layout', () => {
    const rc = resolveRedraftRosterConfig(sport, createdLeagueSettings())
    expect(sortedCounts(rc.starterCapacities)).toEqual(expectedStarters)
    expect(rc.benchSlots).toBe(layout.benchSlots)
    expect(rc.irSlots).toBe(dailyRedraftReserveCount(layout))
  })

  it('validation reads the commissioner-saved `<sport>_roster_config` when no other layout is stored', () => {
    const slots = { ...dailyRedraftRosterSlotMap(layout), BN: layout.benchSlots + 2 }
    const rc = resolveRedraftRosterConfig(sport, { [`${sport.toLowerCase()}_roster_config`]: { slots } })
    expect(rc.source).toBe('commissioner')
    expect(rc.benchSlots).toBe(layout.benchSlots + 2)
    expect(sortedCounts(rc.starterCapacities)).toEqual(expectedStarters)
  })

  it('validation defaults (no stored layout) are the layout', () => {
    const rc = resolveRedraftRosterConfig(sport, {})
    expect(rc.source).toBe('defaults')
    expect(sortedCounts(rc.starterCapacities)).toEqual(expectedStarters)
    expect(rc.benchSlots).toBe(layout.benchSlots)
  })

  it('the lineup screen template for the created league is the layout', async () => {
    prismaMock.league.findUnique.mockResolvedValue({ sport, settings: createdLeagueSettings() })
    const template = await getRosterTemplate(sport, 'standard', 'league-1')
    const starters: Record<string, number> = {}
    for (const slot of template.slots) if (slot.starterCount > 0) starters[slot.slotName] = slot.starterCount
    expect(sortedCounts(starters)).toEqual(expectedStarters)
    expect(template.slots.reduce((n, s) => n + s.benchCount, 0)).toBe(layout.benchSlots)
    expect(template.slots.reduce((n, s) => n + s.reserveCount, 0)).toBe(dailyRedraftReserveCount(layout))
  })

  it('the lineup screen in-memory default (no stored layout, no DB template) is the layout', async () => {
    prismaMock.league.findUnique.mockResolvedValue({ sport, settings: {} })
    const template = await getRosterTemplate(sport, 'standard', 'league-1')
    const starters: Record<string, number> = {}
    for (const slot of template.slots) if (slot.starterCount > 0) starters[slot.slotName] = slot.starterCount
    expect(sortedCounts(starters)).toEqual(expectedStarters)
    expect(template.slots.reduce((n, s) => n + s.benchCount, 0)).toBe(layout.benchSlots)
  })

  it('a lineup that fills every layout seat validates clean, and one extra starter does not', () => {
    const rosterConfig = resolveRedraftRosterConfig(sport, createdLeagueSettings())
    const players: RedraftLineupPlayer[] = dailyRedraftStarterSlotOrder(layout).map((slot, i) => ({
      playerId: `p${i}`,
      playerName: `Player ${i}`,
      position: layout.starters.find((s) => s.key === slot)!.eligiblePositions[0]!,
      sport,
      slotType: slot,
    }))
    const ok = validateRedraftLineup({ sport, week: 1, players, rosterConfig })
    expect(ok.issues.filter((i) => i.severity === 'error')).toEqual([])

    const first = layout.starters[0]!
    const over = validateRedraftLineup({
      sport,
      week: 1,
      players: [...players, { playerId: 'extra', playerName: 'Extra', position: first.eligiblePositions[0]!, sport, slotType: first.key }],
      rosterConfig,
    })
    expect(over.errorCount).toBeGreaterThan(0)
  })
})
