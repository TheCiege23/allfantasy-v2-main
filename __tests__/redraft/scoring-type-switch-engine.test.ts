import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a scoring-type switch does to data (lib/category-scoring/leagueScoringType.ts):
 *   - a week before `effectiveFromWeek` keeps scoring under the type it was played under, even when
 *     it is re-scored later (a stat correction);
 *   - that week and every later one score under the new type and the edited category list;
 *   - a league that never switched or edited its list reads exactly as before.
 */

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), update: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { updateMatchupScores } from '@/lib/redraft/scoringEngine'
import { getCategoryPresetDefinitions } from '@/lib/category-scoring'
import {
  applyScoringTypeChange,
  readScoringType,
  resolveLeagueCategories,
  settingsForScoringWeek,
  validateScoringTypeChange,
} from '@/lib/category-scoring/leagueScoringType'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'

const HOME_STATS = { hr: 3, r: 4, rbi: 5, sb: 1, h: 3, ab: 10, outs: 18, er: 1, p_h: 2, p_bb: 1, so: 10, w: 1, sv: 0 }
const AWAY_STATS = { hr: 1, r: 2, rbi: 3, sb: 0, h: 2, ab: 10, outs: 18, er: 3, p_h: 5, p_bb: 1, so: 6, w: 0, sv: 1 }

/** Points in weeks 1-3, switched to H2H 5x5 (custom list: HR then R) from week 4 of 2026. */
const SWITCHED = {
  scoring_mode: 'h2h_category',
  category_preset_id: 'mlb_5x5',
  category_record_mode: 'each',
  category_ids: ['hr', 'r'],
  scoring_type_history: [
    {
      season: 2026,
      effectiveFromWeek: 4,
      previous: { mode: 'points', presetId: null, recordMode: null, categoryIds: null },
      changedAt: '2026-05-01T00:00:00.000Z',
      changedBy: 'u1',
    },
  ],
}

function arrange(settings: Record<string, unknown>, week: number) {
  db.league.findFirst.mockResolvedValue({ sport: 'MLB', settings })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'MLB' })
  db.redraftMatchup.findFirst.mockResolvedValue({
    id: 'm1', leagueId: 'L1', seasonId: 's1', week, homeRosterId: 'home', awayRosterId: 'away',
    homeRoster: {}, homeScore: 0, awayScore: 0, lineupSnapshots: null,
  })
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: string } }) => [
    { playerId: where.rosterId, position: 'OF', slotType: 'OF', sport: 'MLB', rosterId: where.rosterId, droppedAt: null },
  ])
  db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => ({
    stats: where.playerId_week_season_sport.playerId === 'home' ? HOME_STATS : AWAY_STATS,
    isFinalized: true,
  }))
  db.redraftMatchup.update.mockResolvedValue({})
}

const written = () => db.redraftMatchup.update.mock.calls[0][0].data as Record<string, any>

beforeEach(() => vi.clearAllMocks())

describe('a switched league scores each week under the type in force that week', () => {
  it('a week BEFORE the switch (re-scored after it) still scores as points — no category result', async () => {
    arrange(SWITCHED, 3)
    await updateMatchupScores('m1')
    expect(written().lineupSnapshots).not.toHaveProperty('categoryMatchup')
  })

  it('the switch week scores the edited list, in its order, as category wins', async () => {
    arrange(SWITCHED, 4)
    const result = await updateMatchupScores('m1')
    const snap = written().lineupSnapshots
    expect(snap.categoryRecordMode).toBe('each')
    expect(snap.categoryMatchup.categories.map((c: { categoryId: string }) => c.categoryId)).toEqual(['hr', 'r'])
    expect(result).toMatchObject({ homeScore: 2, awayScore: 0 })
  })

  it('the same history does not reach another season', async () => {
    arrange(SWITCHED, 3)
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2027, sport: 'MLB' })
    await updateMatchupScores('m1')
    expect(written().lineupSnapshots.categoryMatchup.aWins).toBe(2)
  })
})

