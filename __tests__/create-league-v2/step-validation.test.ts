import { describe, expect, it } from 'vitest'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import {
  CREATE_WIZARD_STEPS,
  fieldErrorsFromIssues,
  fieldsTouchedByPatch,
  friendlyIssueMessage,
  issuesForStep,
  placeIssue,
  placeIssues,
  visibleFieldErrors,
} from '@/lib/create-league-v2/step-validation'
import { FORMAT_EXPLAINERS, getFormatExplainer } from '@/lib/create-league-v2/format-explainers'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'

function state(over: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return { ...DEFAULT_V2_STATE, sport: 'NFL', leagueType: 'redraft', scoringPresetId: 'fb_half_ppr', ...over }
}

describe('placing completion issues on wizard steps and fields', () => {
  it.each([
    ['league_name_invalid', 'basics', 'leagueName'],
    ['team_count_invalid', 'basics', 'teamCount'],
    ['team_count_required', 'basics', 'teamCount'],
    ['tournament_pool_mismatch', 'basics', 'teamCount'],
    ['concept_required', 'basics', 'leagueType'],
    ['season_unavailable', 'basics', 'season'],
    ['sport_required', 'sport', 'sport'],
    ['REDRAFT_SPORT_SEASON_UNAVAILABLE', 'sport', 'sport'],
    ['scoring_invalid', 'draft', 'scoringPreset'],
    ['draft_invalid', 'draft', 'draftType'],
    ['draft_date_required', 'draft', 'draftDate'],
    ['draft_time_required', 'draft', 'draftTime'],
    ['timezone_required', 'draft', 'timezone'],
    ['keeper_settings', 'draft', 'keeper'],
    ['dynasty_playoff_teams', 'draft', 'dynasty'],
    ['best_ball_integrity', 'basics', 'bestBall'],
    ['best_ball_templates', 'draft', 'bestBall'],
    ['survivor_tribes_invalid', 'basics', 'survivor'],
    ['survivor_season_too_short', 'basics', 'survivor'],
    ['te_premium_points_required', 'draft', 'tePremium'],
  ])('%s → %s / %s', (code, step, field) => {
    expect(placeIssue({ code, message: 'm' }, state())).toMatchObject({ step, field })
  })

  it('an unknown code lands on the review step instead of disappearing', () => {
    expect(placeIssue({ code: 'brand_new_rule', message: 'Do the thing.' }, state())).toMatchObject({
      step: 'review',
      field: null,
      message: 'Do the thing.',
    })
  })

  it('every real issue on a blank form maps to a step the wizard has', () => {
    const issues = placeIssues(analyzeCreateLeagueCompletion(state({ name: '', draftDate: '', draftTime: '' })), state())
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) expect(CREATE_WIZARD_STEPS).toContain(i.step)
    expect(issuesForStep(issues, 'basics').map((i) => i.field)).toContain('leagueName')
    expect(issuesForStep(issues, 'draft').map((i) => i.field)).toEqual(expect.arrayContaining(['draftDate', 'draftTime']))
  })

  it('a completed redraft form has no issues on any step', () => {
    const s = state({ name: 'Sunday Funday', teamCount: 12, draftScheduleLater: true, timezone: 'America/New_York' })
    const issues = placeIssues(analyzeCreateLeagueCompletion(s), s)
    for (const step of CREATE_WIZARD_STEPS) {
      expect(issuesForStep(issues, step).filter((i) => i.code !== 'season_unavailable')).toEqual([])
    }
  })
})

