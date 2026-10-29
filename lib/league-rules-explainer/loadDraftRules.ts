import 'server-only'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { computeEffectivePickTimerSeconds, sessionDraftTypeFromLeagueSettings } from '@/lib/live-draft-engine/DraftSessionService'
import { getAuctionConfigFromSession } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { readDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { checkDynastyLotteryEligibility, isDynastyLeagueRow } from '@/lib/draft-lottery/dynastyYearGuard'
import { resolveRenewDraftOrderMode } from '@/lib/redraft/offseason/renewRedraftLeague'
import { startsAtScheduledTimeRegardlessOfAutostart } from '@/lib/draft/redraftScheduledStart'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { diffRuleSnapshots } from './changeKeys'
import { draftRulesFromInputs, dynastyRulesFromConfig, resolveRulesFormat, rookieDraftLotteryRule } from './snapshot'
import type { RuleChange, RuleSnapshot } from './types'

/**
 * The league's main draft rules for the rules popup and for the draft settings saves' "What changed"
 * card. Database only — no sports data provider is called.
 *
 * ⚠ DRAFT SETTINGS LIVE IN THREE STORES (League.settings `draft_*`, the LeagueSettings row and the
 * DraftSession), and the room does not read one of them throughout. This reads each value from the
 * store the engine uses AT THAT POINT, so the popup describes the draft that will actually run:
 *
 *   started (in_progress / paused / completed)   the session, for everything
 *   not started, a session exists                the session's type, rounds and 3RR; the pick clock
 *                                                and CPU autopick that startDraftSession re-applies
 *                                                from LeagueSettings + config + UI at the start
 *   no session yet                               what getOrCreateDraftSession will create
 *
 * A setting that changes nothing — LeagueSettings.aiAutoPick, which no engine path reads — is not
 * described at all.
 */
export async function loadDraftRules(leagueId: string): Promise<Partial<RuleSnapshot>> {
  const [league, session, ls, config, ui] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        platform: true, sport: true, leagueType: true, isDynasty: true, survivorMode: true,
        guillotineMode: true, leagueVariant: true, settings: true,
        dynastyConfig: { select: { rookiePickOrderMethod: true } },
      },
    }),
    prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: {
        status: true, draftType: true, rounds: true, timerSeconds: true, thirdRoundReversal: true,
        auctionBudgetPerTeam: true, cpuAutoPick: true, draftModeLabel: true,
      },
    }),
    prisma.leagueSettings.findUnique({
      where: { leagueId },
      select: {
        draftDateUtc: true, autostart: true, cpuAutoPick: true, draftType: true, rounds: true,
        pickTimerPreset: true, pickTimerCustomValue: true, draftOrderMethod: true,
      },
    }),
    getDraftConfigForLeague(leagueId),
    getDraftUISettingsForLeague(leagueId),
  ])
  // An imported league drafts on its own platform.
  if (!league || !isNativePlatform(league.platform)) return {}

  const started = session != null && session.status !== 'pre_draft' && session.status !== 'configuring' && session.status !== 'configured'
  const fromLs = ls ? sessionDraftTypeFromLeagueSettings(ls.draftType) : null
  const draftType = session?.draftType ?? fromLs?.draftType ?? config?.draft_type ?? null
  const auction =
    draftType === 'auction'
      ? getAuctionConfigFromSession({
          auctionBudgetPerTeam: session?.auctionBudgetPerTeam ?? null,
          timerSeconds: session?.timerSeconds ?? null,
        })
      : null
  // An auction's clock is the bid clock (the session's); a pick clock is re-applied at the start.
  const pickSeconds = auction
    ? auction.bidTimerSeconds
    : started
      ? session!.timerSeconds
      : computeEffectivePickTimerSeconds(ls, config, ui)

  const settings = league.settings
  const rawMode = String((settings as Record<string, unknown> | null)?.draft_order_mode ?? '').trim().toLowerCase()
  const orderMethod =
    (await lotterySeatsDraftOrder(leagueId, league))
      ? 'weighted_lottery'
      : resolveRenewDraftOrderMode(ls?.draftOrderMethod) ??
        (rawMode === 'randomize'
          ? 'random'
          : // `weighted_lottery` with no lottery behind it seats exactly what `manual` does (below).
            rawMode === 'manual' || rawMode === 'weighted_lottery'
            ? 'manual'
            : null)

  return draftRulesFromInputs({
    sessionLabel: session?.draftModeLabel ?? null,
    sessionStatus: session?.status ?? null,
    draftType,
    rounds: session?.rounds ?? ls?.rounds ?? config?.rounds ?? null,
    pickSeconds,
    thirdRoundReversal: session ? session.thirdRoundReversal : fromLs ? fromLs.thirdRoundReversal : config?.third_round_reversal ?? false,
    timerMode: ui.timerMode,
    pauseWindow: ui.slowDraftPauseWindow ?? null,
    picksDuringPause: ui.allowPicksDuringOvernightPause === true,
    autoPickEnabled: ui.autoPickEnabled !== false,
    // startDraftSession copies LeagueSettings.cpuAutoPick onto the session when the draft starts.
    cpuAutoPick: started ? session!.cpuAutoPick !== false : (ls?.cpuAutoPick ?? session?.cpuAutoPick ?? true) !== false,
    autopickBehavior: config?.autopick_behavior ?? null,
    orderMethod,
    auction: auction ? { budget: auction.budgetPerTeam, minBid: auction.minBid } : null,
    startAt: ls?.draftDateUtc ? ls.draftDateUtc.toISOString() : null,
    autostart: ls?.autostart === true || startsAtScheduledTimeRegardlessOfAutostart(league),
    orphanEnabled: ui.orphanTeamAiManagerEnabled === true,
    orphanMode: ui.orphanDrafterMode ?? null,
  })
}

