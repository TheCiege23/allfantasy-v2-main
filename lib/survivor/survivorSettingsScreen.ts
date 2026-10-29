/**
 * Commissioner Survivor settings screen (survivor-core handoff §2). Pure model shared by the
 * screen and its API: the form shape, what changed, what is locked, validation and the live
 * season preview. No I/O; safe on the client.
 *
 * Implemented behaviour wins where the README differs (listed in the PR):
 *  - tribe count is 2–5 (the existing tribe setup limit), not 2–4;
 *  - idol count is 6–8 via IdolSetup (README says 6–8 too), default 7;
 *  - "hide idols from me" defaults off (README: on), as the foundation settings already do;
 *  - Exile return tokens default to the league's stored value (foundation default 4; README 3);
 *  - the Exile boss keeps "Chimmy's roster" for leagues created before the score boss (owner decision);
 *  - share cards and public moment pages stay editable all season (privacy switches).
 */
import { defaultTribeSlots, validateTribeSlots } from './survivorTribeIdentity'
import { SURVIVOR_TIE_RULES, type SurvivorTieRule } from './survivorSettings'
import type { SurvivorExileBossMode } from './lateSeasonSettings'

export type SurvivorTribeFormation = 'random' | 'commissioner_manual' | 'draft_pattern'
/** The council tie rule: the owner's rocks rules, plus the two season-points rules older leagues carry. */
export type SurvivorTieRuleChoice = SurvivorTieRule
export type SurvivorMergeTriggerChoice = 'week' | 'active_player_count'

export interface SurvivorSettingsForm {
  tribeCount: number
  tribeFormation: SurvivorTribeFormation
  voteDay: string
  voteTime: string
  selfVotesAllowed: boolean
  tieRule: SurvivorTieRuleChoice
  idolCount: number
  hideIdolsFromCommissioner: boolean
  exileEnabled: boolean
  exileReturnTokens: number
  exileBossMode: SurvivorExileBossMode
  exileBossFixedScore: number | null
  exileBossTopN: number
  swapEnabled: boolean
  swapWeek: number
  mergeTrigger: SurvivorMergeTriggerChoice
  mergeWeek: number
  mergeActivePlayerCount: number
  finalistCount: 2 | 3
  shareCardsEnabled: boolean
  publicMomentPages: boolean
  /** The public watch page for fans of the show (off by default). */
  spectatorPageEnabled: boolean
}

export type SurvivorSettingsKey = keyof SurvivorSettingsForm

/** Everything else locks when the draft starts. */
export const SURVIVOR_SETTINGS_EDITABLE_ALL_SEASON: readonly SurvivorSettingsKey[] = [
  'voteDay', 'voteTime', 'exileBossMode', 'exileBossFixedScore', 'exileBossTopN', 'shareCardsEnabled', 'publicMomentPages',
  'spectatorPageEnabled',
]

export const SURVIVOR_VOTE_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const SURVIVOR_VOTE_TIMES = ['12:00', '15:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'] as const

export const SURVIVOR_SETTINGS_LIMITS = {
  tribeCount: [2, 5],
  idolCount: [6, 8],
  exileReturnTokens: [1, 5],
  exileBossTopN: [1, 20],
  finalistCount: [2, 3],
} as const

export interface SurvivorSettingsContext {
  managers: number
  firstWeek: number
  lastWeek: number
}

