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
  survivorWeeklyPrizeErrors,
  weeklyPrizesActive,
  type SurvivorTopScorerReward,
} from './survivorWeeklyPrizes'
import { SURVIVOR_REWARD_ADVANTAGE_POWERS } from './survivorRewardModel'
import { CHALLENGE_FAAB_WEEKLY_CAP_RANGE, DEFAULT_CHALLENGE_FAAB_WEEKLY_CAP } from './survivorChallengeBuilderModel'
import { REAL_GAME_ALLOWED_PRIZES, REAL_GAME_PRIZE_LIMITS, type RealGamePrizeType } from './survivorRealGameChallengeLogic'
import { defaultPrizePhaseRules, validatePrizePhaseRules, type SurvivorPrizePhaseRules } from './survivorChallengeBuilderModel'
import { seasonPreviewMessages, settingsErrorMessages, type SeasonPreviewCopy, type SettingsError, type SettingsErrorCode, type SettingsErrorCopy } from './survivorSettingsScreenCopy'

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
   * Rewards. Defaults keep today's behaviour: weekly tribe prizes before the merge only
   * (League.settings.survivorWeeklyPrizes.payInTribeWeeksAfterMerge), steals unrestricted
   * (League.settings.survivorThievesCannotStealFromEachOther), and every prize type allowed per phase
   * except the tribe FAAB transfer after the merge (League.settings.survivorPrizePhaseRules).
   */
  payInTribeWeeksAfterMerge: boolean
  thievesCannotStealFromEachOther: boolean
  prizePhaseRules: SurvivorPrizePhaseRules
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
/** 'auto' follows the season; 'rotate' picks a new scene every season (rotatingIslandScene). */
export type SurvivorIslandScenePreference = SurvivorIslandScene | 'auto' | 'rotate'

export function isSurvivorIslandScenePreference(value: unknown): value is SurvivorIslandScenePreference {
  return value === 'auto' || value === 'rotate' || (typeof value === 'string' && (SURVIVOR_ISLAND_SCENES as readonly string[]).includes(value))
}

/**
 * The scene a 'rotate' league shows this season: a pure function of (leagueId, season), so it needs
 * no rollover hook and never drifts. A stable hash of the league picks its starting scene; each
 * season steps one place on, so consecutive seasons always differ (and two leagues rarely match).
 * A season that is not a number counts as 0.
 */
