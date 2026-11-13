/**
 * Step-level view of `analyzeCreateLeagueCompletion`.
 *
 * The completion check already knows every rule, but it answered one question — "can this be
 * submitted?" — on the last step. This maps each issue to the step and field it belongs to, so the
 * wizard can show the message next to the field, as the commissioner types, and stop them moving
 * on with a mistake still on the page.
 *
 * ⚠ ONE RULEBOOK. Do not add a rule here that `analyzeCreateLeagueCompletion` does not also
 * enforce; a step that passes here and then fails at submit is the exact surprise this removes.
 * The only additions are friendlier wording for the same codes.
 */

import { getEffectiveLeagueType, type CreateLeagueV2State } from './state'
import { getTeamCountOptions } from './rules-engine'
import type { CreateLeagueCompletionIssue } from './form-completion'

/** The wizard's four steps (Summary was folded into Review). Keep in step with CreateLeagueWizard. */
type CreateWizardStep = 'sport' | 'basics' | 'draft' | 'review'

export const CREATE_WIZARD_STEPS: readonly CreateWizardStep[] = ['sport', 'basics', 'draft', 'review']

/** Field keys match the server's `fieldErrors` keys, so client and server errors share slots. */
export type CreateWizardField =
  | 'sport'
  | 'leagueType'
  | 'leagueName'
  | 'teamCount'
  | 'season'
  | 'scoringPreset'
  | 'draftType'
  | 'draftDate'
  | 'draftTime'
  | 'timezone'
  | 'keeper'
  | 'dynasty'
  | 'bestBall'
  | 'kingOfTheHill'
  | 'survivor'
  | 'tePremium'

interface StepIssue extends CreateLeagueCompletionIssue {
  step: CreateWizardStep
  field: CreateWizardField | null
}

const CODE_PLACEMENT: Array<[RegExp, CreateWizardStep, CreateWizardField | null]> = [
  [/^sport_required$/, 'sport', 'sport'],
  [/^REDRAFT_SPORT_SEASON_UNAVAILABLE$/, 'sport', 'sport'],
  [/^king_of_the_hill_sport$/, 'sport', 'sport'],
  [/^concept_required$/, 'basics', 'leagueType'],
  [/^season_unavailable$/, 'basics', 'season'],
  [/^league_name_invalid$/, 'basics', 'leagueName'],
  [/^team_count_/, 'basics', 'teamCount'],
  [/^tournament_pool/, 'basics', 'teamCount'],
  [/^king_of_the_hill_rules$/, 'basics', 'kingOfTheHill'],
  [/^best_ball_integrity$/, 'basics', 'bestBall'],
  [/^survivor_/, 'basics', 'survivor'],
  [/^te_premium_/, 'draft', 'tePremium'],
  [/^king_of_the_hill_draft$/, 'draft', 'draftType'],
  [/^scoring_/, 'draft', 'scoringPreset'],
  [/^draft_(required|invalid)$/, 'draft', 'draftType'],
  [/^draft_date_required$/, 'draft', 'draftDate'],
  [/^draft_time_required$/, 'draft', 'draftTime'],
  [/^timezone_required$/, 'draft', 'timezone'],
  [/^keeper_/, 'draft', 'keeper'],
  [/^dynasty_/, 'draft', 'dynasty'],
  [/^best_ball_/, 'draft', 'bestBall'],
]

const FORMAT_NAMES: Record<string, string> = {
  big_brother: 'Big Brother',
  survivor: 'Survivor',
  tournament: 'Tournament',
  guillotine: 'Guillotine',
  king_of_the_hill: 'King of the Hill',
  best_ball: 'Best Ball',
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  redraft: 'Redraft',
  salary_cap: 'Salary cap',
  zombie: 'Zombie',
}

function listSizes(sizes: number[]): string {
  if (sizes.length === 0) return ''
  const contiguous = sizes.every((v, i) => i === 0 || v === sizes[i - 1] + 1)
  if (contiguous && sizes.length > 3) return `${sizes[0]} to ${sizes[sizes.length - 1]}`
  if (sizes.length === 1) return String(sizes[0])
  if (sizes.length <= 6) return `${sizes.slice(0, -1).join(', ')} or ${sizes[sizes.length - 1]}`
  // Even counts across a range: say so rather than listing fifteen numbers.
  const evens = sizes.every((v) => v % 2 === 0) && sizes.every((v, i) => i === 0 || v === sizes[i - 1] + 2)
  if (evens) return `an even number from ${sizes[0]} to ${sizes[sizes.length - 1]}`
  return `${sizes.slice(0, 5).join(', ')}, …`
}

