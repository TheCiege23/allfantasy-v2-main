/**
 * 2026-10-13 create-league scoring: ESPN default, Sleeper default and Classic presets, and TE
 * premium (TEP) with a commissioner-chosen amount per tight-end catch.
 *
 * The engine tests feed the EXACT scoring store creation writes into `buildLeagueStatScorer`, so
 * they assert points rather than config: a choice that seeds the wrong key or forgets the toggle
 * would still produce plausible-looking settings, and only a scored stat line catches it.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }))

import { DraftStep } from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { getScoringPresetOptionsForSelection } from '@/lib/create-league-v2/rules-engine'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { nflScoringSeedForCreate, TE_PREMIUM_POINT_OPTIONS } from '@/lib/nfl-scoring/nflScoringSeedForCreate'
import { buildFullNflScoringConfig } from '@/lib/nfl-scoring/NflScoringPresets'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { receptionPointsForScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import { translations } from '@/lib/i18n/translations'

/** The settings a new NFL league ends up with, built from the same seed the bootstrap writes. */
function createdLeague(scoringPresetId: string, tePremiumPoints?: number) {
  const seed = nflScoringSeedForCreate({ scoringPresetId, tePremiumPoints })
  const receptions = receptionPointsForScoringPresetId(scoringPresetId)
  const scoringPreset = receptions === 1 ? 'PPR' : receptions === 0 ? 'STANDARD' : 'HALF_PPR'
  return {
    sport: 'NFL',
    settings: {
      sportConfig: { scoringPreset, ...(seed.enableTEPremium ? { enableTEPremium: true } : {}) },
      nfl_scoring_config: { presetKey: seed.presetKey, rules: seed.rules },
    },
  }
}

const catchesOnly = { rec: 5 }

describe('ESPN, Sleeper and Classic presets seed their own rules', () => {
  it('ESPN and Sleeper are offered for NFL beside Half PPR, PPR and Classic', () => {
    const ids = getScoringPresetOptionsForSelection({ leagueType: 'redraft', sport: 'NFL', idpSelected: false }).map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining(['fb_half_ppr', 'fb_ppr', 'fb_espn_ppr', 'fb_sleeper_ppr', 'fb_standard']))
    const labels = getScoringPresetOptionsForSelection({ leagueType: 'redraft', sport: 'NFL', idpSelected: false }).map((o) => o.label)
    expect(labels).toEqual(expect.arrayContaining(['ESPN default (PPR)', 'Sleeper default (PPR)', 'Classic (no PPR)']))
  })

  it('each maps to the right NFL store', () => {
    expect(nflScoringSeedForCreate({ scoringPresetId: 'fb_espn_ppr' }).presetKey).toBe('espn_ppr')
    expect(nflScoringSeedForCreate({ scoringPresetId: 'fb_sleeper_ppr' }).presetKey).toBe('sleeper_default')
    const classic = nflScoringSeedForCreate({ scoringPresetId: 'fb_standard' })
    expect(classic.rules.reception).toBe(0)
    expect(nflScoringSeedForCreate({ scoringPresetId: 'fb_half_ppr' }).rules.reception).toBe(0.5)
  })

  it('an interception costs 2 on ESPN and 1 on Sleeper, scored by the live engine', () => {
    const pick = { pass_int: 1 }
    expect(buildLeagueStatScorer(createdLeague('fb_espn_ppr'))!(pick, 'QB')).toBeCloseTo(-2)
    expect(buildLeagueStatScorer(createdLeague('fb_sleeper_ppr'))!(pick, 'QB')).toBeCloseTo(-1)
  })

  it('both are full PPR in the engine; Classic scores nothing per catch', () => {
    expect(buildLeagueStatScorer(createdLeague('fb_espn_ppr'))!(catchesOnly, 'WR')).toBeCloseTo(5)
    expect(buildLeagueStatScorer(createdLeague('fb_sleeper_ppr'))!(catchesOnly, 'WR')).toBeCloseTo(5)
    expect(buildLeagueStatScorer(createdLeague('fb_standard'))!(catchesOnly, 'WR')).toBeCloseTo(0)
  })

  it('no preset stores a te_premium rule, so turning TEP on later still gets the engine default', () => {
    for (const key of ['af_default', 'af_ppr', 'af_standard', 'espn_ppr', 'sleeper_default'] as const) {
      expect(buildFullNflScoringConfig(key)).not.toHaveProperty('te_premium')
    }
    const later = createdLeague('fb_half_ppr')
    ;(later.settings.sportConfig as Record<string, unknown>).enableTEPremium = true
    const wr = buildLeagueStatScorer(later)!(catchesOnly, 'WR')
    expect(buildLeagueStatScorer(later)!(catchesOnly, 'TE') - wr).toBeCloseTo(5 * 0.5)
  })
})

