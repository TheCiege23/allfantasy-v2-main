import { describe, expect, it } from 'vitest'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'

describe('getLeagueDefaults', () => {
  it.each([
    ['NFL redraft snake', { sport: 'NFL', format: 'redraft', draftType: 'snake', scoringPreset: 'fb_half_ppr' }],
    ['NFL dynasty snake', { sport: 'NFL', format: 'dynasty', draftType: 'snake', scoringPreset: 'fb_dynasty_ppr' }],
    ['NFL IDP snake', { sport: 'NFL', format: 'idp', draftType: 'snake', scoringPreset: 'fb_idp_ppr' }],
    ['NCAAF devy snake', { sport: 'NCAAF', format: 'devy', draftType: 'snake', scoringPreset: 'ncaaf_devy_ppr' }],
    ['NCAAF C2C snake', { sport: 'NCAAF', format: 'c2c', draftType: 'snake', scoringPreset: 'ncaaf_c2c_ppr' }],
  ])('returns durable foundation defaults for %s', (_label, input) => {
    const defaults = getLeagueDefaults({ ...input, managerCount: 12 })

    expect(defaults.managerCount).toBe(12)
    expect(defaults.engineDraftType).toBe('snake')
    expect(defaults.rosterSettings).toBeTruthy()
    expect(defaults.scoringSettings.scoringTemplateId).toBe(input.scoringPreset)
    expect(defaults.draftSettings.rounds).toBeGreaterThan(0)
    expect(defaults.playoffSettings.playoffTeams).toBeGreaterThan(0)
    expect(defaults.conceptPreset.requiredDataFeeds).toEqual(expect.any(Array))
    expect(defaults.conceptPreset.aiEnabledFeatures).toEqual(expect.any(Array))
  })

  it('marks NCAAF devy and C2C with beta data dependencies', () => {
    const devy = getLeagueDefaults({
      sport: 'NCAAF',
      format: 'devy',
      draftType: 'snake',
      scoringPreset: 'ncaaf_devy_ppr',
      managerCount: 12,
    })
    const c2c = getLeagueDefaults({
      sport: 'NCAAF',
      format: 'c2c',
      draftType: 'snake',
      scoringPreset: 'ncaaf_c2c_ppr',
      managerCount: 12,
    })

    expect(devy.conceptPreset.readiness).toMatch(/beta|launch_ready/)
    expect(devy.draftSettings.devyConfig).toEqual(expect.objectContaining({ enabled: true }))
    expect(c2c.conceptPreset.requiredDataFeeds.some((feed) => feed.includes('college'))).toBe(true)
    expect(c2c.draftSettings.c2cConfig).toEqual(expect.objectContaining({ enabled: true }))
  })
})

/**
 * `getLeagueDefaults` emits playoff and waiver settings in two key spellings — snake_case (the
 * sport-defaults registry shape) and camelCase (the format-contract shape) — because both are
 * widely consumed across the app. They must never disagree about the same league: they used to,
 * so an NCAAF devy league started playoffs in week 13 or week 15 depending on which key the
 * caller happened to read, an 8-manager NFL redraft league had 6 or 4 playoff teams, and a
 * dynasty league had FAAB waivers or no waiver type at all.
 *
 * The pairings below are declared here independently of the implementation on purpose. If
 * someone re-introduces a hand-built override for one spelling, or adds a field in only one
 * shape, this test fails rather than the drift shipping silently.
 */
