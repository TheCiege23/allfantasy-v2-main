import { describe, expect, it } from 'vitest'
import { analyzeCreateLeagueCompletion, getConceptDefaultNotes, isFormComplete } from '@/lib/create-league-v2/form-completion'
import { DEFAULT_V2_STATE, getDefaultDynastySetup } from '@/lib/create-league-v2/state'
import {
  getDefaultTeamCount,
  getDraftTypeOptions,
  getScoringPresetOptionsForSelection,
  getTeamCountOptions,
} from '@/lib/create-league-v2/rules-engine'
import { normalizeLegacyManualCreateBody, finalizeCanonicalCreatePayload } from '@/lib/league-creation/normalizeCreateLeaguePayload'

function baseValidRedraft() {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'redraft' as const,
    idpSelected: false,
    scoringPresetId: 'fb_half_ppr',
    name: "Commissioner's Test League",
    teamCount: 12,
    draftType: 'snake' as const,
    draftDate: '2026-08-30',
    draftTime: '20:00',
    privacy: 'private' as const,
    tournamentPoolSize: 32,
  }
}

describe('form-completion', () => {
  it('Redraft: valid baseline passes', () => {
    const s = baseValidRedraft()
    expect(analyzeCreateLeagueCompletion(s)).toEqual([])
    expect(isFormComplete(s)).toBe(true)
  })

  it('flags missing league name', () => {
    const s = { ...baseValidRedraft(), name: 'ab' }
    const codes = analyzeCreateLeagueCompletion(s).map((i) => i.code)
    expect(codes).toContain('league_name_invalid')
  })

  it('flags invalid draft type for concept', () => {
    const s = { ...baseValidRedraft(), draftType: 'not_a_draft' as never }
    expect(analyzeCreateLeagueCompletion(s).some((i) => i.code === 'draft_invalid')).toBe(true)
  })

  it('flags scoring preset not in filtered list', () => {
    const s = { ...baseValidRedraft(), scoringPresetId: 'nba_points' }
    expect(analyzeCreateLeagueCompletion(s).some((i) => i.code === 'scoring_invalid')).toBe(true)
  })

  it('Dynasty advanced: scheduled draft needs date', () => {
    const s = {
      ...baseValidRedraft(),
      leagueType: 'dynasty' as const,
      dynasty: {
        ...getDefaultDynastySetup('NFL', 'snake'),
        draftMode: 'scheduled' as const,
        draftDateUtc: '',
      },
    }
    expect(analyzeCreateLeagueCompletion(s).some((i) => i.code === 'dynasty_draft_date')).toBe(true)
  })

  it('tournament pool must match team tier', () => {
    const s = {
      ...baseValidRedraft(),
      leagueType: 'tournament' as const,
      teamCount: 32,
      tournamentPoolSize: 64,
    }
    expect(analyzeCreateLeagueCompletion(s).some((i) => i.code === 'tournament_pool_mismatch')).toBe(true)
  })

  it('Guillotine defaults: team count option list non-empty', () => {
    const opts = getTeamCountOptions('NFL', 'guillotine', null)
    expect(opts.length).toBeGreaterThan(0)
    expect(getDefaultTeamCount('NFL', 'guillotine', null)).toBeGreaterThanOrEqual(4)
  })

  it('draft types differ by concept (survivor vs redraft)', () => {
    const redraft = getDraftTypeOptions('redraft', 'NFL').map((o) => o.id)
    const survivor = getDraftTypeOptions('survivor', 'NFL').map((o) => o.id)
    expect(redraft).toContain('snake')
    expect(survivor.some((id) => id !== 'auction')).toBe(true)
  })

  it('scoring presets filtered for NFL redraft include core IDs', () => {
    const opts = getScoringPresetOptionsForSelection({
      leagueType: 'redraft',
      sport: 'NFL',
      idpSelected: false,
    }).map((o) => o.id)
    expect(opts.some((id) => id.includes('ppr') || id.includes('half') || id.includes('standard'))).toBe(true)
  })

  it('concept default notes cover major formats', () => {
    expect(getConceptDefaultNotes('redraft').length).toBeGreaterThan(10)
    expect(getConceptDefaultNotes('dynasty')).toContain('Multi-year')
    expect(getConceptDefaultNotes('guillotine')).toContain('elimination')
  })
})

describe('payload normalization unchanged after form layer', () => {
  it('Quick legacy body still normalizes', () => {
    const n = normalizeLegacyManualCreateBody({
      name: 'X',
      sport: 'NFL',
      leagueType: 'redraft',
      scoring: 'PPR',
      leagueVariant: 'PPR',
      platform: 'manual',
      settings: {},
    })
    expect(n.leagueVariant).toBeUndefined()
  })

  it('finalizeCanonicalCreatePayload still defaults timezone', () => {
    const out = finalizeCanonicalCreatePayload({ concept: 'redraft', timezone: '' })
    expect(out.timezone).toBe('America/New_York')
  })
})