/**
 * Whether a weighted lottery draw is what seats this league's draft order.
 *
 * 🛑 `settings.draft_order_mode === 'weighted_lottery'` ALONE DOES NOT RUN A LOTTERY, AND THE POPUP
 * USED TO SAY IT DID. Every engine path that seats a draw — `resolveWeightedLotterySlotOrderForLeague`
 * (buildSlotOrderForLeague / the session repair) and `ensureRookieDraftLottery` (createNextLeagueDraft)
 * — requires a dynasty league whose `DynastyLeagueConfig.rookiePickOrderMethod` is `weighted_lottery`,
 * past its founding season (`checkDynastyLotteryEligibility`). Neither reads `draft_order_mode` at all.
 *
 * Anywhere else — a redraft league, a dynasty league whose rookie order is something else, a startup
 * year — `buildSlotOrderForLeague` seats what it seats under any mode: the commissioner's saved order
 * (`LeagueSettings.draftOrderSlots`, typed in or produced by "Randomize"), else the seat order. That is
 * the `manual` sentence ("The commissioner sets the draft order, by hand or with a random draw."), or
 * the saved order method's own when `LeagueSettings.draftOrderMethod` names one.
 */
async function lotterySeatsDraftOrder(
  leagueId: string,
  league: { isDynasty: boolean; leagueVariant: string | null; dynastyConfig?: { rookiePickOrderMethod: string | null } | null },
): Promise<boolean> {
  if (!isDynastyLeagueRow(league)) return false
  if (league.dynastyConfig?.rookiePickOrderMethod !== 'weighted_lottery') return false
  return (await checkDynastyLotteryEligibility(leagueId)).eligible
}

/** loadDraftRules, or null when it cannot be read — a save never fails over its change card. */
export async function loadDraftRulesSafe(leagueId: string): Promise<Partial<RuleSnapshot> | null> {
  try {
    return await loadDraftRules(leagueId)
  } catch (e) {
    console.warn('[loadDraftRules]', e instanceof Error ? e.message : 'unknown error')
    return null
  }
}

/**
 * The draft rules a save changed. Nothing when either side could not be read, or when the draft was
 * already complete before the save: those settings no longer change anything this season, so a
 * "What changed" line for them would announce a rule nobody plays under.
 */