describe('TE premium scores the amount the commissioner chose', () => {
  it.each(TE_PREMIUM_POINT_OPTIONS)('+%s per TE catch, and nothing extra for a WR', (points) => {
    const scorer = buildLeagueStatScorer(createdLeague('fb_ppr', points))!
    const wr = scorer(catchesOnly, 'WR')
    expect(wr).toBeCloseTo(5)
    expect(scorer(catchesOnly, 'TE') - wr).toBeCloseTo(5 * points)
  })

  it('works on top of a platform preset too', () => {
    const scorer = buildLeagueStatScorer(createdLeague('fb_sleeper_ppr', 1))!
    expect(scorer(catchesOnly, 'TE') - scorer(catchesOnly, 'WR')).toBeCloseTo(5)
  })

  it('without TEP a TE and a WR score the same', () => {
    const scorer = buildLeagueStatScorer(createdLeague('fb_ppr'))!
    expect(scorer(catchesOnly, 'TE')).toBeCloseTo(scorer(catchesOnly, 'WR'))
  })

  it('takes any custom decimal above 0 up to 5, and ignores anything else', () => {
    for (const good of [0.3, 1.35, 2, 5]) {
      const seed = nflScoringSeedForCreate({ scoringPresetId: 'fb_ppr', tePremiumPoints: good })
      expect(seed.enableTEPremium).toBe(true)
      expect(seed.rules.te_premium).toBe(good)
    }
    for (const bad of [0, -1, 5.01, 1.234, Number.NaN, '0.5', null]) {
      const seed = nflScoringSeedForCreate({ scoringPresetId: 'fb_ppr', tePremiumPoints: bad })
      expect(seed.enableTEPremium).toBe(false)
      expect(seed.rules).not.toHaveProperty('te_premium')
    }
  })
})

const nflDraft: CreateLeagueV2State = {
  ...DEFAULT_V2_STATE,
  sport: 'NFL',
  leagueType: 'redraft',
  scoringPresetId: 'fb_ppr',
  name: 'Tight End Club',
  nameTouched: true,
  draftDate: '2026-11-08',
  draftTime: '20:00',
  timezone: 'America/Chicago',
}