export function formatVoteTime(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return time
  const hour = Number(match[1])
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${match[2]} ${suffix}`
}

export function changedSettingsKeys(saved: SurvivorSettingsForm, draft: SurvivorSettingsForm): SurvivorSettingsKey[] {
  return (Object.keys(draft) as SurvivorSettingsKey[]).filter(key => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]))
}

export interface SurvivorSettingsLocks {
  draftStarted: boolean
  /** A saved full-season plan scheduled its eliminations for its finalist count. */
  finalistLocked: boolean
  /** Tribes assigned or the tribe plan locked. */
  tribesLocked: boolean
}

export function isSettingLocked(key: SurvivorSettingsKey, locks: SurvivorSettingsLocks): boolean {
  if (key === 'finalistCount' && locks.finalistLocked) return true
  if ((key === 'tribeCount' || key === 'tribeFormation') && locks.tribesLocked) return true
  if (!locks.draftStarted) return false
  return !SURVIVOR_SETTINGS_EDITABLE_ALL_SEASON.includes(key)
}

export function lockedChanges(changed: SurvivorSettingsKey[], locks: SurvivorSettingsLocks): SurvivorSettingsKey[] {
  return changed.filter(key => isSettingLocked(key, locks))
}

/** The week the tribes merge, estimated at one manager out per week when the trigger is a head count. */
export function effectiveMergeWeek(form: SurvivorSettingsForm, ctx: SurvivorSettingsContext): number {
  if (form.mergeTrigger === 'week') return form.mergeWeek
  return ctx.firstWeek + Math.max(0, ctx.managers - form.mergeActivePlayerCount)
}

export function validateSettingsForm(form: SurvivorSettingsForm, ctx: SurvivorSettingsContext): string[] {
  const errors: string[] = []
  const finale = ctx.lastWeek
  const merge = effectiveMergeWeek(form, ctx)
  const inRange = (n: number, [min, max]: readonly [number, number]) => Number.isInteger(n) && n >= min && n <= max
  if (!inRange(form.tribeCount, SURVIVOR_SETTINGS_LIMITS.tribeCount)) errors.push('Choose between 2 and 5 tribes.')
  else {
    const slotError = validateTribeSlots(defaultTribeSlots(ctx.managers, form.tribeCount), ctx.managers, form.tribeCount)
    if (slotError) errors.push(slotError)
  }
  if (!inRange(form.idolCount, SURVIVOR_SETTINGS_LIMITS.idolCount)) errors.push('Choose 6, 7 or 8 idols.')
  if (!(SURVIVOR_VOTE_DAYS as readonly string[]).includes(form.voteDay)) errors.push('Pick a day for votes to close.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.voteTime)) errors.push('Pick a time for votes to close.')
  if (form.exileEnabled && (!Number.isInteger(form.exileReturnTokens) || form.exileReturnTokens < 1)) errors.push('Exile Island needs at least one token to return.')
  if (form.exileBossMode === 'fixed' && (form.exileBossFixedScore == null || !Number.isFinite(form.exileBossFixedScore) || form.exileBossFixedScore < 0 || form.exileBossFixedScore > 10000)) errors.push('A fixed boss score must be a number from 0 to 10000.')
  if (form.exileBossMode === 'topN' && !inRange(form.exileBossTopN, SURVIVOR_SETTINGS_LIMITS.exileBossTopN)) errors.push('The top-N boss averages between 1 and 20 scores.')
  if (form.finalistCount !== 2 && form.finalistCount !== 3) errors.push('Choose 2 or 3 finalists.')
  if (form.mergeTrigger === 'week' && (!Number.isInteger(form.mergeWeek) || form.mergeWeek <= ctx.firstWeek)) errors.push('The merge must come after the first week.')
  if (form.mergeTrigger === 'active_player_count' && (!Number.isInteger(form.mergeActivePlayerCount) || form.mergeActivePlayerCount <= form.finalistCount || form.mergeActivePlayerCount >= ctx.managers)) errors.push(`Merge with between ${form.finalistCount + 1} and ${ctx.managers - 1} managers left.`)
  if (merge >= finale) errors.push('The merge must come before the finale.')
  if (form.swapEnabled) {
    if (!Number.isInteger(form.swapWeek) || form.swapWeek <= ctx.firstWeek) errors.push('The swap must come after the first Tribal Council.')
    else if (form.swapWeek >= merge) errors.push('The swap must come before the merge.')
  }
  return errors
}

export type SeasonWeekKind = 'tribal' | 'swap' | 'merge' | 'jury' | 'finale'

export interface SeasonPreview {
  weeks: { week: number; kind: SeasonWeekKind }[]
  summary: string[]
  note: string
  errors: string[]
}

const FORMATION_LABEL: Record<SurvivorTribeFormation, string> = { random: 'random', commissioner_manual: 'by the commissioner', draft_pattern: 'snake by draft' }

function describeBoss(form: SurvivorSettingsForm): string {
  switch (form.exileBossMode) {
    case 'fixed': return `a fixed ${form.exileBossFixedScore ?? 0}`
    case 'topN': return `the top-${form.exileBossTopN} average`
    case 'chimmy_roster': return "Chimmy's locked roster"
    default: return 'the league median'
  }
}

/** The right-hand preview: a strip of every week, a plain-English summary and the validation. */
export function buildSeasonPreview(form: SurvivorSettingsForm, ctx: SurvivorSettingsContext): SeasonPreview {
  const merge = effectiveMergeWeek(form, ctx)
  const weeks: SeasonPreview['weeks'] = []
  for (let week = ctx.firstWeek; week <= ctx.lastWeek; week++) {
    const kind: SeasonWeekKind = week === ctx.lastWeek ? 'finale'
      : form.swapEnabled && week === form.swapWeek ? 'swap'
        : week === merge ? 'merge'
          : week > merge ? 'jury'
            : 'tribal'
    weeks.push({ week, kind })
  }
  const perTribe = Math.max(1, Math.round(ctx.managers / Math.max(1, form.tribeCount)))
  const remainingAtMerge = Math.max(form.finalistCount, ctx.managers - Math.max(0, merge - ctx.firstWeek))
  const jurors = Math.max(0, remainingAtMerge - form.finalistCount)
  const summary = [
    `${form.tribeCount} tribes of ${perTribe}, formed ${FORMATION_LABEL[form.tribeFormation]}`,
    `${form.idolCount} hidden idols, revealed to holders by DM after the draft`,
    form.exileEnabled
      ? `Exile Island on: ${form.exileReturnTokens} ${form.exileReturnTokens === 1 ? 'token' : 'tokens'} to return, boss score is ${describeBoss(form)}`
      : 'Exile Island off: voted-out managers are out for good',
    form.mergeTrigger === 'week'
      ? form.swapEnabled ? `Swap in week ${form.swapWeek}, merge in week ${form.mergeWeek}` : `No swap, merge in week ${form.mergeWeek}`
      : form.swapEnabled ? `Swap in week ${form.swapWeek}, merge at ${form.mergeActivePlayerCount} managers left` : `No swap, merge at ${form.mergeActivePlayerCount} managers left`,
    `${jurors} ${jurors === 1 ? 'juror picks' : 'jurors pick'} from ${form.finalistCount} finalists in week ${ctx.lastWeek}`,
  ]
  const weekCount = ctx.lastWeek - ctx.firstWeek + 1
  const note = `One manager goes home each week. With ${ctx.managers} managers and ${weekCount} weeks there is room for ${form.finalistCount} finalists${form.exileEnabled ? ' plus Exile returns' : ''}.`
  return { weeks, summary, note, errors: validateSettingsForm(form, ctx) }
}

/** Shape check for a posted form (types only; ranges are validateSettingsForm's job). */
export function parseSettingsForm(input: unknown): SurvivorSettingsForm | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const r = input as Record<string, unknown>
  const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : NaN)
  const bool = (k: string) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : null)
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null)
  const formation = str('tribeFormation')
  const tie = str('tieRule')
  const boss = str('exileBossMode')
  const trigger = str('mergeTrigger')
  const bools = ['selfVotesAllowed', 'hideIdolsFromCommissioner', 'exileEnabled', 'swapEnabled', 'shareCardsEnabled', 'publicMomentPages'].map(bool)
  if (bools.some(b => b == null)) return null
  if (formation !== 'random' && formation !== 'commissioner_manual' && formation !== 'draft_pattern') return null
  if (!tie || !(SURVIVOR_TIE_RULES as readonly string[]).includes(tie)) return null
  if (boss !== 'median' && boss !== 'fixed' && boss !== 'topN' && boss !== 'chimmy_roster') return null
  if (trigger !== 'week' && trigger !== 'active_player_count') return null
  const finalist = num('finalistCount')
  if (finalist !== 2 && finalist !== 3) return null
  const fixedRaw = r.exileBossFixedScore
  const fixed = fixedRaw == null ? null : typeof fixedRaw === 'number' && Number.isFinite(fixedRaw) ? fixedRaw : NaN
  const form: SurvivorSettingsForm = {
    tribeCount: num('tribeCount'),
    tribeFormation: formation,
    voteDay: str('voteDay') ?? '',
    voteTime: str('voteTime') ?? '',
    selfVotesAllowed: bools[0]!,
    tieRule: tie as SurvivorTieRule,
    idolCount: num('idolCount'),
    hideIdolsFromCommissioner: bools[1]!,
    exileEnabled: bools[2]!,
    exileReturnTokens: num('exileReturnTokens'),
    exileBossMode: boss,
    exileBossFixedScore: fixed,
    exileBossTopN: num('exileBossTopN'),
    swapEnabled: bools[3]!,
    swapWeek: num('swapWeek'),
    mergeTrigger: trigger,
    mergeWeek: num('mergeWeek'),
    mergeActivePlayerCount: num('mergeActivePlayerCount'),
    finalistCount: finalist,
    shareCardsEnabled: bools[4]!,
    publicMomentPages: bools[5]!,
    // Added later than the others, so a form without it reads as off rather than invalid.
    spectatorPageEnabled: bool('spectatorPageEnabled') ?? false,
  }
  const numeric: SurvivorSettingsKey[] = ['tribeCount', 'idolCount', 'exileReturnTokens', 'exileBossTopN', 'swapWeek', 'mergeWeek', 'mergeActivePlayerCount']
  if (numeric.some(k => Number.isNaN(form[k] as number)) || Number.isNaN(fixed as number)) return null
  return form
}
