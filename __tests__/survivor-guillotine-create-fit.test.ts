import { describe, expect, it } from 'vitest'
import { buildSGSchedule, defaultSGConfig, parseSGLiveConfig } from '@/lib/survivor-guillotine/config'
import {
  fitSGConfigForCreate,
  resolveSGCreateConfig,
  sgCreateTeamCounts,
  SG_CREATE_DEFAULT_TEAMS,
} from '@/lib/survivor-guillotine/createFit'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'

const finalists = (config: NonNullable<ReturnType<typeof fitSGConfigForCreate>>) => {
  const { periods, errors } = buildSGSchedule(config)
  expect(errors).toEqual([])
  return periods[periods.length - 1]!.teamsEntering
}

describe('Survivor Guilly create fit', () => {
  it('fits the default 22-team season to the unchanged default rules', () => {
    expect(SG_CREATE_DEFAULT_TEAMS).toBe(22)
    expect(fitSGConfigForCreate('NFL', 22)).toEqual(defaultSGConfig('NFL'))
    expect(fitSGConfigForCreate('NBA', 22)).toEqual(defaultSGConfig('NBA'))
  })

  it('offers every count 8–32 for NFL and 8–30 for NBA, each finishing with three finalists', () => {
    expect(sgCreateTeamCounts('NFL')).toEqual(Array.from({ length: 25 }, (_, i) => i + 8))
    expect(sgCreateTeamCounts('NBA')).toEqual(Array.from({ length: 23 }, (_, i) => i + 8))
    for (const sport of ['NFL', 'NBA'] as const) {
      for (const teamCount of sgCreateTeamCounts(sport)) {
        const config = fitSGConfigForCreate(sport, teamCount)!
        expect(config.teamCount).toBe(teamCount)
        expect(finalists(config)).toBe(3)
      }
    }
  })

  it('saves rules the setup page can load and re-save unchanged', () => {
    for (const teamCount of [8, 12, 19, 22, 27, 32]) {
      const config = fitSGConfigForCreate('NFL', teamCount, 3)!
      expect(() => parseSGLiveConfig(JSON.parse(JSON.stringify(config)))).not.toThrow()
    }
  })

  it('grows the Gauntlet for a big league and starts a small one later', () => {
    const big = fitSGConfigForCreate('NFL', 30)!
    expect(big.gauntletPeriods).toBe(11)
    expect(big.periodOverrides).toEqual({})
    const small = fitSGConfigForCreate('NFL', 12)!
    expect(small.gauntletPeriods).toBe(0)
    expect(Object.values(small.periodOverrides).every((mode) => mode === 'off')).toBe(true)
    expect(Object.keys(small.periodOverrides).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('refuses a size no schedule can finish', () => {
    expect(fitSGConfigForCreate('NFL', 2)).toBeNull()
    expect(fitSGConfigForCreate('NFL', 22.5)).toBeNull()
  })
})

describe('Survivor Guilly create request', () => {
  const body = { concept: 'survivor_guillotine', sport: 'NFL', teamCount: 22, conceptSetup: {} }

  it('is a redraft shell tagged survivor_guillotine', () => {
    expect(normalizeConceptToFormat('survivor_guillotine')).toEqual({ formatId: 'redraft', aliasTags: ['survivor_guillotine'] })
    expect(normalizeConceptToFormat('SURVIVOR_GUILLOTINE')?.aliasTags).toEqual(['survivor_guillotine'])
  })

  it('leaves every other concept alone', () => {
    expect(resolveSGCreateConfig({ ...body, concept: 'guillotine' })).toEqual({ kind: 'not_sg' })
    expect(resolveSGCreateConfig({ ...body, concept: 'redraft' })).toEqual({ kind: 'not_sg' })
  })

  it('resolves rules with the chosen tribe count', () => {
    const result = resolveSGCreateConfig({ ...body, conceptSetup: { survivorGuillotineTribeCount: 4 } })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.config.tribeCount).toBe(4)
    const fallback = resolveSGCreateConfig(body)
    expect(fallback.kind === 'ok' && fallback.config.tribeCount).toBe(2)
  })

  it('refuses before any write: wrong sport, size or tribe count', () => {
    expect(resolveSGCreateConfig({ ...body, sport: 'MLB' })).toMatchObject({ kind: 'invalid', path: 'sport' })
    expect(resolveSGCreateConfig({ ...body, teamCount: 7 })).toMatchObject({ kind: 'invalid', path: 'teamCount' })
    expect(resolveSGCreateConfig({ ...body, teamCount: 33 })).toMatchObject({ kind: 'invalid', path: 'teamCount' })
    expect(resolveSGCreateConfig({ ...body, sport: 'NBA', teamCount: 31 })).toMatchObject({ kind: 'invalid', path: 'teamCount' })
    expect(resolveSGCreateConfig({ ...body, conceptSetup: { survivorGuillotineTribeCount: 5 } }))
      .toMatchObject({ kind: 'invalid', path: 'conceptSetup.survivorGuillotineTribeCount' })
  })

  it('is listed in the create catalog with the same sports and sizes the server accepts', () => {
    const catalog = LEAGUE_CREATE_OPTIONS_CATALOG_V1
    expect(catalog.concepts.some((concept) => concept.id === 'survivor_guillotine')).toBe(true)
    expect(catalog.allowedSportsByConcept.survivor_guillotine).toEqual(['NFL', 'NBA'])
    expect(catalog.teamCountOptionsByConceptSport.survivor_guillotine?.NFL).toEqual(sgCreateTeamCounts('NFL'))
    expect(catalog.teamCountOptionsByConceptSport.survivor_guillotine?.NBA).toEqual(sgCreateTeamCounts('NBA'))
    for (const sport of ['NFL', 'NBA'] as const) {
      for (const teamCount of catalog.teamCountOptionsByConceptSport.survivor_guillotine![sport]!) {
        expect(resolveSGCreateConfig({ ...body, sport, teamCount }).kind).toBe('ok')
      }
    }
  })
})
