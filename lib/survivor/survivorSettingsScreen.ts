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
import type { SurvivorExileBossMode, SurvivorMergeNamingMode } from './lateSeasonSettings'
import type { SurvivorCoCommissionerMode } from './survivorSettings'
import type { SurvivorRewardAdvantagePower } from './survivorRewardModel'
import {
  SURVIVOR_HOUSE_RULES_MAX,
  SURVIVOR_TOP_SCORER_REWARDS,
  SURVIVOR_WEEKLY_PRIZE_DEFAULTS,
  validateSurvivorWeeklyPrizes,
  weeklyPrizesActive,
  type SurvivorTopScorerReward,
} from './survivorWeeklyPrizes'
import { SURVIVOR_REWARD_ADVANTAGE_POWERS } from './survivorRewardModel'
import { CHALLENGE_FAAB_WEEKLY_CAP_RANGE, DEFAULT_CHALLENGE_FAAB_WEEKLY_CAP } from './survivorChallengeBuilderModel'
import { REAL_GAME_ALLOWED_PRIZES, REAL_GAME_PRIZE_LIMITS, type RealGamePrizeType } from './survivorRealGameChallengeLogic'
import { SURVIVOR_SIDE_GAME_DEFAULTS, validateSurvivorSideGamePatch, type SurvivorSideGameKey, type SurvivorSideGameSettings } from './survivorSideGameSettings'

/**
 * The key side-game settings, also shown on this screen (they live in League.settings.survivorSideGames
 * with the rest; the full set is in league settings → Exile). Both screens save through ONE validator,
 * `validateSurvivorSideGamePatch`, and the side games' own season locks, so they cannot disagree.
 */
export const SIDE_GAME_SCREEN_KEYS = [
  'tokenPoolEnabled', 'tokenPoolMode', 'tokenPoolWrongPick', 'tokenShopEnabled',
  'survivorPoolEnabled', 'survivorPoolTieRule', 'survivorPoolMissedPick', 'survivorPoolNoReuse',
  'exileClaimMode', 'exileBidBudget', 'exileTokenFaabRate', 'hideExileMembership',
] as const satisfies readonly SurvivorSideGameKey[]
export type SideGameScreenKey = (typeof SIDE_GAME_SCREEN_KEYS)[number]
export type SurvivorScreenSideGames = Pick<SurvivorSideGameSettings, SideGameScreenKey>

/** The screen's side-game values from the league's full side-game settings. */
export function sideGamesForScreen(s: SurvivorSideGameSettings): SurvivorScreenSideGames {
  const out = {} as Record<string, unknown>
  for (const k of SIDE_GAME_SCREEN_KEYS) out[k] = s[k]
  return out as SurvivorScreenSideGames
}

/** The screen keys whose value differs from what is saved (the patch the save sends on). */
export function changedSideGameScreenKeys(saved: Partial<SurvivorScreenSideGames> | undefined, draft: Partial<SurvivorScreenSideGames> | undefined): SideGameScreenKey[] {
  if (!draft) return []
  return SIDE_GAME_SCREEN_KEYS.filter((k) => k in draft && JSON.stringify(draft[k]) !== JSON.stringify(saved?.[k]))
}

/**
 * The shared check: the same validator the league-settings panel and the Hub save with. `current`
 * is the league's full side-game settings (defaults on the client); `locked` the side-game keys
 * locked this season. Returns plain-English errors.
 */