export function rotatingIslandScene(leagueId: string, season: string | number | null | undefined): SurvivorIslandScene {
  let hash = 0x811c9dc5
  for (let i = 0; i < leagueId.length; i++) {
    hash ^= leagueId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const year = Number.parseInt(String(season ?? ''), 10)
  const step = Number.isFinite(year) ? year : 0
  const n = SURVIVOR_ISLAND_SCENES.length
  return SURVIVOR_ISLAND_SCENES[(((hash % n) + step) % n + n) % n]!
}

/** What the banner gets: a pinned scene, 'auto', or — for 'rotate' — this season's scene. */
export function resolveSurvivorIslandScene(pref: SurvivorIslandScenePreference, leagueId: string, season: string | number | null | undefined): SurvivorIslandScene | 'auto' {
  return pref === 'rotate' ? rotatingIslandScene(leagueId, season) : pref
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
  // Reward rules apply to the next reward handed out; nothing already paid changes.
  'payInTribeWeeksAfterMerge', 'thievesCannotStealFromEachOther', 'prizePhaseRules',
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

/** The form's problems as messages (English by default; pass `messagesFor(settingsErrorMessages, lang)`). */
export function validateSettingsForm(form: SurvivorSettingsForm, ctx: SurvivorSettingsContext, t: SettingsErrorCopy = settingsErrorMessages.en): string[] {
  return settingsFormErrors(form, ctx, t).map(e => e.message)
}

/** The form's problems with a stable code each, in the reader's language (`settingsErrorMessages`). */
export function settingsFormErrors(form: SurvivorSettingsForm, ctx: SurvivorSettingsContext, t: SettingsErrorCopy = settingsErrorMessages.en): SettingsError[] {
  const errors: SettingsError[] = []
  const push = (code: SettingsErrorCode, message: string) => errors.push({ code, message })
  const finale = ctx.lastWeek
  const merge = effectiveMergeWeek(form, ctx)
  const inRange = (n: number, [min, max]: readonly [number, number]) => Number.isInteger(n) && n >= min && n <= max
  if (!inRange(form.tribeCount, SURVIVOR_SETTINGS_LIMITS.tribeCount)) push('tribeCount', t.tribeCount)
  else {
    const slotError = validateTribeSlots(defaultTribeSlots(ctx.managers, form.tribeCount), ctx.managers, form.tribeCount)
    if (slotError) push('tribeSlots', t.tribeSlots(slotError))
  }
  if (!inRange(form.idolCount, SURVIVOR_SETTINGS_LIMITS.idolCount)) push('idolCount', t.idolCount)
  if (!(SURVIVOR_VOTE_DAYS as readonly string[]).includes(form.voteDay)) push('voteDay', t.voteDay)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.voteTime)) push('voteTime', t.voteTime)
  if (form.exileEnabled && (!Number.isInteger(form.exileReturnTokens) || form.exileReturnTokens < 1)) push('exileTokens', t.exileTokens)
  if (form.exileBossMode === 'fixed' && (form.exileBossFixedScore == null || !Number.isFinite(form.exileBossFixedScore) || form.exileBossFixedScore < 0 || form.exileBossFixedScore > 10000)) push('bossFixed', t.bossFixed)
  if (form.exileBossMode === 'topN' && !inRange(form.exileBossTopN, SURVIVOR_SETTINGS_LIMITS.exileBossTopN)) push('bossTopN', t.bossTopN)
  if (form.finalistCount !== 2 && form.finalistCount !== 3) push('finalists', t.finalists)
  if (form.mergeTrigger === 'week' && (!Number.isInteger(form.mergeWeek) || form.mergeWeek <= ctx.firstWeek)) push('mergeAfterFirst', t.mergeAfterFirst)
  if (form.mergeTrigger === 'active_player_count' && (!Number.isInteger(form.mergeActivePlayerCount) || form.mergeActivePlayerCount <= form.finalistCount || form.mergeActivePlayerCount >= ctx.managers)) push('mergeCount', t.mergeCount(form.finalistCount + 1, ctx.managers - 1))
  if (merge >= finale) push('mergeBeforeFinale', t.mergeBeforeFinale)
  if (form.islandScene !== undefined && !isSurvivorIslandScenePreference(form.islandScene)) push('islandScene', t.islandScene)
  if (form.swapEnabled) {
    if (!Number.isInteger(form.swapWeek) || form.swapWeek <= ctx.firstWeek) push('swapAfterFirst', t.swapAfterFirst)
    else if (form.swapWeek >= merge) push('swapBeforeMerge', t.swapBeforeMerge)
  }
  if ((form.houseRules ?? '').length > SURVIVOR_HOUSE_RULES_MAX) push('houseRules', t.houseRules(SURVIVOR_HOUSE_RULES_MAX))
  errors.push(...survivorWeeklyPrizeErrors(weeklyPrizesFromForm(form), ctx.sport, t))
  errors.push(...challengeSettingsErrors(form, t))
  if (form.prizePhaseRules !== undefined && !validatePrizePhaseRules(form.prizePhaseRules, 'en').ok) push('phaseRules', t.phaseRules)
  return errors
}

/** The challenge part of the form. Tolerates an older form without these fields (the defaults). */
export function validateChallengeSettings(form: Partial<SurvivorSettingsForm>, t: SettingsErrorCopy = settingsErrorMessages.en): string[] {
  return challengeSettingsErrors(form, t).map(e => e.message)
}

export function challengeSettingsErrors(form: Partial<SurvivorSettingsForm>, t: SettingsErrorCopy = settingsErrorMessages.en): SettingsError[] {
  const d = SURVIVOR_CHALLENGE_SETTING_DEFAULTS
  const errors: SettingsError[] = []
  const type = form.realGamePrizeType ?? d.realGamePrizeType
  const amount = form.realGamePrizeAmount ?? d.realGamePrizeAmount
  const perWeek = form.realGamePerWeek ?? d.realGamePerWeek
  const cap = form.challengeFaabWeeklyCap ?? d.challengeFaabWeeklyCap
  if (perWeek !== 1 && perWeek !== 2) errors.push({ code: 'realPerWeek', message: t.realPerWeek })
  if (!(REAL_GAME_ALLOWED_PRIZES as readonly string[]).includes(type)) errors.push({ code: 'realPrize', message: t.realPrize })
  if (type === 'faab' && (!Number.isInteger(amount) || amount < 1 || amount > REAL_GAME_PRIZE_LIMITS.faab)) errors.push({ code: 'realFaab', message: t.realFaab(REAL_GAME_PRIZE_LIMITS.faab) })
  if (type === 'score_bonus' && (!Number.isInteger(amount) || amount < 1 || amount > REAL_GAME_PRIZE_LIMITS.score_bonus)) errors.push({ code: 'realPoints', message: t.realPoints(REAL_GAME_PRIZE_LIMITS.score_bonus) })
  if (!Number.isInteger(cap) || cap < CHALLENGE_FAAB_WEEKLY_CAP_RANGE[0] || cap > CHALLENGE_FAAB_WEEKLY_CAP_RANGE[1]) errors.push({ code: 'faabCap', message: t.faabCap(CHALLENGE_FAAB_WEEKLY_CAP_RANGE[0], CHALLENGE_FAAB_WEEKLY_CAP_RANGE[1]) })
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
    payInTribeWeeksAfterMerge: form.payInTribeWeeksAfterMerge ?? d.payInTribeWeeksAfterMerge,
  }
}