export function draftRuleChanges(before: Partial<RuleSnapshot> | null, after: Partial<RuleSnapshot> | null): RuleChange[] {
  if (!before || !after || before.draftStatus === 'completed') return []
  return diffRuleSnapshots(before, after)
}

/**
 * The rookie lottery's rules (`rookieDraftLottery`, the Dynasty section) for the lottery config saves'
 * "What changed" card. Database only.
 *
 * ⚠ THE LOTTERY ORDERS THE DYNASTY ROOKIE DRAFT, NOT THE MAIN DRAFT. Every engine path that seats a
 * lottery draw — `ensureRookieDraftLottery` (createNextLeagueDraft) and
 * `resolveWeightedLotterySlotOrderForLeague` (DraftSessionService) — returns nothing unless the league
 * is dynasty and `DynastyLeagueConfig.rookiePickOrderMethod` is `weighted_lottery`. So these lines
 * belong beside the rookie order in the Dynasty section, which a dynasty league always shows; the
 * Draft section is hidden while the current draft is a rookie draft anyway (draftRulesFromInputs).
 *
 * Empty (key absent, so nothing diffs) for a league that is not an AllFantasy-hosted dynasty league.
 */
export async function loadRookieLotteryRules(leagueId: string): Promise<Partial<RuleSnapshot>> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      platform: true, sport: true, leagueType: true, leagueVariant: true, isDynasty: true, guillotineMode: true,
      bestBallMode: true, survivorMode: true, settings: true,
      dynastyConfig: { select: { rookiePickOrderMethod: true } },
    },
  })
  if (!league || !isNativePlatform(league.platform) || resolveRulesFormat(league) !== 'dynasty') return {}
  const { rookieDraftOrder } = dynastyRulesFromConfig(league.dynastyConfig ?? null)
  return { rookieDraftLottery: rookieDraftLotteryRule(rookieDraftOrder, readDraftOrderModeAndLotteryConfig(league.settings).lotteryConfig) }
}

/** loadRookieLotteryRules, or null when it cannot be read — a save never fails over its change card. */
export async function loadRookieLotteryRulesSafe(leagueId: string): Promise<Partial<RuleSnapshot> | null> {
  try {
    return await loadRookieLotteryRules(leagueId)
  } catch (e) {
    console.warn('[loadRookieLotteryRules]', e instanceof Error ? e.message : 'unknown error')
    return null
  }
}

/**
 * The rookie lottery rules a save changed. Nothing when either side could not be read.
 *
 * 🛑 NOT SUPPRESSED BY A COMPLETED DRAFT, UNLIKE draftRuleChanges. The config never reorders a draft
 * that already has its order: it governs the NEXT draw — the next rookie draft's lottery, run when that
 * draft is created (or when the commissioner presses "Run"). A completed startup or rookie draft is
 * therefore exactly when this setting is still to come, and hiding the card then would hide the only
 * moment it matters.
 */
export function rookieLotteryRuleChanges(before: Partial<RuleSnapshot> | null, after: Partial<RuleSnapshot> | null): RuleChange[] {
  if (!before || !after) return []
  return diffRuleSnapshots(before, after)
}

/**
 * Settings-patch body keys that can move a draft rule (executeLeagueSettingsPatch): the LeagueSettings
 * draft columns, plus any `draft_*` key merged into League.settings.
 */
export const DRAFT_RULE_PATCH_KEYS: ReadonlySet<string> = new Set([
  'draftDateUtc',
  'autostart',
  'slowDraftPause',
  'slowPauseFrom',
  'slowPauseUntil',
  'cpuAutoPick',
  'draftType',
  'pickTimerPreset',
  'pickTimerCustomValue',
  'rounds',
  'draftOrderMethod',
])

export function patchTouchesDraftRules(body: Record<string, unknown>): boolean {
  if (Object.keys(body).some((k) => DRAFT_RULE_PATCH_KEYS.has(k))) return true
  const merge = body.settingsMerge
  return !!merge && typeof merge === 'object' && Object.keys(merge as object).some((k) => k.startsWith('draft_'))
}