export function validateSideGameScreenValues(
  values: Partial<SurvivorScreenSideGames>,
  current: SurvivorSideGameSettings = SURVIVOR_SIDE_GAME_DEFAULTS,
  locked: readonly SurvivorSideGameKey[] = [],
): string[] {
  const patch: Record<string, unknown> = {}
  for (const k of SIDE_GAME_SCREEN_KEYS) if (k in values && JSON.stringify(values[k]) !== JSON.stringify(current[k])) patch[k] = values[k]
  if (!Object.keys(patch).length) return []
  const result = validateSurvivorSideGamePatch(current, patch, locked)
  return result.ok ? [] : [result.error]
}

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
  /**
   * Settings that existed in storage with no screen (each one has a live reader — see the PR).
   * coCommissionerMode → survivorAccessControl; mergeNamingMode → tribeSwapService; juryEnabled →
   * survivorEliminationService; tribeChatsEnabled → survivorTribeChatProvisioning;
   * exileHarshTokenLoss (League.survivorExileHarshTokenLoss) → tokenPoolEngine.
   */
  coCommissionerMode: SurvivorCoCommissionerMode
  mergeNamingMode: SurvivorMergeNamingMode
  juryEnabled: boolean
  tribeChatsEnabled: boolean
  exileHarshTokenLoss: boolean
  /** Free text, shown in the rulebook and quoted by Chimmy (League.settings.survivorHouseRules). */
  houseRules: string
  /** Weekly tribe prizes (League.settings.survivorWeeklyPrizes; survivorWeeklyPrizes.ts). */
  winningTribeFaabPerPlayer: number
  topScorerReward: SurvivorTopScorerReward
  topScorerAmount: number
  topScorerPowerType: SurvivorRewardAdvantagePower
  tribeTieBreakPosition: string
  /**
   * Challenges (League.settings.survivorRealGameChallenges and survivorChallengeFaabWeeklyCap). The
   * defaults are today's behaviour: real-game challenges on, up to two a week, $5 FAAB; challenge
   * FAAB capped at $40 per winner per week. The system-run weekly challenges toggle stays where it
   * was (league settings → Challenges panel).
   */
  realGameEnabled: boolean
  realGamePerWeek: 1 | 2
  realGamePrizeType: RealGamePrizeType
  realGamePrizeAmount: number
  challengeFaabWeeklyCap: number
  /**
   * The island banner's scene: one of SURVIVOR_ISLAND_SCENES, or 'auto' to follow the season.
   * Optional on purpose: a form posted without it (an older screen) changes nothing, rather than
   * resetting a commissioner's pick to 'auto'. Stored as league.settings.survivorIslandScene.
   */
  islandScene?: SurvivorIslandScenePreference
  /**
   * The key side-game settings (SIDE_GAME_SCREEN_KEYS). Optional for the same reason as islandScene:
   * a form posted without it changes no side game. Each key keeps the side games' own season lock.
   */
  sideGames?: Partial<SurvivorScreenSideGames>
}

export const SURVIVOR_CHALLENGE_SETTING_DEFAULTS = {
  realGameEnabled: true,
  realGamePerWeek: 2 as 1 | 2,
  realGamePrizeType: 'faab' as RealGamePrizeType,
  realGamePrizeAmount: 5,
  challengeFaabWeeklyCap: DEFAULT_CHALLENGE_FAAB_WEEKLY_CAP,
}

/** The banner art in public/survivor/scenes/<scene>.svg, in the order the picker shows them. */
export const SURVIVOR_ISLAND_SCENES = ['beach', 'tribal', 'merge', 'finale', 'exile', 'jungle', 'volcano', 'lagoon'] as const
export type SurvivorIslandScene = (typeof SURVIVOR_ISLAND_SCENES)[number]
export type SurvivorIslandScenePreference = SurvivorIslandScene | 'auto'

export function isSurvivorIslandScenePreference(value: unknown): value is SurvivorIslandScenePreference {
  return value === 'auto' || (typeof value === 'string' && (SURVIVOR_ISLAND_SCENES as readonly string[]).includes(value))
}

/** The saved scene from a league's settings JSON; anything missing or unknown follows the season. */
export function readSurvivorIslandScene(settings: unknown): SurvivorIslandScenePreference {
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).survivorIslandScene : null
  return isSurvivorIslandScenePreference(raw) ? raw : 'auto'
}

export type SurvivorSettingsKey = keyof SurvivorSettingsForm

