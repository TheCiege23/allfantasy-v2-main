/**
 * The rules sheet loader (lib/league-rules/rulesSheetService.ts): the database and the async
 * loaders are stubbed, every reader that interprets a league is the real one — so these tests fail
 * if the sheet reads a rule from somewhere its league's engine does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  roster: { count: vi.fn(async () => 10) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const access = vi.hoisted(() => ({ ok: true }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => access.ok) }))

const waivers = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: vi.fn(async () => waivers.value) }))

const guillotine = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => guillotine.value) }))

vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: vi.fn(async () => ({
    templateId: 't',
    sportType: 'NBA',
    name: 'NBA',
    formatType: 'standard',
    slots: [
      { slotName: 'PG', starterCount: 1, slotOrder: 1, allowedPositions: ['PG'], isFlexibleSlot: false },
      { slotName: 'SG', starterCount: 1, slotOrder: 2, allowedPositions: ['SG'], isFlexibleSlot: false },
      { slotName: 'UTIL', starterCount: 2, slotOrder: 3, allowedPositions: ['PG', 'SG'], isFlexibleSlot: true },
      { slotName: 'BN', starterCount: 0, slotOrder: 4, allowedPositions: [], isFlexibleSlot: false },
    ],
  })),
}))

import { readRulesSheet } from '@/lib/league-rules/rulesSheetService'

const nativeDynasty = (over: Record<string, unknown> = {}) => ({
  id: 'L1',
  name: 'Hoops Dynasty',
  platform: 'allfantasy',
  sport: 'NBA',
  leagueType: 'dynasty',
  isDynasty: true,
  leagueVariant: null,
  leagueSize: 10,
  scoring: 'points',
  medianGame: true,
  rosterSize: 15,
  irSlots: 2,
  playoffTeams: 6,
  playoffStartWeek: 20,
  tradeDeadlineWeek: 16,
  tradeReviewHours: 24,
  draftPickTrading: true,
  lockAllMoves: false,
  bestBallMode: false,
  guillotineMode: false,
  timezone: 'America/Chicago',
  waiverBudget: 100,
  keeperCount: 3,
  keeperCostSystem: 'round_based',
  keeperRoundPenalty: 1,
  keeperMaxYears: 3,
  taxiSlots: 3,
  taxiYearsLimit: 2,
  taxiAllowNonRookies: false,
  taxiDeadlineWeek: 0,
  settings: {
    commissionerSettings: { tradeReviewMode: 'league_vote', vetoThresholdPercent: 60, tradeDeadlineWeek: 14 },
    pick_trade_deadline: { mode: 'week', week: 18 },
    pick_terms_rule: { enabled: true },
    taxi_stealing: { enabled: true, protectHours: 72, claimsPerSeason: 2 },
    tiebreaker_order: ['head_to_head', 'points_for'],
  },
  leagueSettings: { draftType: 'linear', rounds: 4, pickTimerPreset: '8h', pickTimerCustomValue: null, draftOrderMethod: 'reverse_max_pf', playerPool: 'rookies_only' },
  ...over,
})

const find = (view: { sections: Array<{ rules: Array<{ id: string; value: string; means: string | null; source: string | null }> }> }, id: string) =>
  view.sections.flatMap((s) => s.rules).find((r) => r.id === id)

beforeEach(() => {
  access.ok = true
  waivers.value = { waiverType: 'faab', normalizedWaiverType: 'faab', faabBudget: 250 }
  guillotine.value = null
  db.league.findUnique.mockReset()
})

describe('a native dynasty league', () => {
  it('reads each rule through the reader its engine uses', async () => {
    db.league.findUnique.mockResolvedValue(nativeDynasty())
    const r = await readRulesSheet('L1', 'u1', 'en')
    if (!r.ok) throw new Error('expected a sheet')
    const v = r.view
    expect(v).toMatchObject({ leagueId: 'L1', leagueName: 'Hoops Dynasty', native: true, platform: null })
    expect(v.sections.map((s) => s.id)).toEqual(['format', 'scoring', 'roster', 'waivers', 'trades', 'draft', 'playoffs', 'dynasty'])
    expect(find(v, 'format.type')?.value).toBe('Dynasty')
    expect(find(v, 'roster.starters')?.value).toBe('PG, SG, UTIL1, UTIL2')
    // Waivers from the effective waiver settings, not the League column's 100.
    expect(find(v, 'waivers.budget')?.value).toBe('$250')
    // The commissioner settings' deadline (14) outranks the column (16), as resolveLeagueTradeSettings decides.
    expect(find(v, 'trades.deadline')?.value).toBe('After week 14')
    expect(find(v, 'trades.review')?.means).toBe('The league has 24 hours to vote; 60% of votes against vetoes the trade.')
    expect(find(v, 'trades.pickDeadline')?.value).toBe('After week 18')
    expect(find(v, 'trades.pickTerms')?.value).toBe('On')
    expect(find(v, 'draft.timer')?.value).toBe('8 hours')
    expect(find(v, 'draft.pool')?.value).toBe('Rookies only')
    expect(find(v, 'playoffs.teams')).toMatchObject({ value: '6 teams', source: 'league' })
    expect(find(v, 'playoffs.start')).toMatchObject({ value: 'Week 20', source: 'league' })
    expect(find(v, 'playoffs.tiebreakers')).toMatchObject({ value: '1. Head-to-head  2. Points for', source: 'league' })
    expect(find(v, 'roster.lineups')).toBeTruthy()
    expect(find(v, 'dynasty.taxiStealing')?.means).toContain('72 hours')
  })

  it('in Spanish', async () => {
    db.league.findUnique.mockResolvedValue(nativeDynasty())
    const r = await readRulesSheet('L1', 'u1', 'es')
    if (!r.ok) throw new Error('expected a sheet')
    expect(find(r.view, 'format.type')?.value).toBe('Dinastía')
    expect(find(r.view, 'playoffs.tiebreakers')?.value).toBe('1. Enfrentamiento directo  2. Puntos a favor')
    expect(find(r.view, 'scoring.type')?.value).toBe('Puntos')
    const shown = r.view.sections.flatMap((x) => [x.title, ...x.rules.flatMap((y) => [y.label, y.value, y.means ?? ''])]).join(' ')
    expect(shown.toLowerCase()).not.toContain('waiver')
  })

  it('adds the chop rules for a guillotine league', async () => {
    db.league.findUnique.mockResolvedValue(nativeDynasty({ leagueType: 'redraft', isDynasty: false, guillotineMode: true, settings: { guillotine_advanced: { steps: [], overrides: { '9': 0 }, immunity: 'off' } } }))
    guillotine.value = { teamsPerChop: 1, eliminationStartWeek: 2, eliminationEndWeek: null, tiebreakerOrder: ['bench_points'], rosterReleaseTiming: 'immediate' }
    const r = await readRulesSheet('L1', 'u1', 'en')
    if (!r.ok) throw new Error('expected a sheet')
    const chops = r.view.sections.find((s) => s.id === 'guillotine')!
    expect(chops.rules.map((x) => x.id)).toEqual(['guillotine.chops', 'guillotine.override', 'guillotine.tiebreakers', 'guillotine.release'])
    expect(r.view.sections.find((s) => s.id === 'dynasty')).toBeUndefined()
  })
})

describe('an imported league', () => {
  it('reads only what an import carries and names the platform', async () => {
    db.league.findUnique.mockResolvedValue(
      nativeDynasty({
        platform: 'sleeper',
        sport: 'NFL',
        leagueType: 'redraft',
        isDynasty: false,
        scoring: 'half_ppr',
        settings: { roster_positions: ['QB', 'RB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'IR'], playoff_teams: 4, playoff_week_start: 15 },
        leagueSettings: null,
      }),
    )
    const r = await readRulesSheet('L1', 'u1', 'en')
    if (!r.ok) throw new Error('expected a sheet')
    expect(r.view.platform).toBe('Sleeper')
    expect(r.view.sections.map((s) => s.id)).toEqual(['format', 'scoring', 'roster', 'playoffs'])
    expect(find(r.view, 'roster.starters')?.value).toBe('QB, RB1, RB2, WR, FLEX')
    expect(find(r.view, 'playoffs.teams')?.value).toBe('4 teams')
    // The League column carries a schema default on an import; it is not read.
    expect(find(r.view, 'roster.size')).toBeUndefined()
  })
})

describe('access', () => {
  it('404s a missing league and 403s a stranger, reading nothing more', async () => {
    db.league.findUnique.mockResolvedValue(null)
    expect(await readRulesSheet('L1', 'u1', 'en')).toEqual({ ok: false, status: 404 })
    db.league.findUnique.mockResolvedValue(nativeDynasty())
    access.ok = false
    expect(await readRulesSheet('L1', 'u1', 'en')).toEqual({ ok: false, status: 403 })
  })
})
