// @vitest-environment node
/**
 * Survivor drafts come in five kinds: snake, linear, auction, offline and auto. The retired
 * Phase 1 ids (real_time, by_team) are gone from every list the wizard, the validator and the
 * engine read, and an execution mode validates as the snake draft it runs as.
 */
import { describe, expect, it } from 'vitest'
import { DRAFT_TYPES_BY_LEAGUE_FORMAT, normalizeDraftTypeForEngineValidation } from '@/lib/draft-types/draftTypeRegistry'
import { getDraftTypeOptions, isDraftTypeAllowedForType } from '@/lib/create-league-v2/rules-engine'
import { isDraftTypeAllowedForFormat } from '@/lib/league/format-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { SURVIVOR_CANONICAL_DRAFT_TYPE_IDS } from '@/lib/survivor/survivorSettings'
import { CONCEPT_PRESET_CATALOG } from '@/lib/league-concepts/conceptPresetCatalog'

const FIVE = ['snake', 'linear', 'auction', 'offline', 'auto']

describe('Survivor draft types', () => {
  it('the wizard offers snake, linear, auction, offline and auto for every Survivor sport', () => {
    for (const sport of ['NBA', 'NHL', 'NFL', 'NCAAF'] as const) {
      expect(getDraftTypeOptions('survivor', sport).map((option) => option.id)).toEqual(FIVE)
    }
    expect(isDraftTypeAllowedForType('offline', 'survivor')).toBe(true)
    expect(isDraftTypeAllowedForType('real_time', 'survivor')).toBe(false)
    expect(isDraftTypeAllowedForType('by_team', 'survivor')).toBe(false)
  })

  it('the engine matrix runs snake, linear and auction; offline and auto validate as snake', () => {
    expect(DRAFT_TYPES_BY_LEAGUE_FORMAT.survivor).toEqual(['snake', 'linear', 'auction'])
    expect(isDraftTypeAllowedForFormat('NBA', 'survivor', 'linear')).toBe(true)
    for (const mode of ['offline', 'auto']) {
      expect(normalizeDraftTypeForEngineValidation(mode)).toBe('snake')
      expect(isDraftTypeAllowedForFormat('NHL', 'survivor', normalizeDraftTypeForEngineValidation(mode))).toBe(true)
    }
  })

  it('the catalog seed, the foundation settings and the concept presets agree', () => {
    expect(LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedDraftTypesByConcept.survivor).toEqual(FIVE)
    expect([...SURVIVOR_CANONICAL_DRAFT_TYPE_IDS]).toEqual(FIVE)
    const survivorPresets = CONCEPT_PRESET_CATALOG.filter((preset) => preset.leagueType === 'survivor')
    expect(survivorPresets.length).toBeGreaterThan(0)
    for (const preset of survivorPresets) expect(preset.draftTypesAllowed).toEqual(FIVE)
  })
})