describe('plain-English messages', () => {
  it('Big Brother names the house sizes it accepts', () => {
    const s = state({ leagueType: 'big_brother', teamCount: 10 })
    expect(friendlyIssueMessage({ code: 'team_count_invalid', message: 'generic' }, s)).toBe(
      'Big Brother leagues need 12, 14, 16 or 18 managers. You have 10.',
    )
  })

  it('Survivor and Tournament name their sizes too', () => {
    // Whatever sizes the rules engine allows, the message names them — the same list the check uses.
    const survivorSizes = getTeamCountOptions('NFL', 'survivor')
    const survivorMsg = friendlyIssueMessage({ code: 'team_count_invalid', message: 'g' }, state({ leagueType: 'survivor', teamCount: 5 }))
    expect(survivorMsg).toMatch(/^Survivor leagues need /)
    for (const size of survivorSizes.slice(0, 3)) expect(survivorMsg).toContain(String(size))
    expect(friendlyIssueMessage({ code: 'tournament_pool_invalid', message: 'g' }, state({ leagueType: 'tournament', teamCount: 5 }))).toMatch(
      /^Tournament leagues need .*32.* managers/,
    )
  })

  it('redraft explains the open range', () => {
    expect(friendlyIssueMessage({ code: 'team_count_invalid', message: 'g' }, state({ teamCount: 40 }))).toBe('Pick between 2 and 32 teams.')
  })

  it('league name messages depend on what is wrong', () => {
    const msg = (name: string) => friendlyIssueMessage({ code: 'league_name_invalid', message: 'g' }, state({ name }))
    expect(msg('')).toBe('Give your league a name.')
    expect(msg('ab')).toBe('League names need at least 3 characters.')
    expect(msg('x'.repeat(101))).toBe('League names can be up to 100 characters.')
  })

  it('keeps the original message for codes it has nothing better for', () => {
    expect(friendlyIssueMessage({ code: 'dynasty_faab', message: 'Set a FAAB budget of at least 1.' }, state())).toBe(
      'Set a FAAB budget of at least 1.',
    )
  })
})

describe('when errors are shown', () => {
  const issues = placeIssues(
    [
      { code: 'league_name_invalid', message: 'n' },
      { code: 'draft_date_required', message: 'd' },
    ],
    state({ name: '' }),
  )

  it('a fresh form shows nothing', () => {
    expect(visibleFieldErrors(issues, { touched: new Set(), attemptedSteps: new Set() })).toEqual({})
  })

  it('shows a field error as soon as that field is edited', () => {
    expect(visibleFieldErrors(issues, { touched: new Set(['leagueName']), attemptedSteps: new Set() })).toEqual({
      leagueName: 'Give your league a name.',
    })
  })

  it('shows every error on a step the commissioner tried to leave', () => {
    expect(visibleFieldErrors(issues, { touched: new Set(), attemptedSteps: new Set(['draft']) })).toEqual({
      draftDate: 'Pick a draft date, or choose "Schedule later" to set it after inviting managers.',
    })
  })

  it('keeps the first message per field', () => {
    const two = placeIssues(
      [
        { code: 'team_count_required', message: 'a' },
        { code: 'team_count_invalid', message: 'b' },
      ],
      state(),
    )
    expect(fieldErrorsFromIssues(two).teamCount).toBe('Enter how many teams will play.')
  })

  it('maps state patches to the fields they touch', () => {
    expect(fieldsTouchedByPatch({ name: 'x', nameTouched: true })).toEqual(['leagueName'])
    expect(fieldsTouchedByPatch({ scoringPresetId: 'x', draftDate: '2026-01-01' })).toEqual(['scoringPreset', 'draftDate'])
    expect(fieldsTouchedByPatch({ privacy: 'public' })).toEqual([])
  })
})

describe('format explainers', () => {
  it('explains each format', () => {
    for (const id of ['redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine', 'big_brother', 'survivor', 'tournament']) {
      const e = getFormatExplainer(id)
      expect(e?.howItWorks.length).toBeGreaterThan(0)
    }
    expect(getFormatExplainer(null)).toBeNull()
    expect(getFormatExplainer('not_a_format')).toBeNull()
  })

  it('Big Brother explains HOH and the Power of Veto', () => {
    const text = FORMAT_EXPLAINERS.big_brother.howItWorks.join(' ')
    expect(text).toMatch(/Head of Household \(HOH\)/)
    expect(text).toMatch(/Power of Veto/)
  })
})