describe('defaults unchanged', () => {
  const PRESET_ONLY = { scoring_mode: 'h2h_category', category_preset_id: 'mlb_5x5', category_record_mode: 'each' }

  it('a league that never switched gets the SAME settings object back for every week', () => {
    for (const week of [1, 5, 20]) expect(settingsForScoringWeek(PRESET_ONLY, 2026, week)).toBe(PRESET_ONLY)
    expect(settingsForScoringWeek(null, 2026, 3)).toBeNull()
  })

  it('with no custom list, the categories are exactly the preset', () => {
    for (const id of ['nba_8cat', 'nba_8cat_standard', 'nba_9cat', 'mlb_5x5', 'mlb_6x6', 'nope', null]) {
      expect(resolveLeagueCategories({}, id)).toBe(getCategoryPresetDefinitions(id))
    }
  })

  it('an unreadable stored list falls back to the preset rather than scoring a broken list', () => {
    for (const bad of [[], ['hr', 'hr'], ['hr', 'made_up'], 'hr']) {
      expect(resolveLeagueCategories({ category_ids: bad }, 'mlb_5x5')).toBe(getCategoryPresetDefinitions('mlb_5x5'))
    }
  })

  it('an unedited preset league still scores all ten 5x5 categories', async () => {
    arrange(PRESET_ONLY, 4)
    await updateMatchupScores('m1')
    expect(written().lineupSnapshots.categoryMatchup).toMatchObject({ aWins: 9, bWins: 1 })
  })

  it('the native context (panels, Chimmy, trade grades) reports the edited list', () => {
    const ctx = nativeCategoryScoringContext({ ...PRESET_ONLY, category_ids: ['era', 'hr'] }, 'MLB')
    expect(ctx?.categories.map((c) => c.id)).toEqual(['era', 'hr'])
  })
})

describe('storing a switch', () => {
  it('picking the preset list in preset order stores "preset" (null), a reorder stores the list', () => {
    const current = readScoringType({ scoring_mode: 'points' })
    const preset = validateScoringTypeChange('MLB', { mode: 'h2h_category', presetId: 'mlb_5x5', categoryIds: ['r', 'hr', 'rbi', 'sb', 'avg', 'w', 'sv', 'k', 'era', 'whip'] }, current)
    expect(preset).toMatchObject({ ok: true, next: { categoryIds: null } })
    const reordered = validateScoringTypeChange('MLB', { mode: 'h2h_category', presetId: 'mlb_5x5', categoryIds: ['hr', 'r', 'rbi', 'sb', 'avg', 'w', 'sv', 'k', 'era', 'whip'] }, current)
    expect(reordered).toMatchObject({ ok: true, next: { categoryIds: ['hr', 'r', 'rbi', 'sb', 'avg', 'w', 'sv', 'k', 'era', 'whip'] } })
  })

  it('two switches in one season: each week reads the type it was played under', () => {
    let s: Record<string, unknown> = { scoring_mode: 'points' }
    s = applyScoringTypeChange(s, { mode: 'h2h_category', presetId: 'mlb_5x5', recordMode: 'most', categoryIds: null }, { season: 2026, effectiveFromWeek: 3, changedAt: 'a', changedBy: 'u' })
    s = applyScoringTypeChange(s, { mode: 'h2h_category', presetId: 'mlb_6x6', recordMode: 'each', categoryIds: null }, { season: 2026, effectiveFromWeek: 7, changedAt: 'b', changedBy: 'u' })
    const at = (w: number) => readScoringType(settingsForScoringWeek(s, 2026, w))
    expect(at(2)).toMatchObject({ mode: 'points' })
    expect(at(3)).toMatchObject({ mode: 'h2h_category', presetId: 'mlb_5x5', recordMode: 'most' })
    expect(at(6)).toMatchObject({ presetId: 'mlb_5x5' })
    expect(at(7)).toMatchObject({ presetId: 'mlb_6x6', recordMode: 'each' })
  })
})
