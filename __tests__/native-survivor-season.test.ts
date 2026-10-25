import { describe, expect, it, vi } from 'vitest'
import { buildSurvivorFullSeasonPlan, readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { getAllowedSportsForType, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { getSurvivorDefaultContract } from '@/lib/league-concepts/survivorDefaults'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { buildNativeLeagueNavigation, nativeLeaguePhase } from '@/lib/league/nativeLeagueNavigation'
import { getAllowedLeagueTypesForSport, getAllowedSportsForLeagueType } from '@/lib/league-creation-wizard/league-type-registry'

describe('NBA Survivor creation pilot and multi-sport season capabilities', () => {
  const now = new Date('2026-09-01T12:00:00Z')
  it.each(['NBA', 'NHL'] as const)('%s offers new creation with its season capabilities', sport => {
    expect(getAllowedSportsForType('survivor').includes(sport)).toBe(true)
    // Owner's call, 2026-10-20: 12–24 managers in 2, 3 or 4 equal tribes.
    expect(getTeamCountOptions(sport, 'survivor')).toEqual([12, 15, 16, 18, 20, 21, 22, 24])
    expect(LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedScoringPresetsByConceptSport.survivor[sport]).toEqual([sport.toLowerCase() + '_points'])
    vi.useFakeTimers(); vi.setSystemTime(now)
    try {
      const result = validateCreatePayload({ concept: 'survivor', sport, scoringPreset: sport.toLowerCase() + '_points', teamCount: 16, draftType: 'snake', leagueName: 'Season test' })
      expect(result.ok, JSON.stringify(result)).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('offers new Survivor creation for NBA, NFL and NHL only, across both wizard paths, and takes paid as a label only', () => {
    // Owner's calls, 2026-10-22: NFL, then NHL, open alongside NBA. MLB has no season calendar yet.
    expect(getAllowedSportsForLeagueType('survivor')).toEqual(['NBA', 'NFL', 'NHL'])
    expect(LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedSportsByConcept.survivor).toEqual(['NBA', 'NFL', 'NHL'])
    for (const sport of ['NBA', 'NFL', 'NHL'] as const) expect(getAllowedLeagueTypesForSport(sport)).toContain('survivor')
    for (const sport of ['MLB', 'NCAAF'] as const) {
      expect(getAllowedLeagueTypesForSport(sport)).not.toContain('survivor')
      expect(getAllowedSportsForType('survivor')).not.toContain(sport)
    }
    // Owner's call, 2026-10-25: every league is free; "paid" only labels dues collected off the app.
    const base = { concept: 'survivor', sport: 'NBA', scoringPreset: 'nba_points', teamCount: 16, draftType: 'snake', leagueName: 'Paid league' } as const
    vi.useFakeTimers(); vi.setSystemTime(now)
    try {
      for (const conceptSetup of [{ survivor_entry_fee_mode: 'paid' }, { survivorEntryFeeMode: 'paid', survivorEntryFeeAmountCents: 2500 }]) {
        const r = validateCreatePayload({ ...base, conceptSetup })
        expect(r.ok, JSON.stringify(r)).toBe(true)
      }
      const bad = validateCreatePayload({ ...base, conceptSetup: { survivorEntryFeeMode: 'paid', survivorEntryFeeAmountCents: -5 } })
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.error).toContain('dues amount')
    } finally { vi.useRealTimers() }
  })
  it.each(['NBA', 'NHL'])('%s uses its real positions and points scoring through both preset layers', sport => {
    const c = getSurvivorDefaultContract({ sport, teamCount: 20 })!
    const f = getLeagueDefaults({ sport, format: 'survivor', draftType: 'snake', managerCount: 20, scoringPreset: sport.toLowerCase() + '_points' })
    expect(c.playerPoolRules.sport).toBe(sport)
    expect(c.playerPoolRules.includeNflPlayers).toBe(false)
    expect(c.rosterTemplate.starterSlots).not.toHaveProperty('QB')
    expect(c.rosterTemplate.starterSlots).not.toHaveProperty('DST')
    expect(c.scoringSettings.scoringMode).toBe('points')
    expect(c.scoringSettings).not.toHaveProperty('ppr')
    expect(f.rosterSettings.starterSlots).toEqual(c.rosterTemplate.starterSlots)
    expect(f.rosterSettings.totalRosterSlots).toBe(c.rosterTemplate.totalRosterSlots)
    expect(f.draftSettings.rounds).toBe(c.rosterTemplate.totalRosterSlots)
    expect(f.playoffSettings.playoffTeams).toBe(0)
    expect(c.survivorStructure.exileSettings.exileEnabled).toBe(true)
  })
  it.each(['NBA', 'NHL'])('%s reaches Final 3 in the last regular-season period for every allowed cast', sport => {
    for (let castSize = 16; castSize <= 20; castSize++) {
      const p = buildSurvivorFullSeasonPlan({ sport, season: 2026, castSize, now })
      expect(p.endWeek).toBe(sport === 'NBA' ? 25 : 28)
      expect(p.eliminationWeeks).toHaveLength(castSize - 3)
      expect(new Set(p.eliminationWeeks).size).toBe(p.eliminationWeeks.length)
      expect(p.eliminationWeeks.at(-1)).toBe(p.endWeek - 1)
      expect(p.noEliminationWeeks).toContain(p.startWeek)
      expect(p.eliminationWeeks).not.toContain(p.startWeek)
      expect(p.eliminationWeeks).not.toContain(p.finaleWeek)
      expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: p })).toEqual(p)
      expect(resolveCreatedSeasonWeeks({ settings: { survivor_full_season_plan: p } }, 17)).toBe(p.endWeek)
    }
  })
  it.each(['NBA', 'NHL'])('%s reserves an additional elimination for one Exile return', sport => {
    const p = buildSurvivorFullSeasonPlan({ sport, season: 2026, castSize: 20, now, exileEnabled: true, exileReturnWeek: 10 })
    expect(p.exileReturnSlots).toBe(1)
    expect(p.eliminationWeeks).toHaveLength(18)
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: p })).toEqual(p)
    expect(20 - p.eliminationWeeks.length + p.exileReturnSlots!).toBe(3)
  })
  it.each(['NBA', 'NHL'])('%s schedules one more elimination for a Final 2 (finalistCount = 2)', sport => {
    const p = buildSurvivorFullSeasonPlan({ sport, season: 2026, castSize: 18, now, finalistCount: 2 })
    expect(p.finalistCount).toBe(2)
    expect(p.eliminationWeeks).toHaveLength(16)
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: p })).toEqual(p)
    // A plan whose schedule does not match its finalist count is rejected.
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: { ...p, finalistCount: 3 } })).toBeNull()
  })
  it('NHL created after opening night starts at the next unplayed period', () => {
    const p = buildSurvivorFullSeasonPlan({ sport: 'NHL', season: 2026, castSize: 20, now: new Date('2026-10-11T12:00:00Z') })
    expect(p.startWeek).toBe(3)
    expect(p.eliminationWeeks.every(w => w > 3)).toBe(true)
  })
  it('NBA creation on opening day starts after the already-open Tuesday period', () => {
    const p = buildSurvivorFullSeasonPlan({ sport: 'NBA', season: 2026, castSize: 20, now: new Date('2026-10-20T16:00:00Z') })
    expect(p.startWeek).toBe(2)
  })
  it('future draft timing can refuse a cast that no longer fits, instead of silently truncating', () => {
    expect(() => buildSurvivorFullSeasonPlan({ sport: 'NBA', season: 2026, castSize: 20, now, draftAt: new Date('2027-03-01T23:00:00Z') })).toThrow('Not enough season remains')
    expect(() => buildSurvivorFullSeasonPlan({ sport: 'NBA', season: 2027, castSize: 16, now })).toThrow('has not been verified')
    // 17 votes in 16 periods no longer refuses: one period holds two back-to-back councils.
    const tight = buildSurvivorFullSeasonPlan({ sport: 'NBA', season: 2026, castSize: 20, now, endWeek: 18 })
    expect(tight.eliminationWeeks).toHaveLength(17)
    expect(new Set(tight.eliminationWeeks).size).toBe(16)
    // Even two per period cannot fit 17 votes into 8 periods.
    expect(() => buildSurvivorFullSeasonPlan({ sport: 'NBA', season: 2026, castSize: 20, now, endWeek: 10 })).toThrow('Not enough season remains')
  })
  it('new NFL Survivor leagues pass validation before and during the season, and refuse a cast that cannot fit', () => {
    vi.useFakeTimers()
    try {
      for (const at of ['2026-09-01T12:00:00Z', '2026-10-22T12:00:00Z']) {
        vi.setSystemTime(new Date(at))
        const result = validateCreatePayload({ concept: 'survivor', sport: 'NFL', scoringPreset: 'fb_half_ppr', teamCount: 12, draftType: 'snake', leagueName: 'NFL island' })
        expect(result.ok, at).toBe(true)
      }
      // Late October leaves too few NFL weeks for a 24-player cast even at two votes per week, so
      // the size is no longer offered, and the server refuses it the same way.
      expect(getTeamCountOptions('NFL', 'survivor')).not.toContain(24)
      expect(getTeamCountOptions('NFL', 'survivor')).toContain(20)
      const late = validateCreatePayload({ concept: 'survivor', sport: 'NFL', scoringPreset: 'fb_half_ppr', teamCount: 24, draftType: 'snake', leagueName: 'Late island' })
      expect(late.ok).toBe(false)
      if (!late.ok) expect(late.errors?.[0]?.path).toBe('teamCount')
      vi.setSystemTime(new Date('2026-09-01T12:00:00Z'))
      expect(getTeamCountOptions('NFL', 'survivor')).toContain(24)
    } finally { vi.useRealTimers() }
  })
  it('rejects a past scheduled draft so autostart cannot begin before managers join', () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    try {
      const result = validateCreatePayload({ concept: 'survivor', sport: 'NBA', scoringPreset: 'nba_points',
        teamCount: 16, draftType: 'snake', leagueName: 'Past draft',
        conceptSetup: { draftDate: '2026-08-31', draftTime: '20:00', draftTimezone: 'America/New_York' } })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('future Survivor draft')
    } finally { vi.useRealTimers() }
  })
  it('corrupt and duplicate elimination schedules are rejected', () => {
    const p = buildSurvivorFullSeasonPlan({ sport: 'NBA', season: 2026, castSize: 20, now })
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: { ...p, eliminationWeeks: Array(17).fill(2) } })).toBeNull()
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: { ...p, startWeek: 0 } })).toBeNull()
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: { ...p, noEliminationWeeks: [] } })).toBeNull()
    expect(readSurvivorFullSeasonPlan({ survivor_full_season_plan: { ...p, regularSeasonLastDay: '2027-05-01' } })).toBeNull()
  })
  it('a daily-sport merge can occur beyond the old NFL week-18 cap', () => {
    expect(normalizeSurvivorFoundationSettings({ mergeWeek: 22 }).mergeWeek).toBe(22)
  })
})

describe('native workspace navigation', () => {
  const tabs = ['native_home', 'home', 'draft', 'roster', 'matchups', 'players', 'waivers', 'trades', 'standings', 'league_chat', 'survivor', 'survivor_tribal', 'commissioner', 'settings'].map(id => ({ id, label: id }))
  it('retains functional tools, gives home one entry, and hides commissioner controls from members', () => {
    const ids = buildNativeLeagueNavigation(tabs, false).flatMap(g => g.items.map(i => i.id))
    expect(ids).toContain('native_home'); expect(ids).toContain('draft'); expect(ids).toContain('survivor_tribal')
    expect(ids).not.toContain('commissioner'); expect(ids).not.toContain('home'); expect(ids).not.toContain('settings')
    expect(buildNativeLeagueNavigation(tabs, true).flatMap(g => g.items.map(i => i.id))).toContain('commissioner')
  })
  it.each([['pre_draft', 'Setup'], ['drafting', 'Draft'], ['in_season', 'Regular season'], ['playoffs', 'Playoffs'], ['completed', 'Offseason']])('uses actual lifecycle %s for %s', (state, label) => {
    expect(nativeLeaguePhase({ lifecycleState: state, status: 'setup' })).toBe(label)
  })
})