/** Everything else locks when the draft starts. */
export const SURVIVOR_SETTINGS_EDITABLE_ALL_SEASON: readonly SurvivorSettingsKey[] = [
  'voteDay', 'voteTime', 'exileBossMode', 'exileBossFixedScore', 'exileBossTopN', 'shareCardsEnabled', 'publicMomentPages',
  'spectatorPageEnabled', 'islandScene',
  // Merge naming is already changeable mid-season from the Hub; the token-pool rule, the house rules
  // and the weekly prizes apply going forward, so changing them never rewrites a past week.
  'mergeNamingMode', 'exileHarshTokenLoss', 'houseRules',
  'winningTribeFaabPerPlayer', 'topScorerReward', 'topScorerAmount', 'topScorerPowerType',
  // Challenge settings apply to the next challenge opened; a running one keeps its own prize.
  'realGameEnabled', 'realGamePerWeek', 'realGamePrizeType', 'realGamePrizeAmount', 'challengeFaabWeeklyCap',
  // The side games run week to week; the ones that must not change mid-season lock on their own
  // (SIDE_GAME_KEYS_LOCKED_AT_SEASON_START, enforced by the shared side-game validator).
  'sideGames',
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
  /** The league's sport (tie-break positions). Defaults to NFL. */
  sport?: string
  /** The league's full side-game settings, so the shared validator checks against what is saved. */
  sideGames?: SurvivorSideGameSettings
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
  if (form.islandScene !== undefined && !isSurvivorIslandScenePreference(form.islandScene)) errors.push('Pick one of the island scenes, or follow the season.')
  if (form.swapEnabled) {
    if (!Number.isInteger(form.swapWeek) || form.swapWeek <= ctx.firstWeek) errors.push('The swap must come after the first Tribal Council.')
    else if (form.swapWeek >= merge) errors.push('The swap must come before the merge.')
  }
  if ((form.houseRules ?? '').length > SURVIVOR_HOUSE_RULES_MAX) errors.push(`House rules can be at most ${SURVIVOR_HOUSE_RULES_MAX} characters.`)
  errors.push(...validateSurvivorWeeklyPrizes(weeklyPrizesFromForm(form), ctx.sport))
  errors.push(...validateChallengeSettings(form))
  if (form.sideGames) errors.push(...validateSideGameScreenValues(form.sideGames, ctx.sideGames ?? SURVIVOR_SIDE_GAME_DEFAULTS))
  return errors
}

/** The challenge part of the form. Tolerates an older form without these fields (the defaults). */
export function validateChallengeSettings(form: Partial<SurvivorSettingsForm>): string[] {
  const d = SURVIVOR_CHALLENGE_SETTING_DEFAULTS
  const errors: string[] = []
  const type = form.realGamePrizeType ?? d.realGamePrizeType
  const amount = form.realGamePrizeAmount ?? d.realGamePrizeAmount
  const perWeek = form.realGamePerWeek ?? d.realGamePerWeek
  const cap = form.challengeFaabWeeklyCap ?? d.challengeFaabWeeklyCap
  if (perWeek !== 1 && perWeek !== 2) errors.push('Real-game challenges run one or two a week.')
  if (!(REAL_GAME_ALLOWED_PRIZES as readonly string[]).includes(type)) errors.push('Choose FAAB, points or no prize for real-game challenges.')
  if (type === 'faab' && (!Number.isInteger(amount) || amount < 1 || amount > REAL_GAME_PRIZE_LIMITS.faab)) errors.push(`A real-game FAAB prize is $1 to $${REAL_GAME_PRIZE_LIMITS.faab}.`)
  if (type === 'score_bonus' && (!Number.isInteger(amount) || amount < 1 || amount > REAL_GAME_PRIZE_LIMITS.score_bonus)) errors.push(`A real-game points prize is 1 to ${REAL_GAME_PRIZE_LIMITS.score_bonus} points.`)
  if (!Number.isInteger(cap) || cap < CHALLENGE_FAAB_WEEKLY_CAP_RANGE[0] || cap > CHALLENGE_FAAB_WEEKLY_CAP_RANGE[1]) errors.push(`The weekly challenge FAAB cap is $${CHALLENGE_FAAB_WEEKLY_CAP_RANGE[0]} to $${CHALLENGE_FAAB_WEEKLY_CAP_RANGE[1]}.`)
  return errors
}

