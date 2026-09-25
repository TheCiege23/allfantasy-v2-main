/**
 * What the create wizard offers must be what the server accepts, and what the manager picks must
 * be what the league is created with.
 *
 * Each case here was a way a choice was refused or silently replaced on 2026-09-24:
 *   - the scoring dropdown listed presets the server rejects (duplicate Standard/Full PPR rows,
 *     TE Premium, Superflex, 2QB, NBA 9-cat/8-cat), and the catalog named presets that do not
 *     exist, so SOCCER had no accepted preset at all;
 *   - soccer needed a `soccerPipeline` the wizard had no control for;
 *   - NFL Best Ball with any non-snake draft type tripped `best_ball_3rr` with no way to clear it;
 *   - every NFL league was seeded 0.5 PPR whatever preset was picked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LEAGUE_CREATE_OPTIONS_CATALOG_V1,
} from '@/lib/league-creation/options-catalog-seed-data'
import {
  getClientLeagueCreateOptionsCatalog,
  setClientLeagueCreateOptionsCatalog,
} from '@/lib/create-league-v2/options-catalog-client'
import { getScoringPresetOptionsForSelection, isSportAllowedForType } from '@/lib/create-league-v2/rules-engine'
import {
  findScoringPresetRule,
  listScoringPresetOptions,
  receptionPointsForScoringPresetId,
} from '@/lib/league-creation-preset/scoring-presets'
import {
  DEFAULT_V2_STATE,
  SUPPORTED_SPORTS,
  getDefaultBestBallSetup,
  resolveBestBallSetupForWizard,
  type CreateLeagueV2State,
} from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import {
  buildFullNflScoringConfig,
  detectNflPresetMatch,
  nflScoringPresetKeyForReceptionPoints,
} from '@/lib/nfl-scoring/NflScoringPresets'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'

const WIZARD_LEAGUE_TYPES: LeagueTypeId[] = ['redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine']

function state(overrides: Partial<CreateLeagueV2State>): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'redraft',
    idpSelected: false,
    sport: 'NFL',
    scoringPresetId: 'fb_half_ppr',
    teamCount: 12,
    draftType: 'snake',
    draftDate: '2026-08-30',
    draftTime: '20:00',
    timezone: 'America/Chicago',
    privacy: 'private',
    name: 'Choices League',
    nameTouched: true,
    ...overrides,
  }
}

describe('create catalog only names presets that exist', () => {
  it('every allowlisted scoring preset resolves to a preset rule for that concept and sport', () => {
    const missing: string[] = []
    for (const [concept, bySport] of Object.entries(LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedScoringPresetsByConceptSport)) {
      for (const [sport, ids] of Object.entries(bySport ?? {})) {
        for (const id of ids ?? []) {
          const rule = findScoringPresetRule(id)
          const ctx = {
            leagueType: (concept === 'idp' ? 'redraft' : concept) as LeagueTypeId,
            sport: sport as CreateLeagueV2State['sport'],
            idpSelected: concept === 'idp',
          }
          if (!rule || !rule.matches(ctx)) missing.push(`${concept}/${sport}/${id}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('the wizard dropdown for every sport and league type is non-empty and fully accepted', () => {
    for (const leagueType of WIZARD_LEAGUE_TYPES) {
      // The wizard offers a concept only for the sports the catalog allows it (guillotine: no
      // NCAAB or soccer), so those are the pairings that must be fully accepted.
      for (const sport of SUPPORTED_SPORTS.filter((s) => isSportAllowedForType(s, leagueType))) {
        const allowed = LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedScoringPresetsByConceptSport[leagueType]?.[sport] ?? []
        const offered = getScoringPresetOptionsForSelection({ leagueType, sport, idpSelected: false }).map((o) => o.id)
        expect(offered.length, `${leagueType}/${sport}`).toBeGreaterThan(0)
        // The fallback to the unfiltered list is what used to offer presets the server rejects.
        for (const id of offered) expect(allowed, `${leagueType}/${sport}/${id}`).toContain(id)
      }
    }
  })

  it('the unfiltered list still offers a rejected preset — the filter is doing the work', () => {
    // Positive control: without the catalog filter the NFL dropdown shows TE Premium.
    const raw = listScoringPresetOptions({ leagueType: 'redraft', sport: 'NFL', idpSelected: false }).map((o) => o.id)
    expect(raw).toContain('fb_te_premium')
    const filtered = getScoringPresetOptionsForSelection({ leagueType: 'redraft', sport: 'NFL', idpSelected: false }).map((o) => o.id)
    expect(filtered).not.toContain('fb_te_premium')
  })
})

describe('client catalog agrees with the server before the fetch resolves', () => {
  beforeEach(() => setClientLeagueCreateOptionsCatalog(null))

  it('falls back to the same static catalog POST /api/leagues validates against', () => {
    expect(getClientLeagueCreateOptionsCatalog()).toBe(LEAGUE_CREATE_OPTIONS_CATALOG_V1)
  })
})

describe('soccer can be created', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }),
      } as Response),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a default soccer redraft passes the wizard and the server validator', async () => {
    // `soccerPipeline: null` is what a state restored from before the default carries.
    const s = state({ sport: 'SOCCER', scoringPresetId: 'soc_points', soccerPipeline: null })
    expect(analyzeCreateLeagueCompletion(s)).toEqual([])

    await submitCreateLeagueV2(s)
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.soccerPipeline).toBe('euro')

    const validated = validateCreatePayload(body)
    expect(validated.ok, JSON.stringify(validated)).toBe(true)
    expect(LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedScoringPresetsByConceptSport.redraft.SOCCER).toContain(body.scoringPreset)
  })
})

describe('Best Ball follows the draft type the manager picked', () => {
  const bestBall = (draftType: CreateLeagueV2State['draftType']) =>
    state({
      leagueType: 'best_ball',
      draftType,
      bestBall: getDefaultBestBallSetup('NFL', 'standard', 'snake'),
      timezone: 'America/Denver',
      privacy: 'public',
    })

  it('an NFL linear Best Ball league is submittable', () => {
    const issues = analyzeCreateLeagueCompletion(bestBall('linear')).map((i) => i.code)
    expect(issues).not.toContain('best_ball_3rr')
  })

  it('the saved block carries the chosen draft mode, 3RR, timezone and privacy', () => {
    const resolved = resolveBestBallSetupForWizard(bestBall('linear'))
    expect(resolved.draftMode).toBe('linear')
    expect(resolved.thirdRoundReversal).toBe(false)
    expect(resolved.timezone).toBe('America/Denver')
    expect(resolved.visibility).toBe('public')
  })

  it('snake keeps its NFL third-round reversal', () => {
    expect(resolveBestBallSetupForWizard(bestBall('snake')).thirdRoundReversal).toBe(true)
  })
})

describe('the chosen reception value is the one the league is seeded with', () => {
  it('reads points per reception off the preset the manager picked', () => {
    expect(receptionPointsForScoringPresetId('fb_ppr')).toBe(1)
    expect(receptionPointsForScoringPresetId('fb_standard')).toBe(0)
    expect(receptionPointsForScoringPresetId('fb_half_ppr')).toBe(0.5)
    expect(receptionPointsForScoringPresetId('ncaaf_ppr')).toBe(1)
    expect(receptionPointsForScoringPresetId('ncaaf_standard')).toBe(0)
    expect(receptionPointsForScoringPresetId('nba_points')).toBeNull()
    expect(receptionPointsForScoringPresetId('not_a_preset')).toBeNull()
  })

  it('maps each reception value to an NFL store whose reception rule matches', () => {
    for (const [ppr, key] of [[1, 'af_ppr'], [0, 'af_standard'], [0.5, 'af_default']] as const) {
      expect(nflScoringPresetKeyForReceptionPoints(ppr)).toBe(key)
      expect(buildFullNflScoringConfig(key).reception).toBe(ppr)
    }
    expect(nflScoringPresetKeyForReceptionPoints(null)).toBe('af_default')
  })

  it('recognises its own presets — including ones that score a key at zero', () => {
    // Every AF preset carries dst_pa_21_27: 0, which the old count comparison could never match.
    for (const key of ['af_default', 'af_ppr', 'af_standard'] as const) {
      expect(detectNflPresetMatch(buildFullNflScoringConfig(key))).toBe(key)
    }
  })
})