/** Plain-English rewording for codes whose generic message leaves the reader guessing. */
export function friendlyIssueMessage(issue: CreateLeagueCompletionIssue, state: CreateLeagueV2State): string {
  const lt = getEffectiveLeagueType(state) ?? 'redraft'
  const format = FORMAT_NAMES[lt] ?? 'This format'
  switch (issue.code) {
    case 'team_count_invalid':
    case 'tournament_pool_invalid': {
      const sizes = lt === 'redraft' ? [] : getTeamCountOptions(state.sport, lt, state.soccerPipeline)
      if (sizes.length === 1) return `${format} leagues need exactly ${sizes[0]} managers.`
      if (sizes.length > 1) return `${format} leagues need ${listSizes(sizes)} managers. You have ${state.teamCount}.`
      return 'Pick between 2 and 32 teams.'
    }
    case 'team_count_required':
      return 'Enter how many teams will play.'
    case 'league_name_invalid': {
      const len = state.name.trim().length
      if (len === 0) return 'Give your league a name.'
      if (len < 3) return 'League names need at least 3 characters.'
      return 'League names can be up to 100 characters.'
    }
    case 'draft_date_required':
      return 'Pick a draft date, or choose "Schedule later" to set it after inviting managers.'
    case 'draft_time_required':
      return 'Pick a draft time, or choose "Schedule later".'
    case 'timezone_required':
      return 'Choose the timezone your league plays in.'
    case 'concept_required':
      return 'Choose a league type.'
    default:
      return issue.message
  }
}

export function placeIssue(issue: CreateLeagueCompletionIssue, state: CreateLeagueV2State): StepIssue {
  for (const [re, step, field] of CODE_PLACEMENT) {
    if (re.test(issue.code)) return { ...issue, message: friendlyIssueMessage(issue, state), step, field }
  }
  // Unknown codes surface on the review step rather than vanishing.
  return { ...issue, message: friendlyIssueMessage(issue, state), step: 'review', field: null }
}

export function placeIssues(issues: CreateLeagueCompletionIssue[], state: CreateLeagueV2State): StepIssue[] {
  return issues.map((i) => placeIssue(i, state))
}

export function issuesForStep(issues: StepIssue[], step: CreateWizardStep): StepIssue[] {
  return issues.filter((i) => i.step === step)
}

/** First message per field — the shape the step components already accept as `fieldErrors`. */
export function fieldErrorsFromIssues(issues: StepIssue[]): Partial<Record<CreateWizardField, string>> {
  const out: Partial<Record<CreateWizardField, string>> = {}
  for (const i of issues) {
    if (i.field && !out[i.field]) out[i.field] = i.message
  }
  return out
}

/** Which form fields a state patch touches — so an error appears as soon as someone edits that field. */
export function fieldsTouchedByPatch(patch: Partial<CreateLeagueV2State>): CreateWizardField[] {
  const map: Partial<Record<keyof CreateLeagueV2State, CreateWizardField>> = {
    sport: 'sport',
    leagueType: 'leagueType',
    name: 'leagueName',
    teamCount: 'teamCount',
    scoringPresetId: 'scoringPreset',
    draftType: 'draftType',
    draftDate: 'draftDate',
    draftTime: 'draftTime',
    timezone: 'timezone',
    keeper: 'keeper',
    dynasty: 'dynasty',
    bestBall: 'bestBall',
    survivorTribeCount: 'survivor',
    survivorDuesUsd: 'survivor',
    tePremiumPoints: 'tePremium',
  }
  return (Object.keys(patch) as Array<keyof CreateLeagueV2State>)
    .map((k) => map[k])
    .filter((f): f is CreateWizardField => Boolean(f))
}

/**
 * Errors to SHOW right now: every issue on a step the commissioner tried to leave, plus issues on
 * fields they have edited. A blank form does not open covered in red.
 */
export function visibleFieldErrors(
  issues: StepIssue[],
  opts: { touched: ReadonlySet<CreateWizardField>; attemptedSteps: ReadonlySet<CreateWizardStep> },
): Partial<Record<CreateWizardField, string>> {
  return fieldErrorsFromIssues(
    issues.filter((i) => opts.attemptedSteps.has(i.step) || (i.field !== null && opts.touched.has(i.field))),
  )
}