describe('getLeagueDefaults snake_case / camelCase agreement', () => {
  /** Pairings the plain snake→camel transform cannot derive. */
  const IRREGULAR_KEY_PAIRS: Record<string, string> = {
    playoff_team_count: 'playoffTeams',
    FAAB_budget_default: 'faabBudget',
    matchup_length: 'playoffWeeksPerRound',
  }

  function toCamelCase(key: string): string {
    return key.replace(/_([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase())
  }

  /** Any key present in both spellings inside one settings object must hold one value. */
  function findSpellingDisagreements(settings: Record<string, unknown>, label: string): string[] {
    const disagreements: string[] = []
    for (const [key, value] of Object.entries(settings)) {
      if (!key.includes('_')) continue
      const camelKey = IRREGULAR_KEY_PAIRS[key] ?? toCamelCase(key)
      if (camelKey === key || !(camelKey in settings)) continue
      if (JSON.stringify(value) !== JSON.stringify(settings[camelKey])) {
        disagreements.push(
          `${label}.${key}=${JSON.stringify(value)} but ${label}.${camelKey}=${JSON.stringify(settings[camelKey])}`,
        )
      }
    }
    return disagreements
  }

  const SPORT_FORMATS = [
    { sport: 'NFL', format: 'redraft', scoringPreset: 'fb_half_ppr' },
    { sport: 'NFL', format: 'dynasty', scoringPreset: 'fb_dynasty_ppr' },
    { sport: 'NFL', format: 'idp', scoringPreset: 'fb_idp_ppr' },
    { sport: 'NCAAF', format: 'devy', scoringPreset: 'ncaaf_devy_ppr' },
    { sport: 'NCAAF', format: 'c2c', scoringPreset: 'ncaaf_c2c_ppr' },
  ] as const
  const DRAFT_TYPES = ['snake', 'auction'] as const
  const MANAGER_COUNTS = [8, 10, 12, 14] as const

  const MATRIX = SPORT_FORMATS.flatMap(({ sport, format, scoringPreset }) =>
    DRAFT_TYPES.flatMap((draftType) =>
      MANAGER_COUNTS.map(
        (managerCount) =>
          [`${sport} ${format} ${draftType} ${managerCount}-manager`, { sport, format, draftType, scoringPreset, managerCount }] as const,
      ),
    ),
  )

  it.each(MATRIX)('emits one agreed value per setting for %s', (_label, input) => {
    const defaults = getLeagueDefaults(input)

    expect([
      ...findSpellingDisagreements(defaults.playoffSettings, 'playoffSettings'),
      ...findSpellingDisagreements(defaults.waiverSettings, 'waiverSettings'),
    ]).toEqual([])
  })

  it.each(MATRIX)('resolves a playable playoff window for %s', (_label, input) => {
    const defaults = getLeagueDefaults(input)
    const playoffs = defaults.playoffSettings
    const regularSeasonLength = Number(defaults.scheduleSettings.regular_season_length)

    // The drift that started this: NCAAF devy reported playoffStartWeek 15 against a 15-week
    // season, so the camelCase reader scheduled playoffs at or after the season ended.
    expect(Number(playoffs.playoffStartWeek)).toBeGreaterThan(0)
    expect(Number(playoffs.playoffStartWeek)).toBeLessThanOrEqual(regularSeasonLength)
    expect(Number(playoffs.regularSeasonEndWeek)).toBe(Number(playoffs.playoffStartWeek) - 1)

    // A league cannot send more teams to the playoffs than it has.
    expect(Number(playoffs.playoffTeams)).toBeGreaterThan(0)
    expect(Number(playoffs.playoffTeams)).toBeLessThanOrEqual(input.managerCount)
  })

  it.each(MATRIX)('resolves a complete waiver rule set for %s', (_label, input) => {
    const waivers = getLeagueDefaults(input).waiverSettings

    // NFL dynasty used to answer 'faab' in snake_case and `undefined` in camelCase.
    expect(typeof waivers.waiverType).toBe('string')
    expect(waivers.waiverType).toBeTruthy()
    if (waivers.waiverType === 'faab') {
      expect(Number(waivers.faabBudget)).toBeGreaterThan(0)
    }
  })

  it('keeps both spellings agreed for formats that run no bracket', () => {
    for (const format of ['guillotine', 'zombie']) {
      const defaults = getLeagueDefaults({ sport: 'NFL', format, draftType: 'snake', managerCount: 12 })

      expect(findSpellingDisagreements(defaults.playoffSettings, `${format}.playoffSettings`)).toEqual([])
      expect(defaults.playoffSettings.playoffStartWeek).toBeNull()
      expect(defaults.playoffSettings.championshipWeek).toBeNull()
    }
  })
})
