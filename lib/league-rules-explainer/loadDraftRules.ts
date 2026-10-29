import 'server-only'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { computeEffectivePickTimerSeconds, sessionDraftTypeFromLeagueSettings } from '@/lib/live-draft-engine/DraftSessionService'
import { getAuctionConfigFromSession } from '@/lib/live-draft-engine/auction/AuctionEngine'
import { readDraftOrderModeAndLotteryConfig } from '@/lib/draft-lottery/lotteryConfigStorage'
import { resolveRenewDraftOrderMode } from '@/lib/redraft/offseason/renewRedraftLeague'
import { startsAtScheduledTimeRegardlessOfAutostart } from '@/lib/draft/redraftScheduledStart'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { diffRuleSnapshots } from './changeKeys'
import { draftRulesFromInputs } from './snapshot'
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
  const lottery = readDraftOrderModeAndLotteryConfig(settings)
  const rawMode = String((settings as Record<string, unknown> | null)?.draft_order_mode ?? '').trim().toLowerCase()
  const orderMethod =
    lottery.draftOrderMode === 'weighted_lottery'
      ? 'weighted_lottery'
      : resolveRenewDraftOrderMode(ls?.draftOrderMethod) ??
        (rawMode === 'randomize' ? 'random' : rawMode === 'manual' ? 'manual' : null)

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
