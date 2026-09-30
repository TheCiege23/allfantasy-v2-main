import { describe, expect, it } from 'vitest'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { isAllowedDraftTypeFromCatalog } from '@/lib/league-creation/options-catalog'
import { getDefaultTeamCount, getDraftTypeOptions, getIdpDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import { validateCreatePayload, normalizeDraftTypeForEngine } from '@/lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'

describe('every active creation choice reaches the preset engine', () => {
  it('accepts each offered sport, format, and draft choice', () => {
    const catalog = LEAGUE_CREATE_OPTIONS_CATALOG_V1
    const failures: string[] = []
    let checked = 0
    for (const concept of catalog.concepts) {
      const isIdp = concept.id === 'idp'
      for (const sport of catalog.allowedSportsByConcept[concept.id] ?? []) {
        const options = isIdp ? getIdpDraftTypeOptions() : getDraftTypeOptions(concept.id as LeagueTypeId, sport)
        const teamCount = getDefaultTeamCount(sport, isIdp ? 'redraft' : concept.id as LeagueTypeId, sport === 'SOCCER' ? 'euro' : null)
        const scoringPreset = catalog.allowedScoringPresetsByConceptSport[concept.id]?.[sport]?.[0]
        if (!scoringPreset || options.length === 0) {
          failures.push(`${concept.id}/${sport}: missing scoring preset or draft choices`)
          continue
        }
        for (const draft of options) {
          checked++
          const label = `${concept.id}/${sport}/${draft.id}`
          if (!isAllowedDraftTypeFromCatalog(catalog, concept.id, draft.id)) {
            failures.push(`${label}: rejected by API catalog`)
            continue
          }
          const result = validateCreatePayload({
            concept: concept.id, sport, teamCount, scoringPreset, draftType: draft.id,
            leagueName: 'Creation Matrix', ...(sport === 'SOCCER' ? { soccerPipeline: 'euro' } : {}),
          })
          if (!result.ok) {
            failures.push(`${label}: ${result.error}`)
            continue
          }
          try {
            runPresetEngine({ ...result.data, draftType: normalizeDraftTypeForEngine(result.data.draftType), commissionerId: 'matrix-user' })
          } catch (error) {
            failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect(failures).toEqual([])
  })
})