/** The stored `survivorRealGameChallenges` block for a form (merged over what is stored). */
export function realGameSettingsFromForm(form: SurvivorSettingsForm, stored: unknown): Record<string, unknown> {
  const prev = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {}
  const block: Record<string, unknown> = { ...prev, enabled: form.realGameEnabled, perWeek: form.realGamePerWeek, prizeType: form.realGamePrizeType }
  if (form.realGamePrizeType === 'faab') block.faabAmount = form.realGamePrizeAmount
  if (form.realGamePrizeType === 'score_bonus') block.pointsAmount = form.realGamePrizeAmount
  return block
}

/**
 * The weekly-prize part of the form, in the stored shape. Tolerates a form from before these fields
 * existed (an older client or cached payload): a missing field is the default, no prize.
 */
export function weeklyPrizesFromForm(form: SurvivorSettingsForm) {
  const d = SURVIVOR_WEEKLY_PRIZE_DEFAULTS
  const reward = form.topScorerReward ?? d.topScorerReward
  return {
    winningTribeFaabPerPlayer: form.winningTribeFaabPerPlayer ?? d.winningTribeFaabPerPlayer,
    topScorerReward: reward,
    topScorerAmount: reward === 'none' || reward === 'advantage' ? 0 : form.topScorerAmount ?? 0,
    topScorerPowerType: form.topScorerPowerType ?? d.topScorerPowerType,
    tribeTieBreakPosition: form.tribeTieBreakPosition ?? d.tribeTieBreakPosition,
  }
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

function describePrizes(form: SurvivorSettingsForm): string {
  const parts: string[] = []
  if (form.winningTribeFaabPerPlayer > 0) parts.push(`$${form.winningTribeFaabPerPlayer} FAAB per player`)
  if (form.topScorerReward === 'faab') parts.push(`$${form.topScorerAmount} more for its top scorer`)
  if (form.topScorerReward === 'score_boost') parts.push(`+${form.topScorerAmount} points next week for its top scorer`)
  if (form.topScorerReward === 'advantage') parts.push('an advantage for its top scorer')
  return `Weekly tribe prize: ${parts.join(', ')}`
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
    form.juryEnabled !== false
      ? `${jurors} ${jurors === 1 ? 'juror picks' : 'jurors pick'} from ${form.finalistCount} finalists in week ${ctx.lastWeek}`
      : `No jury: ${form.finalistCount} finalists in week ${ctx.lastWeek}`,
    ...(weeklyPrizesActive(weeklyPrizesFromForm(form)) ? [describePrizes(form)] : []),
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
  // Optional (see SurvivorSettingsForm.islandScene); present but unknown is a bad form, not 'auto'.
  if (r.islandScene !== undefined && !isSurvivorIslandScenePreference(r.islandScene)) return null
  const finalist = num('finalistCount')
  if (finalist !== 2 && finalist !== 3) return null
  const coRaw = str('coCommissionerMode')
  const coMode = coRaw == null ? null : coRaw === 'disabled' || coRaw === 'non_participating_host' || coRaw === 'same_privacy_as_commissioner' ? coRaw : undefined
  if (coMode === undefined) return null
  const topRaw = str('topScorerReward')
  const topReward = topRaw == null ? null : (SURVIVOR_TOP_SCORER_REWARDS as readonly string[]).includes(topRaw) ? (topRaw as SurvivorTopScorerReward) : undefined
  if (topReward === undefined) return null
  const powerRaw = str('topScorerPowerType')
  const power = powerRaw == null ? null : (SURVIVOR_REWARD_ADVANTAGE_POWERS as readonly string[]).includes(powerRaw) ? (powerRaw as SurvivorRewardAdvantagePower) : undefined
  if (power === undefined) return null
  // Optional side-game block: present but malformed (not an object, or a key this screen does not
  // own) is a bad form; values are range-checked by validateSettingsForm's shared validator.
  let sideGames: Partial<SurvivorScreenSideGames> | undefined
  if (r.sideGames !== undefined) {
    const sg = r.sideGames
    if (!sg || typeof sg !== 'object' || Array.isArray(sg)) return null
    const keys = Object.keys(sg)
    if (keys.some((k) => !(SIDE_GAME_SCREEN_KEYS as readonly string[]).includes(k))) return null
    // Only the keys sent: a key left out keeps its saved value (never reset to a default).
    sideGames = { ...(sg as Record<string, unknown>) } as Partial<SurvivorScreenSideGames>
  }
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
    ...(r.islandScene !== undefined && { islandScene: r.islandScene as SurvivorIslandScenePreference }),
    ...(sideGames && { sideGames }),
    // Added later still: a form without them keeps today's behaviour (the defaults).
    coCommissionerMode: coMode ?? 'disabled',
    mergeNamingMode: str('mergeNamingMode') === 'manager_vote' ? 'manager_vote' : 'commissioner',
    juryEnabled: bool('juryEnabled') ?? true,
    tribeChatsEnabled: bool('tribeChatsEnabled') ?? true,
    exileHarshTokenLoss: bool('exileHarshTokenLoss') ?? false,
    houseRules: (str('houseRules') ?? '').replace(/\r\n/g, '\n'),
    winningTribeFaabPerPlayer: r.winningTribeFaabPerPlayer == null ? SURVIVOR_WEEKLY_PRIZE_DEFAULTS.winningTribeFaabPerPlayer : num('winningTribeFaabPerPlayer'),
    topScorerReward: topReward ?? 'none',
    topScorerAmount: r.topScorerAmount == null ? 0 : num('topScorerAmount'),
    topScorerPowerType: power ?? 'extra_vote',
    tribeTieBreakPosition: (str('tribeTieBreakPosition') ?? 'none').trim() || 'none',
    // Challenge settings: a form from before them keeps today's behaviour.
    realGameEnabled: bool('realGameEnabled') ?? SURVIVOR_CHALLENGE_SETTING_DEFAULTS.realGameEnabled,
    realGamePerWeek: r.realGamePerWeek === 1 ? 1 : SURVIVOR_CHALLENGE_SETTING_DEFAULTS.realGamePerWeek,
    realGamePrizeType: (REAL_GAME_ALLOWED_PRIZES as readonly string[]).includes(String(r.realGamePrizeType)) ? (r.realGamePrizeType as RealGamePrizeType) : SURVIVOR_CHALLENGE_SETTING_DEFAULTS.realGamePrizeType,
    realGamePrizeAmount: r.realGamePrizeAmount == null ? SURVIVOR_CHALLENGE_SETTING_DEFAULTS.realGamePrizeAmount : num('realGamePrizeAmount'),
    challengeFaabWeeklyCap: r.challengeFaabWeeklyCap == null ? SURVIVOR_CHALLENGE_SETTING_DEFAULTS.challengeFaabWeeklyCap : num('challengeFaabWeeklyCap'),
  }
  const numeric: SurvivorSettingsKey[] = ['tribeCount', 'idolCount', 'exileReturnTokens', 'exileBossTopN', 'swapWeek', 'mergeWeek', 'mergeActivePlayerCount', 'winningTribeFaabPerPlayer', 'topScorerAmount', 'realGamePrizeAmount', 'challengeFaabWeeklyCap']
  if (numeric.some(k => Number.isNaN(form[k] as number)) || Number.isNaN(fixed as number)) return null
  return form
}