export type SeasonWeekKind = 'tribal' | 'swap' | 'merge' | 'jury' | 'finale'

export interface SeasonPreview {
  weeks: { week: number; kind: SeasonWeekKind }[]
  summary: string[]
  note: string
  errors: string[]
}

function describeBoss(form: SurvivorSettingsForm, t: SeasonPreviewCopy): string {
  switch (form.exileBossMode) {
    case 'fixed': return t.bossFixed(form.exileBossFixedScore ?? 0)
    case 'topN': return t.bossTopN(form.exileBossTopN)
    case 'chimmy_roster': return t.bossChimmy
    default: return t.bossMedian
  }
}

function describePrizes(form: SurvivorSettingsForm, t: SeasonPreviewCopy): string {
  const parts: string[] = []
  if (form.winningTribeFaabPerPlayer > 0) parts.push(t.prizeFaab(form.winningTribeFaabPerPlayer))
  if (form.topScorerReward === 'faab') parts.push(t.prizeTopFaab(form.topScorerAmount))
  if (form.topScorerReward === 'score_boost') parts.push(t.prizeTopBoost(form.topScorerAmount))
  if (form.topScorerReward === 'advantage') parts.push(t.prizeTopAdvantage)
  if (form.payInTribeWeeksAfterMerge) parts.push(t.prizePostMerge)
  return t.prizeLine(parts.join(', '))
}

/**
 * The right-hand preview: a strip of every week, a plain-language summary and the validation. The
 * summary speaks the reader's language: pass `messagesFor(seasonPreviewMessages, language)`
 * (English by default).
 */
export function buildSeasonPreview(form: SurvivorSettingsForm, ctx: SurvivorSettingsContext, t: SeasonPreviewCopy = seasonPreviewMessages.en, errorCopy: SettingsErrorCopy = settingsErrorMessages.en): SeasonPreview {
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
    t.tribes(form.tribeCount, perTribe, t.formation(form.tribeFormation)),
    t.idols(form.idolCount),
    form.exileEnabled ? t.exileOn(form.exileReturnTokens, describeBoss(form, t)) : t.exileOff,
    form.mergeTrigger === 'week'
      ? form.swapEnabled ? t.swapMergeWeek(form.swapWeek, form.mergeWeek) : t.mergeWeek(form.mergeWeek)
      : form.swapEnabled ? t.swapMergeCount(form.swapWeek, form.mergeActivePlayerCount) : t.mergeCount(form.mergeActivePlayerCount),
    form.juryEnabled !== false ? t.jury(jurors, form.finalistCount, ctx.lastWeek) : t.noJury(form.finalistCount, ctx.lastWeek),
    ...(weeklyPrizesActive(weeklyPrizesFromForm(form)) ? [describePrizes(form, t)] : []),
    ...(form.thievesCannotStealFromEachOther ? [t.thieves] : []),
  ]
  const weekCount = ctx.lastWeek - ctx.firstWeek + 1
  const note = t.note(ctx.managers, weekCount, form.finalistCount, form.exileEnabled)
  return { weeks, summary, note, errors: validateSettingsForm(form, ctx, errorCopy) }
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
    // Reward rules: a form from before them keeps today's behaviour. A bad phase-rules shape is
    // kept as sent, so validateSettingsForm reports it rather than silently resetting it.
    payInTribeWeeksAfterMerge: bool('payInTribeWeeksAfterMerge') ?? false,
    thievesCannotStealFromEachOther: bool('thievesCannotStealFromEachOther') ?? false,
    prizePhaseRules: r.prizePhaseRules == null ? defaultPrizePhaseRules() : (r.prizePhaseRules as SurvivorPrizePhaseRules),
  }
  const numeric: SurvivorSettingsKey[] = ['tribeCount', 'idolCount', 'exileReturnTokens', 'exileBossTopN', 'swapWeek', 'mergeWeek', 'mergeActivePlayerCount', 'winningTribeFaabPerPlayer', 'topScorerAmount', 'realGamePrizeAmount', 'challengeFaabWeeklyCap']
  if (numeric.some(k => Number.isNaN(form[k] as number)) || Number.isNaN(fixed as number)) return null
  return form
}