describe('the wizard asks for the TEP amount', () => {
  it('ticking TEP shows a required amount; unticking clears it', () => {
    const onChange = vi.fn()
    const view = render(<DraftStep state={nflDraft} onChange={onChange} fieldErrors={null} />)
    expect(screen.getByTestId('g30-help-te-premium')).toBeTruthy()
    expect(screen.queryByTestId('g30-te-premium-points')).toBeNull()
    fireEvent.click(screen.getByTestId('g30-te-premium-toggle'))
    expect(onChange).toHaveBeenCalledWith({ tePremium: true })

    view.rerender(<DraftStep state={{ ...nflDraft, tePremium: true }} onChange={onChange} fieldErrors={null} />)
    const picker = screen.getByTestId('g30-te-premium-points')
    const chips = Array.from(picker.querySelectorAll('button')).map((b) => b.textContent)
    expect(chips).toEqual(['+0.25', '+0.5', '+0.75', '+1', '+1.5', '+2', 'Custom'])
    expect(picker.querySelector('[aria-pressed="true"]')).toBeNull()
    expect(screen.getByTestId('g30-te-premium').querySelector('[data-checked]')?.getAttribute('data-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('g30-te-premium-option-2'))
    expect(onChange).toHaveBeenLastCalledWith({ tePremiumPoints: 2 })

    // Custom: any decimal, typed freely; an out-of-range value sends null so the form can't finish.
    fireEvent.click(screen.getByTestId('g30-te-premium-custom'))
    const input = screen.getByTestId('g30-te-premium-custom-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1.35' } })
    expect(onChange).toHaveBeenLastCalledWith({ tePremiumPoints: 1.35 })
    fireEvent.change(input, { target: { value: '7' } })
    expect(onChange).toHaveBeenLastCalledWith({ tePremiumPoints: null })
    expect(input.getAttribute('aria-invalid')).toBe('true')

    fireEvent.click(screen.getByTestId('g30-te-premium-toggle'))
    expect(onChange).toHaveBeenLastCalledWith({ tePremium: false, tePremiumPoints: null })
  })

  it('is football only: NFL and college football get it, NBA does not', () => {
    const view = render(<DraftStep state={{ ...nflDraft, sport: 'NBA', scoringPresetId: 'nba_points' }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.queryByTestId('g30-te-premium')).toBeNull()
    view.rerender(<DraftStep state={{ ...nflDraft, sport: 'NCAAF', scoringPresetId: 'ncaaf_half_ppr' }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('g30-te-premium')).toBeTruthy()
  })

  it('cannot finish with TEP on and no amount', () => {
    const codes = (state: CreateLeagueV2State) => analyzeCreateLeagueCompletion(state).map((issue) => issue.code)
    expect(codes({ ...nflDraft, tePremium: true, tePremiumPoints: null })).toContain('te_premium_points_required')
    expect(codes({ ...nflDraft, tePremium: true, tePremiumPoints: 0.75 })).not.toContain('te_premium_points_required')
    expect(codes(nflDraft)).not.toContain('te_premium_points_required')
  })
})

describe('the server takes the amount, only in range, and only for football (NFL, NCAAF)', () => {
  async function bodyFor(state: CreateLeagueV2State) {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return { ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) } as Response
    }))
    try {
      await submitCreateLeagueV2(state)
    } finally {
      vi.unstubAllGlobals()
    }
    return bodies[0]
  }

  it('sends tePremiumPoints when TEP is on, and the server accepts it', async () => {
    const body = await bodyFor({ ...nflDraft, tePremium: true, tePremiumPoints: 0.5 })
    expect((body.conceptSetup as Record<string, unknown>).tePremiumPoints).toBe(0.5)
    expect(validateCreatePayload(body).ok).toBe(true)
  })

  it('sends nothing when TEP is off', async () => {
    const body = await bodyFor({ ...nflDraft, tePremium: false, tePremiumPoints: 0.5 })
    expect(body.conceptSetup as Record<string, unknown>).not.toHaveProperty('tePremiumPoints')
  })

  it('refuses an out-of-range amount and a non-NFL league', () => {
    const base = { concept: 'redraft', sport: 'NFL', scoringPreset: 'fb_ppr', teamCount: 12, draftType: 'snake', leagueName: 'TEP' }
    expect(validateCreatePayload({ ...base, conceptSetup: { tePremiumPoints: 1 } }).ok).toBe(true)
    expect(validateCreatePayload({ ...base, conceptSetup: { tePremiumPoints: 1.35 } }).ok).toBe(true)
    expect(validateCreatePayload({ ...base, conceptSetup: { tePremiumPoints: 0 } }).ok).toBe(false)
    expect(validateCreatePayload({ ...base, conceptSetup: { tePremiumPoints: 5.5 } }).ok).toBe(false)
    expect(validateCreatePayload({ ...base, conceptSetup: { tePremiumPoints: 1.234 } }).ok).toBe(false)
    expect(validateCreatePayload({ ...base, sport: 'NBA', scoringPreset: 'nba_points', conceptSetup: { tePremiumPoints: 0.5 } }).ok).toBe(false)
  })

  it('college football sends and accepts the amount too (2026-11-28)', async () => {
    const body = await bodyFor({ ...nflDraft, sport: 'NCAAF', scoringPresetId: 'ncaaf_half_ppr', tePremium: true, tePremiumPoints: 0.75 })
    expect((body.conceptSetup as Record<string, unknown>).tePremiumPoints).toBe(0.75)
    expect(validateCreatePayload(body).ok).toBe(true)
    const codes = analyzeCreateLeagueCompletion({ ...nflDraft, sport: 'NCAAF', scoringPresetId: 'ncaaf_half_ppr', tePremium: true, tePremiumPoints: null }).map((i) => i.code)
    expect(codes).toContain('te_premium_points_required')
  })

  it('accepts the ESPN and Sleeper preset ids', () => {
    for (const scoringPreset of ['fb_espn_ppr', 'fb_sleeper_ppr', 'fb_standard']) {
      expect(validateCreatePayload({ concept: 'redraft', sport: 'NFL', scoringPreset, teamCount: 12, draftType: 'snake', leagueName: 'Presets' }).ok).toBe(true)
    }
  })
})

describe('copy', () => {
  it('the TEP strings exist in English and Spanish', () => {
    const keys = ['createLeague.g30.help.tePremium', 'createLeague.g30.tePremium.label', 'createLeague.g30.tePremium.amount', 'createLeague.g30.tePremium.choose', 'createLeague.g30.tePremium.perCatch']
    const t = translations as unknown as Record<string, Record<string, string>>
    for (const lang of ['en', 'es']) for (const key of keys) expect(t[lang][key], `${lang} ${key}`).toBeTruthy()
  })
})

describe('NCAAF seeds the TE bonus into its own scoring store (2026-11-28)', () => {
  it('applyDefaultNcaafScoringOnCreate writes te_premium only when an amount is given', async () => {
    const writes: Record<string, unknown>[] = []
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        league: {
          findUnique: vi.fn(async () => ({ settings: {} })),
          update: vi.fn(async (a: { data: { settings: Record<string, unknown> } }) => { writes.push(a.data.settings) }),
        },
      },
    }))
    const { applyDefaultNcaafScoringOnCreate } = await import('@/lib/ncaaf-scoring/NcaafScoringConfigService')
    await applyDefaultNcaafScoringOnCreate('L', 0.5, 0.75)
    await applyDefaultNcaafScoringOnCreate('L', 0.5, null)
    const rules = (w: Record<string, unknown>) => ((w.ncaaf_scoring_config as { rules: Record<string, number> }).rules)
    expect(rules(writes[0]).te_premium).toBe(0.75)
    expect(rules(writes[0]).reception).toBe(0.5)
    expect(rules(writes[1]).te_premium ?? 0).toBe(0)
    vi.doUnmock('@/lib/prisma')
  })
})
