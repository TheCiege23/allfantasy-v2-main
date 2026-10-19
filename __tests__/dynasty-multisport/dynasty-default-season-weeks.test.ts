import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE DYNASTY SEASON-LENGTH FALLBACK WAS 14 FOR EVERY SPORT, AND THE WIZARD DISAGREED WITH THE
 * SEASON SHAPE. `DynastySettingsService` summarised (and, for a new config, stored) 14 regular weeks
 * for an NBA/NHL/MLB league, and the create wizard defaulted those sports to 20/21/21 — while
 * `dailySportSeasonShape.ts`, which the redraft season and the playoff start read, says 22/24/23.
 * Everything now reads that one table; NFL and the sports it does not list keep their defaults.
 */

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  configFindUnique: vi.fn(),
  configUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique },
    dynastyLeagueConfig: { findUnique: m.configFindUnique, upsert: m.configUpsert },
  },
}))
vi.mock('@/lib/multi-sport/RosterTemplateService', () => ({ getRosterTemplate: vi.fn(async () => ({ slots: [] })) }))
vi.mock('@/lib/multi-sport/ScoringTemplateResolver', () => ({ getScoringTemplate: vi.fn(async () => ({ name: 'Standard' })) }))

import { dynastyDefaultRegularSeasonWeeksFor } from '@/lib/dynasty-core/constants'
import { getEffectiveDynastySettings, upsertDynastyConfig } from '@/lib/dynasty-core/DynastySettingsService'
import { getDefaultDynastySetup } from '@/lib/create-league-v2/state'
import { DAILY_SPORT_SEASON_SHAPE, regularSeasonWeeksFor } from '@/lib/sportConfig/dailySportSeasonShape'

beforeEach(() => {
  vi.clearAllMocks()
  m.configUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => create)
})

describe('one source of truth for a daily sport dynasty season', () => {
  it('reads the season shape for NBA/NHL/MLB and keeps 14 elsewhere', () => {
    expect(dynastyDefaultRegularSeasonWeeksFor('NBA')).toBe(22)
    expect(dynastyDefaultRegularSeasonWeeksFor('nhl')).toBe(24)
    expect(dynastyDefaultRegularSeasonWeeksFor('MLB')).toBe(23)
    expect(dynastyDefaultRegularSeasonWeeksFor('NFL')).toBe(14)
    expect(dynastyDefaultRegularSeasonWeeksFor(null)).toBe(14)
    for (const sport of Object.keys(DAILY_SPORT_SEASON_SHAPE) as (keyof typeof DAILY_SPORT_SEASON_SHAPE)[]) {
      expect(dynastyDefaultRegularSeasonWeeksFor(sport)).toBe(regularSeasonWeeksFor(sport))
    }
  })

  // The wizard's own defaults (NBA 20, NHL/MLB 21) are deliberately NOT moved to the shape: that would push
  // wizard-made leagues' playoffs ~2 weeks later, and when fantasy playoffs end is an open owner decision.
  it('the create wizard keeps its existing defaults, and NFL keeps 14', () => {
    expect(getDefaultDynastySetup('NBA').regularSeasonLength).toBe(20)
    expect(getDefaultDynastySetup('NHL').regularSeasonLength).toBe(21)
    expect(getDefaultDynastySetup('MLB').regularSeasonLength).toBe(21)
    expect(getDefaultDynastySetup('NFL').regularSeasonLength).toBe(14)
  })

  it('effective settings for an NBA league with no stored length report the shape, not 14', async () => {
    m.leagueFindUnique.mockResolvedValue({ id: 'L1', leagueSize: 12, sport: 'NBA', settings: {}, dynastyConfig: null })
    const effective = await getEffectiveDynastySettings('L1')
    expect(effective?.regularSeasonWeeks).toBe(22)
  })

  it('[control] an NFL league with no stored length still reports 14', async () => {
    m.leagueFindUnique.mockResolvedValue({ id: 'L1', leagueSize: 12, sport: 'NFL', settings: {}, dynastyConfig: null })
    expect((await getEffectiveDynastySettings('L1'))?.regularSeasonWeeks).toBe(14)
  })

  it('a new MLB config with no length supplied stores the shape length', async () => {
    m.configFindUnique.mockResolvedValue(null)
    m.leagueFindUnique.mockResolvedValue({ sport: 'MLB' })
    const saved = await upsertDynastyConfig('L1', {})
    expect(saved.regularSeasonWeeks).toBe(23)
  })

  it('an existing or supplied length is kept without reading the league', async () => {
    m.configFindUnique.mockResolvedValue({ regularSeasonWeeks: 18 })
    expect((await upsertDynastyConfig('L1', {})).regularSeasonWeeks).toBe(18)
    expect((await upsertDynastyConfig('L1', { regularSeasonWeeks: 20 })).regularSeasonWeeks).toBe(20)
    expect(m.leagueFindUnique).not.toHaveBeenCalled()
  })
})
