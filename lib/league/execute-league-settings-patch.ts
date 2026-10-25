/**
 * Shared commissioner league settings PATCH logic used by:
 * - POST /api/league/settings (body.leagueId)
 * - PATCH /api/leagues/[leagueId]/settings (section + updates)
 */

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import {
  buildLeagueUpdateFromBody,
} from '@/lib/league/commissioner-league-patch'
import { keeperProvenanceFromCommissionerSave } from '@/lib/league-contract/keeperProvenance'
import { CO_COMMISSIONER_SCOPES_KEY, scopesForSettingsPatch } from '@/lib/league/coCommissionerScopes'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { SETTINGS_LOCK_KEY, lockedMessage } from '@/lib/league/settingsLock'
import { lockedGroupsForPatch } from '@/lib/league/settingsLockService'
import { buildWriteAuthorityEnvelope } from '@/lib/league/write-authority'
import { isValidIanaTimeZone } from '@/lib/timezone'
import { syncDraftSessionFromLeagueSettings } from '@/lib/league/league-settings-draft-sync'
import { copyLeagueDraftTimeToTournament } from '@/lib/tournament/divisions/leagueDraftTimeToTournament'
import { validateDraftRoundsFitRoster } from '@/lib/live-draft-engine/RosterFitValidation'
import { syncCommissionerDerivedLeagueState } from '@/lib/league/commissioner-settings-derived-sync'
import { assertSettingsEditAllowed } from '@/server/services/commissionerService'
import {
  decideSettingsEdit,
  lifecycleSectionsTouchedByPatch,
  recordMidSeasonSettingsChange,
  type SettingsEditDecision,
  type LifecycleGatedSection,
} from '@/lib/league/settingsLifecycleGate'
import { MID_SEASON_CONFIRM_FLAG } from '@/lib/league/midSeasonConfirmation'
import { logAction } from '@/server/services/auditService'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { checkByePlan, isNaturalByePlan } from '@/lib/playoff-brackets/byePlan'
import { nativeFormatPatch } from '@/lib/league/nativeFormatPatch'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { resizeNativeLeague } from '@/lib/league/resizeNativeLeague'
import { structuralPatchRefusal } from '@/lib/league/structuralSettingsLock'
import { leagueChatThreadLinkRefusalInPatch } from '@/lib/league/leagueChatThreadLink'
import { parseDeadlineAtInput, TRADE_DEADLINE_AT_KEY } from '@/lib/trade-deadline/tradeDeadlineTime'
import { parseTiebreakerOrder, TIEBREAKER_ORDER_KEY, type TiebreakerKey } from '@/lib/standings/tiebreakerOrder'
import { keeperRuleSettingsRefusal } from '@/lib/keeper/keeperRuleGate'
import {
  DAILY_WAIVER_PRIOR_PROCESSING_SETTINGS_KEY,
  DAILY_WAIVER_SCHEDULE_SETTINGS_KEY,
  deriveEngineProcessingFromSchedule,
  parseDailyWaiverSchedule,
  parsePriorWaiverProcessing,
  readDailyWaiverScheduleFromSettings,
  toDayIndexArray,
  toHhmmOrNull,
  type DailyWaiverSchedule,
  type PriorWaiverProcessing,
} from '@/lib/waivers/dailyWaiverSchedule'
import { upsertLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { parseWaiverEngineConfig } from '@/lib/waiver-wire/waiver-engine-config'
import {
  HUB_WAIVER_OPTION_KEYS,
  hasHubWaiverOptions,
  parseHubWaiverOptions,
  weeklyResetSurvivorRefusal,
} from '@/lib/waiver-wire/hub-waiver-options'
import { isSurvivorLeague } from '@/lib/survivor/SurvivorLeagueConfig'
import { refreshLeagueWaiverNextRunAt } from '@/lib/waiver-wire/waiver-state-service'
import {
  PROSPECT_STASH_UNAVAILABLE_CODE,
  PROSPECT_STASH_UNAVAILABLE_MESSAGE,
  isTaxiIncreaseRefused,
} from '@/lib/league-creation/prospectStashPolicy'
import { readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { MEDIAN_GAME_IN_PLAYOFFS_SETTINGS_KEY } from '@/lib/redraft/medianGame'
import { playoffFitOverflow, playoffFitOverflowMessage, type PlayoffFitChange } from '@/lib/playoff-runtime/championshipLengthFit'
import { MAX_PLAYOFF_TEAMS } from '@/lib/playoff-runtime/playoffFit'
import { resizedPlayoffColumns } from '@/lib/league-defaults/redraftPlayoffFit'
import { REDRAFT_SEASON_STATUS } from '@/lib/redraft/seasonStatus'
import { GAMES_LIMITS_SETTINGS_KEY, parseGamesLimits, readGamesLimits, type GamesLimits } from '@/lib/redraft/gamesLimits'
import {
  keepLineupModeFields,
  lineupModeSwitchRefusal,
  parseLineupMode,
  readLineupMode,
  withLineupMode,
  type LineupMode,
} from '@/lib/redraft/lineupModeSwitch'
import { gamesCountSportConfigError } from '@/lib/redraft/gamesCount'
import { gamesCountChangeRefusal, gamesCountSettingOf, keepGamesCountFields } from '@/lib/redraft/gamesCountSwitch'

const DRAFT_TYPES = new Set(['snake', 'linear', '3rd_reversal', 'auction'])
const ORDER_METHODS = new Set([
  'manual',
  'randomized',
  'prev_standings',
  'worst_to_first',
  'reverse_max_pf',
  'custom_import',
])
const PLAYER_POOLS = new Set(['all', 'rookies_only', 'veterans_only'])
const AI_SCOPES = new Set(['everyone', 'per_user', 'commissioner_only', 'disabled'])
const TIMER_PRESETS = new Set([
  '30s',
  '60s',
  '90s',
  '120s',
  '300s',
  '600s',
  '1800s',
  '3600s',
  '3h',
  '8h',
  '24h',
  'custom',
])

const LEAGUE_SPORTS = new Set(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])
const LEAGUE_LANGUAGES = new Set(['en', 'es'])

const PREMIUM_COMMISSIONER_LEAGUE_PATCH_KEYS = new Set([
  'aiWaiverSuggestions',
  'aiTradeAnalysis',
  'aiLineupHelp',
  'aiDraftRecs',
  'aiRecaps',
  'leagueAiCommissionerAlerts',
  'aiModeration',
  'aiPowerRankings',
])

const PREMIUM_COMMISSIONER_DRAFT_SETTINGS_KEYS = new Set([
  'aiQueueSuggestions',
  'aiBestAvailable',
  'aiRosterGuidance',
  'aiScarcityAlerts',
  'aiDraftGrade',
  'aiSleeperAlerts',
  'aiByeAwareness',
  'aiStackSuggestions',
  'aiRiskUpsideNotes',
  'aiScope',
])

/** Keys stored on `LeagueSettings` (draft / draft-room row). */
export const LEAGUE_SETTINGS_ROW_PATCH_KEYS = new Set([
  'draftDateUtc',
  'timezone',
  'autostart',
  'slowDraftPause',
  'slowPauseFrom',
  'slowPauseUntil',
  'cpuAutoPick',
  'aiAutoPick',
  'draftType',
  'pickTimerPreset',
  'pickTimerCustomValue',
  'rounds',
  'draftOrderMethod',
  'randomizeCount',
  'draftOrderSlots',
  'draftOrderLocked',
  'keeperCount',
  'keeperRoundCost',
  'keeperSlots',
  'dynastyCarryover',
  'playerPool',
  'alphabeticalSort',
  'aiQueueSuggestions',
  'aiBestAvailable',
  'aiRosterGuidance',
  'aiScarcityAlerts',
  'aiDraftGrade',
  'aiSleeperAlerts',
  'aiByeAwareness',
  'aiStackSuggestions',
  'aiRiskUpsideNotes',
  'aiScope',
])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * `League.settings` as it is NOW. This patch writes `settings` in several separate blocks, so each
 * block must merge onto the latest stored copy: spreading the one read at the top of the request
 * silently reverted whatever an earlier block in the same save had just written.
 */
async function readCurrentLeagueSettings(leagueId: string): Promise<Record<string, unknown>> {
  const cur = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const s = cur?.settings
  return s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as Record<string, unknown>) } : {}
}

function asPlainObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function hasLeagueSettingsRowPatch(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((k) => LEAGUE_SETTINGS_ROW_PATCH_KEYS.has(k))
}

function requestedPremiumCommissionerKeys(body: Record<string, unknown>): string[] {
  return Object.keys(body).filter(
    (key) =>
      PREMIUM_COMMISSIONER_LEAGUE_PATCH_KEYS.has(key) ||
      PREMIUM_COMMISSIONER_DRAFT_SETTINGS_KEYS.has(key),
  )
}

export type LeagueSettingsPatchBody = Record<string, unknown> & { leagueId: string }

export type LeagueSettingsPatchOptions = {
  section?: string
  scoringOverrideInPlayoffs?: boolean
  /**
   * The person who actually made the change, when `userId` is the account the write is authorized
   * AS. The tournament schedules a conference league's draft as the league's commissioner (the
   * tournament owner) after checking the actor may change tournament settings; the row, the league
   * audit entry and the league event must still name whoever set the time. Authorization, the
   * entitlement check and every refusal use `userId` alone — this changes attribution only.
   */
  actingUserId?: string
  /**
   * `'tournament'`: the write IS the tournament → league draft-time sync, so the league → tournament
   * copy-back is skipped (lib/tournament/divisions/leagueDraftTimeToTournament.ts). The copy-back
   * would be a no-op anyway — both sides already hold the same time — but skipping it means the two
   * directions can never chase each other.
   */
  source?: 'tournament'
}

/**
 * Commissioner-granted playoff byes (multi-round byes, stepladders) are AF Commissioner
 * (`advanced_playoff_setup`, docs/AF_COMMISSIONER_SETTINGS_SPEC.md §1.3). Odd team counts are
 * FREE: the bracket engine pads any field to a power of two with natural byes (owner's rule,
 * Oct 15 paywall; pinned by __tests__/free-commissioner-locks.test.ts).
 *
 * Checked only when the plan CHANGES, so a league keeps a plan saved before its sub lapsed.
 */
export async function customPlayoffBracketRefusal(
  userId: string,
  body: LeagueSettingsPatchBody,
  current: { playoffTeams: number | null; byePlan: unknown },
): Promise<{ status: number; message: string } | null> {
  const merge = body.settingsMerge && typeof body.settingsMerge === 'object' && !Array.isArray(body.settingsMerge)
    ? (body.settingsMerge as Record<string, unknown>)
    : null
  if (!merge || !('playoff_bye_plan' in merge) || merge.playoff_bye_plan == null) return null
  const teams = body.playoffTeams != null ? Number(body.playoffTeams) : current.playoffTeams ?? 0
  const raw = merge.playoff_bye_plan
  const plan = Array.isArray(raw) ? raw.map((v) => Number(v)) : []
  const check = checkByePlan(teams, plan)
  if (!check.ok) return { status: 400, message: check.error }
  if (isNaturalByePlan(teams, plan)) return null
  const unchanged = Array.isArray(current.byePlan) && current.byePlan.map(Number).join() === plan.join()
  if (unchanged) return null
  const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'advanced_playoff_setup').catch(() => null)
  if (access?.allowed) return null
  return { status: 403, message: 'Custom playoff byes require AF Commissioner.' }
}

/**
 * Applies commissioner-only updates to `League`, `League.settings` JSON, and `LeagueSettings` row.
 */
export async function executeLeagueSettingsPatch(
  userId: string,
  body: LeagueSettingsPatchBody,
  patchOptions?: LeagueSettingsPatchOptions,
): Promise<Response> {
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) return jsonError('leagueId required', 400)
  /** Who the change is recorded as. Never used to authorize anything — see `actingUserId`. */
  const actorUserId = patchOptions?.actingUserId?.trim() || userId

  try {
    // A co-commissioner may only change the areas the head commissioner granted (coCommissionerScopes).
    await requireCommissionerRole(leagueId, userId, scopesForSettingsPatch(body, patchOptions?.section))
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[executeLeagueSettingsPatch]', err)
    return jsonError('Server error', 500)
  }

  if (patchOptions?.section) {
    try {
      await assertSettingsEditAllowed(leagueId, userId, patchOptions.section, {
        scoringOverrideInPlayoffs: patchOptions.scoringOverrideInPlayoffs,
      })
    } catch (e) {
      const err = e as Error & { status?: number }
      if (typeof err.status === 'number') {
        return jsonError(err.message, err.status)
      }
      throw e
    }
  }

  /*
   * 🛑 THE DECLARED SECTION IS NOT WHAT THE PATCH WRITES. The section-less door (useAutosave → this
   * function with no `section`) never ran the lifecycle gate at all, and a sectioned request can
   * name one section while carrying another's keys. So a body that writes scoring or roster columns
   * runs those sections' gates too — the scoring/roster policy in settingsLifecycleGate.ts, where a
   * mid-season change needs `confirmMidSeasonChange: true` in the body.
   */
  const confirmedMidSeason: Array<{ section: LifecycleGatedSection; decision: SettingsEditDecision }> = []
  for (const touched of lifecycleSectionsTouchedByPatch(body)) {
    if (touched === patchOptions?.section) continue
    const decision = await decideSettingsEdit(leagueId, userId, touched, body)
    if (!decision.ok) return NextResponse.json(decision.body, { status: decision.status })
    if (decision.midSeason) confirmedMidSeason.push({ section: touched, decision })
  }
  // A request flag, never a column or a settings key.
  delete (body as Record<string, unknown>)[MID_SEASON_CONFIRM_FLAG]

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { leagueSettings: true, teams: true },
  })
  if (!league) return jsonError('League not found', 404)

  // Sport, season, team count, format and dynasty are fixed once the draft has started —
  // regardless of which door (sectioned or not) the request came through.
  const structuralRefusal = await structuralPatchRefusal(leagueId, body, league)
  if (structuralRefusal) return jsonError(structuralRefusal, 409)

  // The hub's waiver options (lib/waiver-wire/hub-waiver-options.ts): the minimum bid is checked
  // against the budget this save leaves in place; the option keys are written after the columns.
  const hubWaiver = parseHubWaiverOptions(body as Record<string, unknown>, {
    budget: body.waiverBudget != null ? Number(body.waiverBudget) : league.waiverBudget,
  })
  if (!hubWaiver.ok) return jsonError(hubWaiver.error, 400)
  // Owner's decision 2026-10-25: a survivor league's priority carries survivor boosts, which a weekly
  // reset would erase, so it stays rolling (lib/waiver-wire/weekly-priority-reset.ts).
  if (hubWaiver.options.waiverOrderResetPolicy === 'weekly') {
    const refusal = weeklyResetSurvivorRefusal(hubWaiver.options, league.survivorMode === true || (await isSurvivorLeague(leagueId)))
    if (refusal) return jsonError(refusal, 400)
  }
  if (body.leagueSize != null) {
    const size = Number(body.leagueSize)
    if (!Number.isInteger(size) || size < 2 || size > 32) return jsonError('leagueSize must be 2–32', 400)
  }

  // The one shared AF Commissioner check (lib/entitlements/afCommissionerPlan.ts) — the same answer
  // GET /api/league/settings reports as `hasAfCommissionerSub`, so the page never shows a paid control
  // unlocked that this save then refuses. (It used EntitlementResolver alone, which disagreed for the
  // allowlisted AllFantasy accounts.) Still the plan alone: OR-ing the profile flag kept a lapsed
  // plan's access (livePlanFlags.ts).
  let planUser: { email: string | null; username: string | null } | null = null
  try {
    planUser = await prisma.appUser.findUnique({ where: { id: userId }, select: { email: true, username: true } })
  } catch {
    planUser = null // no allowlist match; the plan check still runs
  }
  const hasSub = await hasAfCommissionerPlan({ id: userId, email: planUser?.email ?? null, username: planUser?.username ?? null })

  const premiumCommissionerKeys = requestedPremiumCommissionerKeys(body)
  if (premiumCommissionerKeys.length > 0 && !hasSub) {
    return jsonError('AF Commissioner or AF Supreme is required for Commissioner Intelligence and League Helper settings.', 403)
  }

  // ⚠ 7- and 9-team playoff brackets are NOT a paid feature. They were refused here without
  // AF Commissioner, but the bracket engine seeds any field the same way — pad to the next power
  // of two and hand the top seeds first-round byes (canonicalNflRedraftPlayoffRuntime) — so a
  // 7-team bracket is built exactly like the free 6-team one. Running a league is free; only the
  // league-size bound below applies.

  if (body.timezone != null) {
    const tz = String(body.timezone)
    if (!isValidIanaTimeZone(tz)) return jsonError('Invalid timezone', 400)
  }

  if (body.sport != null && !LEAGUE_SPORTS.has(String(body.sport))) {
    return jsonError('Invalid sport', 400)
  }

  // NHL / MLB have no prospect pool: the Taxi squad section may keep or lower `taxiSlots`, never grow it.
  if (body.taxiSlots != null && isTaxiIncreaseRefused(String(league.sport ?? ''), Number(body.taxiSlots), Number(league.taxiSlots ?? 0))) {
    return NextResponse.json(
      { error: PROSPECT_STASH_UNAVAILABLE_MESSAGE, code: PROSPECT_STASH_UNAVAILABLE_CODE },
      { status: 400 },
    )
  }

  // "Which games count" (lib/redraft/gamesCount.ts) rides in `sportConfig`: a bad mode, a best-N other
  // than 2 or 3, or a non-all mode outside NBA/NHL/MLB is refused here — before any write below. The
  // `settingsMerge` door can replace `sportConfig` wholesale too, so it is checked the same way.
  for (const sportConfig of [body.sportConfig, (body.settingsMerge as { sportConfig?: unknown } | null | undefined)?.sportConfig]) {
    if (sportConfig === undefined) continue
    const gamesCountError = gamesCountSportConfigError(sportConfig, String(body.sport ?? league.sport ?? ''))
    if (gamesCountError) return jsonError(gamesCountError, 400)
  }
  // A valid value may still not be a permitted CHANGE: not while a season is under way, and never off
  // "All games" before the tables exist (lib/redraft/gamesCountSwitch.ts). A blob that does not mention
  // the keys keeps the stored values, so a stale blob cannot turn the rule off by omission.
  {
    const storedSportConfig = (league.settings as { sportConfig?: unknown } | null)?.sportConfig
    const merge = body.settingsMerge as { sportConfig?: unknown } | null | undefined
    if (body.sportConfig !== undefined) body.sportConfig = keepGamesCountFields(storedSportConfig, body.sportConfig)
    if (merge && typeof merge === 'object' && !Array.isArray(merge) && 'sportConfig' in merge) {
      body.settingsMerge = { ...merge, sportConfig: keepGamesCountFields(storedSportConfig, merge.sportConfig) }
    }
    const from = gamesCountSettingOf(storedSportConfig, league.sport)
    for (const sportConfig of [body.sportConfig, (body.settingsMerge as { sportConfig?: unknown } | null | undefined)?.sportConfig]) {
      if (sportConfig === undefined) continue
      const to = gamesCountSettingOf(sportConfig, String(body.sport ?? league.sport ?? ''))
      const refusal = await gamesCountChangeRefusal({ leagueId, from, to })
      if (refusal) return NextResponse.json({ error: refusal.message, code: refusal.code }, { status: refusal.status })
    }
  }

  if (body.season != null) {
    const y = Number(body.season)
    if (!Number.isFinite(y) || y < 2000 || y > 2100) return jsonError('Invalid season year', 400)
  }

  if (body.language != null && !LEAGUE_LANGUAGES.has(String(body.language))) {
    return jsonError('Invalid language', 400)
  }

  if (body.draftType != null && !DRAFT_TYPES.has(String(body.draftType))) {
    return jsonError('Invalid draftType', 400)
  }

  if (body.draftOrderMethod != null && !ORDER_METHODS.has(String(body.draftOrderMethod))) {
    return jsonError('Invalid draftOrderMethod', 400)
  }

  const nextDraftType = body.draftType != null ? String(body.draftType) : league.leagueSettings?.draftType
  const nextOrderMethod =
    body.draftOrderMethod != null
      ? String(body.draftOrderMethod)
      : league.leagueSettings?.draftOrderMethod
  if (nextDraftType === 'auction' && nextOrderMethod === 'reverse_max_pf') {
    return jsonError('Reverse Max PF is unavailable for auction drafts', 400)
  }

  if (body.playerPool != null && !PLAYER_POOLS.has(String(body.playerPool))) {
    return jsonError('Invalid playerPool', 400)
  }

  if (body.aiScope != null && !AI_SCOPES.has(String(body.aiScope))) {
    return jsonError('Invalid aiScope', 400)
  }

  if (body.rounds != null) {
    const r = Number(body.rounds)
    if (!Number.isFinite(r) || r < 1 || r > 50) return jsonError('rounds must be 1–50', 400)
    const roundsError = await validateDraftRoundsFitRoster(leagueId, r)
    if (roundsError) return jsonError(roundsError, 400)
  }

  const preset = body.pickTimerPreset != null ? String(body.pickTimerPreset) : undefined
  if (preset != null && !TIMER_PRESETS.has(preset)) {
    return jsonError('Invalid pickTimerPreset', 400)
  }
  if (preset === 'custom' && body.pickTimerCustomValue != null) {
    const sec = Number(body.pickTimerCustomValue)
    if (!Number.isFinite(sec) || sec < 10 || sec > 604800) {
      return jsonError('pickTimerCustomValue must be 10–604800 seconds', 400)
    }
  }

  if (body.randomizeCount != null) {
    const c = Number(body.randomizeCount)
    if (!Number.isFinite(c) || c < 1 || c > 50) return jsonError('randomizeCount must be 1–50', 400)
  }

  if (body.keeperCount != null) {
    const k = Number(body.keeperCount)
    if (!Number.isFinite(k) || k < 0 || k > 10) return jsonError('keeperCount must be 0–10', 400)
  }
  const keeperRefusal = await keeperRuleSettingsRefusal(userId, body, { keeperConflictRule: league.keeperConflictRule })
  if (keeperRefusal) return jsonError(keeperRefusal.message, keeperRefusal.status)

  const teamCount = body.leagueSize != null ? Number(body.leagueSize) : league.leagueSize ?? league.teams.length
  if (body.playoffTeams != null) {
    const pt = Number(body.playoffTeams)
    if (Number.isFinite(pt) && pt > Math.max(1, teamCount)) {
      return jsonError(`playoffTeams cannot exceed league size (${teamCount})`, 400)
    }
    // The bracket engine runs at most four rounds (canonicalNflRedraftPlayoffRuntime warns past 16 and
    // nothing reads the warning), and no sport's season has room for a fifth.
    if (Number.isFinite(pt) && pt > MAX_PLAYOFF_TEAMS) {
      return jsonError(`playoffTeams can be at most ${MAX_PLAYOFF_TEAMS}`, 400)
    }
  }
  const bracketRefusal = await customPlayoffBracketRefusal(userId, body, {
    playoffTeams: league.playoffTeams,
    byePlan: (league.settings as Record<string, unknown> | null)?.playoff_bye_plan,
  })
  if (bracketRefusal) return jsonError(bracketRefusal.message, bracketRefusal.status)

  /*
   * League median in the playoffs (lib/redraft/medianGame.ts) — off unless stored true. A boolean only:
   * anything else is refused rather than read as off, so a bad client cannot silently flip it.
   */
  if (body.medianGameInPlayoffs !== undefined && typeof body.medianGameInPlayoffs !== 'boolean') {
    return jsonError('medianGameInPlayoffs must be true or false', 400)
  }

  /*
   * Championship length — how many weeks the final is scored over (lib/playoff-runtime/playoffRoundWeeks.ts).
   * Stored in `settings.playoff_structure`, where creation writes the sport default (2 for MLB/NHL).
   * ⚠ REFUSED WHILE THE PLAYOFFS ARE BEING PLAYED: the scorer reads it live, so changing it mid-final
   * would move the week the title is decided on — shortening it could crown a champion on one week of
   * a two-week final that is half played. Also refused (400) when the final would end after the
   * season's last week (lib/playoff-runtime/championshipLengthFit.ts).
   */
  let championshipLengthToStore: number | null = null
  if (body.championshipLength !== undefined) {
    const n = Number(body.championshipLength)
    if (!Number.isInteger(n) || n < 1 || n > 4) return jsonError('championshipLength must be 1–4 weeks', 400)
    if (n !== (readChampionshipLength(league.settings) ?? 1)) {
      const inPlayoffs = await prisma.redraftSeason.findFirst({
        where: { leagueId, status: REDRAFT_SEASON_STATUS.PLAYOFFS },
        select: { id: true },
      })
      if (inPlayoffs) return jsonError('Championship length cannot change while the playoffs are being played.', 409)
    }
    championshipLengthToStore = n
  }

  /*
   * Lineups: daily or weekly (NBA/NHL/MLB; lib/redraft/lineupModeSwitch.ts). Checked here, before the
   * first write below, so a refused switch leaves the rest of the save unapplied too. Refused (400) for
   * any other sport, and (409) while a season is under way — a week is scored under one mode.
   */
  let lineupModeToStore: LineupMode | null = null
  if (body.lineupMode !== undefined) {
    const mode = parseLineupMode(body.lineupMode)
    if (!mode) return jsonError("lineupMode must be 'daily' or 'weekly'", 400)
    const refusal = await lineupModeSwitchRefusal(prisma, {
      leagueId,
      sport: league.sport,
      from: readLineupMode(league.settings, league.sport),
      to: mode,
    })
    if (refusal) return NextResponse.json({ error: refusal.message, code: refusal.code }, { status: refusal.status })
    lineupModeToStore = mode
  }

  /*
   * Games limits — GP caps (NBA/NHL/MLB), NHL goalie minimum, MLB innings min/max (lib/redraft/gamesLimits.ts).
   * Stored in `settings.games_limits`; null/{} turns them off. Sport-gated and range-checked (400), and
   * refused for a league that is not on daily lineups: only the per-day lineup and stat rows say which slot
   * a game was played in, so anywhere else the setting would save and silently do nothing.
   * `settingsMerge` can write the same key, so it is held to the same rule.
   */
  let gamesLimitsToStore: GamesLimits | null | undefined = undefined
  {
    const merge = body.settingsMerge as Record<string, unknown> | null | undefined
    const viaMerge = merge && typeof merge === 'object' && !Array.isArray(merge) && GAMES_LIMITS_SETTINGS_KEY in merge
    const raw = body.gamesLimits !== undefined ? body.gamesLimits : viaMerge ? merge[GAMES_LIMITS_SETTINGS_KEY] : undefined
    if (body.gamesLimits !== undefined || viaMerge) {
      const effectiveSettings = {
        ...((league.settings as Record<string, unknown> | null) ?? {}),
        ...(body.sportConfig !== undefined ? { sportConfig: body.sportConfig } : {}),
      }
      const parsed = parseGamesLimits(raw, String(league.sport ?? ''), effectiveSettings)
      if (!parsed.ok) return jsonError(parsed.error, 400)
      // Daily or weekly is decided by the lineup switch above (a sportConfig blob cannot change it).
      const modeAfter = lineupModeToStore ?? readLineupMode(league.settings, league.sport)
      if (parsed.value && modeAfter !== 'daily') {
        return jsonError('Games-played caps, goalie minimums and innings limits need daily lineups to be on for this league.', 400)
      }
      gamesLimitsToStore = parsed.value
      if (viaMerge) merge[GAMES_LIMITS_SETTINGS_KEY] = parsed.value
    }
  }
  // Games limits and a "which games count" rule other than all games are not combined yet: whether a
  // cap should count every game played or only the games that counted is undecided. Refuse the pair,
  // whichever side this request changes, before any write.
  {
    const storedSettings = (league.settings as Record<string, unknown> | null) ?? {}
    const sport = String(body.sport ?? league.sport ?? '')
    const limitsAfter =
      gamesLimitsToStore !== undefined ? gamesLimitsToStore : readGamesLimits(storedSettings, sport)
    const mergeSportConfig = (body.settingsMerge as { sportConfig?: unknown } | null | undefined)?.sportConfig
    const sportConfigAfter =
      body.sportConfig !== undefined ? body.sportConfig : mergeSportConfig !== undefined ? mergeSportConfig : storedSettings.sportConfig
    if (limitsAfter && lineupModeToStore === 'weekly') {
      return jsonError(
        'Turn off games-played caps, goalie minimums and innings limits before switching this league to weekly lineups.',
        400,
      )
    }
    if (limitsAfter && gamesCountSettingOf(sportConfigAfter, sport).mode !== 'all') {
      return jsonError(
        'Games-played caps, goalie minimums and innings limits can’t be combined with a “which games count” rule yet. Set games count to All games, or turn the limits off.',
        400,
      )
    }
  }

  /*
   * 🛑 A FINAL THAT ENDS AFTER THE SEASON'S LAST WEEK NEVER SEALS, SO THE SEASON NEVER COMPLETES
   * (lib/playoff-runtime/championshipLengthFit.ts). The team count, start week, weeks per round and
   * championship length all move the final, so a save that changes any of them is checked as one
   * bracket — the playoff fields saved in the same request are what it will be built from. Only a
   * change that moves the final later is refused. Imported leagues are checked on championship length
   * alone, as before: their stored season length is a regular-season length (leagueSeasonWeek.ts).
   */
  const fitChange: PlayoffFitChange = {}
  const changedNumber = (raw: unknown, current: number | null | undefined) =>
    raw != null && Number.isFinite(Number(raw)) && Number(raw) !== current ? Number(raw) : undefined
  if (championshipLengthToStore != null && championshipLengthToStore !== (readChampionshipLength(league.settings) ?? 1)) {
    fitChange.championshipLength = championshipLengthToStore
  }
  if (isNativePlatform(league.platform)) {
    const teams = changedNumber(body.playoffTeams, league.playoffTeams)
    const start = changedNumber(body.playoffStartWeek, league.playoffStartWeek)
    const perRound = changedNumber(body.playoffWeeksPerRound, league.playoffWeeksPerRound)
    if (teams !== undefined) fitChange.playoffTeams = teams
    if (start !== undefined) fitChange.playoffStartWeek = start
    if (perRound !== undefined) fitChange.playoffWeeksPerRound = perRound
  } else if (fitChange.championshipLength !== undefined) {
    // As before: the other playoff fields saved alongside the length describe the bracket it joins.
    if (body.playoffTeams != null) fitChange.playoffTeams = Number(body.playoffTeams)
    if (body.playoffStartWeek != null) fitChange.playoffStartWeek = Number(body.playoffStartWeek)
    if (body.playoffWeeksPerRound != null) fitChange.playoffWeeksPerRound = Number(body.playoffWeeksPerRound)
  }
  if (Object.keys(fitChange).length > 0) {
    const overflow = await playoffFitOverflow({
      league: { ...league, leagueSize: teamCount },
      change: fitChange,
    })
    if (overflow) return jsonError(playoffFitOverflowMessage(overflow), 400)
  }

  // `settingsMerge` spreads any key into `League.settings`, the chat link included, so it is checked
  // here — before the first write below — against the one rule (lib/league/leagueChatThreadLink.ts).
  const chatLinkRefusal = leagueChatThreadLinkRefusalInPatch(leagueId, body.settingsMerge)
  if (chatLinkRefusal) return jsonError(chatLinkRefusal, 400)
  // 🛑 Co-commissioner permissions have ONE writer, the head-commissioner-only co-commissioners
  // route. Through `settingsMerge` they would be classified as league setup, so a co-commissioner
  // holding only that permission could grant themselves every other one.
  if (
    body.settingsMerge && typeof body.settingsMerge === 'object' &&
    Object.prototype.hasOwnProperty.call(body.settingsMerge, CO_COMMISSIONER_SCOPES_KEY)
  ) {
    return jsonError('Co-commissioner permissions are changed in Co-commissioner settings, not here.', 400)
  }

  /*
   * The commissioner's tiebreaker order (lib/standings/tiebreakerOrder.ts) — a Commissioner-plan
   * setting with its own key. `settingsMerge` would write it around the plan check, so it is refused
   * there. Clearing it back to the default is free, so a lapsed plan is never stuck with a custom order.
   */
  const merge = body.settingsMerge
  if (merge && typeof merge === 'object' && !Array.isArray(merge) && TIEBREAKER_ORDER_KEY in merge) {
    return jsonError('Set the tiebreaker order with tiebreakerOrder, not settingsMerge.', 400)
  }
  let tiebreakerOrderToStore: { value: TiebreakerKey[] | null } | null = null
  if (body.tiebreakerOrder !== undefined) {
    const parsed = parseTiebreakerOrder(body.tiebreakerOrder)
    if (!parsed.ok) return jsonError(parsed.error, 400)
    if (parsed.value && !hasSub) return jsonError('A custom tiebreaker order is part of the AF Commissioner plan.', 403)
    tiebreakerOrderToStore = { value: parsed.value }
  }

  // The trade close time is read by every trade gate (lib/trade-deadline/tradeDeadlineTime.ts), where an
  // unreadable value would mean "no close time" — so it is refused here, and stored as one ISO instant.
  // (`merge` is the settingsMerge read for the tiebreaker check above.)
  if (merge && typeof merge === 'object' && !Array.isArray(merge) && TRADE_DEADLINE_AT_KEY in merge) {
    const parsed = parseDeadlineAtInput((merge as Record<string, unknown>)[TRADE_DEADLINE_AT_KEY])
    if (!parsed.ok) return jsonError(parsed.error, 400)
    ;(merge as Record<string, unknown>)[TRADE_DEADLINE_AT_KEY] = parsed.value
  }

  /*
   * Settings lock (lib/league/settingsLock.ts): an area the league locked for the season changes only
   * after a league vote. Checked HERE — after every validation, before the first write, and before
   * the daily-waiver block below rewrites `body` with derived keys — against the values that would
   * actually change, so re-saving a section unchanged is never refused. The lock itself is not
   * writable through `settingsMerge`: that would make it removable by the very save it guards.
   */
  if (
    body.settingsMerge && typeof body.settingsMerge === 'object' &&
    Object.prototype.hasOwnProperty.call(body.settingsMerge, SETTINGS_LOCK_KEY)
  ) {
    return jsonError('The settings lock is changed in Settings lock, not here.', 400)
  }
  const lockedNow = await lockedGroupsForPatch(leagueId, league as unknown as Record<string, unknown>, body).catch((e) => {
    console.warn('[executeLeagueSettingsPatch] settings lock check failed, allowing the save', e instanceof Error ? e.message : e)
    return []
  })
  if (lockedNow.length) return jsonError(lockedMessage(lockedNow), 423)

  /*
   * Per-day waiver schedule (lib/waivers/dailyWaiverSchedule.ts). Stored in `League.settings`, and
   * DERIVED into the columns the waiver engine already schedules from — UTC processing weekdays,
   * UTC process time, customDailyWaivers — so the cron only runs on days that process claims. Set
   * here, before `buildLeagueUpdateFromBody`, so those columns ride the normal column write and the
   * derived waiver-settings sync below.
   */
  let dailyWaiverScheduleToStore: DailyWaiverSchedule | null = null
  /** undefined = leave the stored prior schedule alone; null = clear it; object = store it. */
  let priorProcessingToStore: PriorWaiverProcessing | null | undefined = undefined
  /** Set when the schedule is being turned OFF: the processing schedule to restore. */
  let processingToRestore: PriorWaiverProcessing | null = null
  if (body.dailyWaiverSchedule !== undefined) {
    const schedule = parseDailyWaiverSchedule(body.dailyWaiverSchedule)
    if (!schedule) return jsonError('Invalid dailyWaiverSchedule', 400)
    const prevSettings = (league.settings as Record<string, unknown> | null) ?? {}
    const prevSchedule = readDailyWaiverScheduleFromSettings(prevSettings)
    const storedPrior = parsePriorWaiverProcessing(prevSettings[DAILY_WAIVER_PRIOR_PROCESSING_SETTINGS_KEY])
    const tz = typeof body.timezone === 'string' ? body.timezone : league.timezone
    body.customDailyWaivers = schedule.enabled
    if (schedule.enabled) {
      // First enable: remember the schedule the league ran on before, so turning this off restores it.
      if (!storedPrior && !prevSchedule?.enabled) {
        const row = await prisma.leagueWaiverSettings.findUnique({
          where: { leagueId },
          select: { processingDays: true, processingTimeUtc: true },
        })
        priorProcessingToStore = {
          processingDays: toDayIndexArray(row?.processingDays),
          processingTimeUtc: toHhmmOrNull(row?.processingTimeUtc),
          waiverSchedule: toDayIndexArray(league.waiverSchedule),
          waiverProcessTime: toHhmmOrNull(league.waiverProcessTime),
        }
      }
      // An all Free-agents / Locked week derives NO days, written as [] so no stale day survives.
      const derived = deriveEngineProcessingFromSchedule(schedule, tz)
      body.waiverSchedule = derived.processingDaysUtc
      body.waiverProcessTime = derived.processingTimeUtc
    } else if (prevSchedule?.enabled) {
      processingToRestore = storedPrior ?? {
        processingDays: null,
        processingTimeUtc: null,
        waiverSchedule: null,
        waiverProcessTime: null,
      }
      body.waiverSchedule = processingToRestore.waiverSchedule ?? Prisma.JsonNull
      if (processingToRestore.waiverProcessTime) body.waiverProcessTime = processingToRestore.waiverProcessTime
      priorProcessingToStore = null
    }
    dailyWaiverScheduleToStore = schedule
  }

  const updatedFieldNames: string[] = []

  const { data: leaguePatch, keys: leagueKeys } = buildLeagueUpdateFromBody(body)
  if (typeof body.leagueType === 'string' && isNativePlatform(league.platform)) {
    Object.assign(leaguePatch, nativeFormatPatch(body.leagueType, league.settings))
  }
  if (body.leagueSize != null && Number(body.leagueSize) !== league.leagueSize && isNativePlatform(league.platform)) {
    // An untouched default bracket follows the new size; a commissioner's own is kept, clamped to it
    // (lib/league-defaults/redraftPlayoffFit.ts). Playoff fields saved in the same request win.
    if (body.playoffTeams == null && body.playoffStartWeek == null) {
      const playoffColumns = resizedPlayoffColumns({
        sport: String(league.sport ?? ''),
        leagueType: league.leagueType,
        settings: league.settings,
        oldSize: league.leagueSize ?? league.teams.length,
        newSize: Number(body.leagueSize),
        playoffTeams: league.playoffTeams,
        playoffStartWeek: league.playoffStartWeek,
        weeksPerRound: league.playoffWeeksPerRound,
        championshipLength: readChampionshipLength(league.settings),
      })
      if (playoffColumns) {
        Object.assign(leaguePatch, playoffColumns)
        for (const key of Object.keys(playoffColumns)) if (!leagueKeys.includes(key)) leagueKeys.push(key)
      }
    }
    try {
      await resizeNativeLeague(leagueId, Number(body.leagueSize), leaguePatch)
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Could not change league size', 409)
    }
    updatedFieldNames.push(...leagueKeys)
  } else if (Object.keys(leaguePatch).length > 0) {
    await prisma.league.update({
      where: { id: leagueId },
      data: leaguePatch,
    })
    updatedFieldNames.push(...leagueKeys)
  }

  /*
   * 🛑 A COMMISSIONER SAVE IS THE ONLY THING THAT CAN CONFIRM A DEFAULT VALUE.
   * `League.keeperCount @default(3)` means the column cannot distinguish "the
   * commissioner chose three" from "nobody chose anything", so a save that
   * SUBMITS a keeper field is recorded as provenance even when the value is
   * unchanged. Submitting the field is the evidence — comparing values would
   * miss exactly the case this exists for.
   *
   * ⚠ WRITTEN AS A READ-MODIFY-WRITE ON `settings`, like the sportConfig,
   * devyLeagueConfig and settingsMerge blocks below — each one re-reads the
   * stored copy first, so no block reverts another's write in the same save.
   */
  const keeperProv = keeperProvenanceFromCommissionerSave({ submittedKeys: leagueKeys, body })
  if (keeperProv) {
    const prevSettings = await readCurrentLeagueSettings(leagueId)
    const prevConcept =
      prevSettings.conceptRules && typeof prevSettings.conceptRules === 'object' && !Array.isArray(prevSettings.conceptRules)
        ? (prevSettings.conceptRules as Record<string, unknown>)
        : {}
    const prevExt =
      prevConcept.extensions && typeof prevConcept.extensions === 'object' && !Array.isArray(prevConcept.extensions)
        ? (prevConcept.extensions as Record<string, unknown>)
        : {}
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prevSettings,
          conceptRules: {
            ...prevConcept,
            extensions: { ...prevExt, keeperProvenance: keeperProv },
          },
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('keeperProvenance')
  }

  if (body.sportConfig !== undefined) {
    if (body.sportConfig !== null && typeof body.sportConfig !== 'object') {
      return jsonError('sportConfig must be an object or null', 400)
    }
    const prev = await readCurrentLeagueSettings(leagueId)
    // The blob keeps the stored daily/weekly state; only `lineupMode` above may change it.
    const nextSportConfig = keepLineupModeFields(
      asPlainObject(prev.sportConfig),
      body.sportConfig as Record<string, unknown> | null,
      league.sport,
    )
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          sportConfig: nextSportConfig === null ? Prisma.JsonNull : (nextSportConfig as Prisma.InputJsonValue),
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('sportConfig')
  }

  if (lineupModeToStore != null) {
    const prev = await readCurrentLeagueSettings(leagueId)
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          sportConfig: withLineupMode(asPlainObject(prev.sportConfig), lineupModeToStore),
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('lineupMode')
  }

  if (body.devyLeagueConfig !== undefined) {
    if (body.devyLeagueConfig !== null && typeof body.devyLeagueConfig !== 'object') {
      return jsonError('devyLeagueConfig must be an object or null', 400)
    }
    const prev = await readCurrentLeagueSettings(leagueId)
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          devy_league_config:
            body.devyLeagueConfig === null ? Prisma.JsonNull : (body.devyLeagueConfig as Prisma.InputJsonValue),
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('devy_league_config')
  }

  /** Shallow merge into `League.settings` for concept / theme / media keys. */
  if (body.settingsMerge !== undefined) {
    if (body.settingsMerge === null || typeof body.settingsMerge !== 'object' || Array.isArray(body.settingsMerge)) {
      return jsonError('settingsMerge must be a plain object', 400)
    }
    const prev = await readCurrentLeagueSettings(leagueId)
    const merge = { ...(body.settingsMerge as Record<string, unknown>) }
    // A `sportConfig` merged here keeps the stored daily/weekly state too (see the sportConfig block).
    if (merge.sportConfig === null || (merge.sportConfig && typeof merge.sportConfig === 'object' && !Array.isArray(merge.sportConfig))) {
      merge.sportConfig = keepLineupModeFields(
        asPlainObject(prev.sportConfig),
        merge.sportConfig as Record<string, unknown> | null,
        league.sport,
      )
    }
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          ...merge,
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('settingsMerge')
  }

  if (body.gamesLimits !== undefined && gamesLimitsToStore !== undefined) {
    const prev = await readCurrentLeagueSettings(leagueId)
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          [GAMES_LIMITS_SETTINGS_KEY]: gamesLimitsToStore === null ? null : (gamesLimitsToStore as Prisma.InputJsonValue),
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push(GAMES_LIMITS_SETTINGS_KEY)
  }

  if (tiebreakerOrderToStore) {
    const prev = await readCurrentLeagueSettings(leagueId)
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: { ...prev, [TIEBREAKER_ORDER_KEY]: tiebreakerOrderToStore.value } as Prisma.InputJsonValue },
    })
    updatedFieldNames.push(TIEBREAKER_ORDER_KEY)
  }

  /*
   * Draft rounds are stored three times: `LeagueSettings.rounds` (the row below), the pre-draft
   * `DraftSession.rounds` (syncDraftSessionFromLeagueSettings below) and `League.settings.draft_rounds`,
   * which the draft-room config resolver reads. The draft settings PATCH writes all three; this
   * path wrote only the first two, so a rounds change saved here read back differently in the draft
   * room. Same read-modify-write as the blocks above.
   */
  if (body.rounds != null) {
    const prev = await readCurrentLeagueSettings(leagueId)
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          draft_rounds: Math.max(1, Math.min(50, Math.round(Number(body.rounds)))),
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('draft_rounds')
  }

  if (dailyWaiverScheduleToStore) {
    // Fresh read: the blocks above may already have rewritten `settings` this request.
    const prev = await readCurrentLeagueSettings(leagueId)
    if (priorProcessingToStore === null) delete prev[DAILY_WAIVER_PRIOR_PROCESSING_SETTINGS_KEY]
    else if (priorProcessingToStore) prev[DAILY_WAIVER_PRIOR_PROCESSING_SETTINGS_KEY] = priorProcessingToStore
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          [DAILY_WAIVER_SCHEDULE_SETTINGS_KEY]: dailyWaiverScheduleToStore,
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push(DAILY_WAIVER_SCHEDULE_SETTINGS_KEY)
  }

  if (typeof body.medianGameInPlayoffs === 'boolean') {
    const prev = await readCurrentLeagueSettings(leagueId)
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: { ...prev, [MEDIAN_GAME_IN_PLAYOFFS_SETTINGS_KEY]: body.medianGameInPlayoffs } as Prisma.InputJsonValue },
    })
    updatedFieldNames.push(MEDIAN_GAME_IN_PLAYOFFS_SETTINGS_KEY)
  }

  if (championshipLengthToStore != null) {
    const prev = await readCurrentLeagueSettings(leagueId)
    const prevStructure =
      prev.playoff_structure && typeof prev.playoff_structure === 'object' && !Array.isArray(prev.playoff_structure)
        ? (prev.playoff_structure as Record<string, unknown>)
        : {}
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          playoff_structure: { ...prevStructure, championship_length: championshipLengthToStore },
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('championship_length')
  }

  const derivedSyncKeys = new Set([
    'playoffStartWeek',
    'playoffTeams',
    'playoffWeeksPerRound',
    'playoffSeedingRule',
    'playoffLowerBracket',
    'waiverType',
    'waiverBudget',
    'waiverMinBid',
    'waiverClearAfterGames',
    'waiverHours',
    'customDailyWaivers',
    'waiverProcessTime',
    'waiverSchedule',
  ])
  if (leagueKeys.some((k) => derivedSyncKeys.has(k))) {
    try {
      // Only the columns this save wrote: the playoffs and waivers panels write the derived copies
      // directly, and mirroring an untouched (stale) column would revert what they saved.
      await syncCommissionerDerivedLeagueState(leagueId, leagueKeys)
      updatedFieldNames.push('derived_playoff_waiver_sync')
    } catch (e) {
      console.warn('[executeLeagueSettingsPatch] syncCommissionerDerivedLeagueState', e)
    }
  }

  if (hasHubWaiverOptions(hubWaiver.options)) {
    // After the derived sync, which rewrites waiverEngineConfig from the columns: re-read the row so
    // the $0-bid flag merges into what that sync just wrote.
    const row = await prisma.leagueWaiverSettings.findUnique({ where: { leagueId }, select: { waiverEngineConfig: true } })
    const { allowZeroFaabBid, tiebreakRule, waiverOrderResetPolicy } = hubWaiver.options
    await upsertLeagueWaiverSettings(leagueId, {
      ...(allowZeroFaabBid !== undefined
        ? { waiverEngineConfig: { ...parseWaiverEngineConfig(row?.waiverEngineConfig ?? null), allow_zero_faab_bid: allowZeroFaabBid } }
        : {}),
      ...(tiebreakRule !== undefined ? { tiebreakRule } : {}),
      ...(waiverOrderResetPolicy !== undefined ? { waiverOrderResetPolicy } : {}),
    })
    updatedFieldNames.push(...HUB_WAIVER_OPTION_KEYS.filter((k) => body[k] !== undefined))
  }

  if (dailyWaiverScheduleToStore) {
    try {
      // Turning the daily schedule off: the derived sync above keeps the old processing days when
      // the column is null, so the prior engine schedule is written back explicitly.
      if (processingToRestore) {
        await upsertLeagueWaiverSettings(leagueId, {
          processingDays: processingToRestore.processingDays ?? Prisma.JsonNull,
          processingTimeUtc: processingToRestore.processingTimeUtc ?? undefined,
        })
      }
      await refreshLeagueWaiverNextRunAt(leagueId)
      updatedFieldNames.push('waiver_next_run_at')
    } catch (e) {
      console.warn('[executeLeagueSettingsPatch] daily waiver schedule follow-up', e)
    }
  }

  const lsUpdate: Prisma.LeagueSettingsUpdateInput = { updatedBy: actorUserId }

  if (body.draftDateUtc !== undefined) {
    lsUpdate.draftDateUtc =
      body.draftDateUtc === null ? null : new Date(String(body.draftDateUtc as string))
  }
  if (body.timezone !== undefined) {
    const tz = body.timezone === null ? null : String(body.timezone)
    lsUpdate.timezone = tz
  }
  if (body.autostart !== undefined) lsUpdate.autostart = Boolean(body.autostart)
  if (body.slowDraftPause !== undefined) lsUpdate.slowDraftPause = Boolean(body.slowDraftPause)
  if (body.slowPauseFrom !== undefined) lsUpdate.slowPauseFrom = body.slowPauseFrom === null ? null : String(body.slowPauseFrom)
  if (body.slowPauseUntil !== undefined)
    lsUpdate.slowPauseUntil = body.slowPauseUntil === null ? null : String(body.slowPauseUntil)
  if (body.cpuAutoPick !== undefined) lsUpdate.cpuAutoPick = Boolean(body.cpuAutoPick)
  if (body.aiAutoPick !== undefined) lsUpdate.aiAutoPick = Boolean(body.aiAutoPick)
  if (body.draftType !== undefined) lsUpdate.draftType = String(body.draftType)
  if (body.pickTimerPreset !== undefined) lsUpdate.pickTimerPreset = String(body.pickTimerPreset)
  if (body.pickTimerCustomValue !== undefined)
    lsUpdate.pickTimerCustomValue =
      body.pickTimerCustomValue === null ? null : Number(body.pickTimerCustomValue)
  if (body.rounds !== undefined) lsUpdate.rounds = Number(body.rounds)
  if (body.draftOrderMethod !== undefined) lsUpdate.draftOrderMethod = String(body.draftOrderMethod)
  if (body.randomizeCount !== undefined)
    lsUpdate.randomizeCount = body.randomizeCount === null ? null : Number(body.randomizeCount)
  if (body.draftOrderSlots !== undefined)
    lsUpdate.draftOrderSlots =
      body.draftOrderSlots === null ? Prisma.JsonNull : (body.draftOrderSlots as Prisma.InputJsonValue)
  if (body.draftOrderLocked !== undefined) lsUpdate.draftOrderLocked = Boolean(body.draftOrderLocked)
  if (body.keeperCount !== undefined) lsUpdate.keeperCount = Number(body.keeperCount)
  if (body.keeperRoundCost !== undefined) lsUpdate.keeperRoundCost = Boolean(body.keeperRoundCost)
  if (body.keeperSlots !== undefined)
    lsUpdate.keeperSlots =
      body.keeperSlots === null ? Prisma.JsonNull : (body.keeperSlots as Prisma.InputJsonValue)
  if (body.dynastyCarryover !== undefined) lsUpdate.dynastyCarryover = Boolean(body.dynastyCarryover)
  if (body.playerPool !== undefined) lsUpdate.playerPool = String(body.playerPool)
  if (body.alphabeticalSort !== undefined) lsUpdate.alphabeticalSort = Boolean(body.alphabeticalSort)
  if (body.aiQueueSuggestions !== undefined) lsUpdate.aiQueueSuggestions = Boolean(body.aiQueueSuggestions)
  if (body.aiBestAvailable !== undefined) lsUpdate.aiBestAvailable = Boolean(body.aiBestAvailable)
  if (body.aiRosterGuidance !== undefined) lsUpdate.aiRosterGuidance = Boolean(body.aiRosterGuidance)
  if (body.aiScarcityAlerts !== undefined) lsUpdate.aiScarcityAlerts = Boolean(body.aiScarcityAlerts)
  if (body.aiDraftGrade !== undefined) lsUpdate.aiDraftGrade = Boolean(body.aiDraftGrade)
  if (body.aiSleeperAlerts !== undefined) lsUpdate.aiSleeperAlerts = Boolean(body.aiSleeperAlerts)
  if (body.aiByeAwareness !== undefined) lsUpdate.aiByeAwareness = Boolean(body.aiByeAwareness)
  if (body.aiStackSuggestions !== undefined) lsUpdate.aiStackSuggestions = Boolean(body.aiStackSuggestions)
  if (body.aiRiskUpsideNotes !== undefined) lsUpdate.aiRiskUpsideNotes = Boolean(body.aiRiskUpsideNotes)
  if (body.aiScope !== undefined) lsUpdate.aiScope = String(body.aiScope)

  const shouldPatchLs = hasLeagueSettingsRowPatch(body)
  let updated = league.leagueSettings

  if (shouldPatchLs) {
    const { updatedBy: _ignore, ...createFields } = lsUpdate
    updated = await prisma.leagueSettings.upsert({
      where: { leagueId },
      create: {
        leagueId,
        updatedBy: actorUserId,
        ...(createFields as Omit<Prisma.LeagueSettingsUncheckedCreateInput, 'leagueId' | 'updatedBy'>),
      },
      update: lsUpdate,
    })
    for (const k of LEAGUE_SETTINGS_ROW_PATCH_KEYS) {
      if (body[k] !== undefined) updatedFieldNames.push(k)
    }
  }

  if (shouldPatchLs && updated) {
    try {
      // Only the keys this request patched: a timezone or keeper-count save must not re-push
      // rounds, type and order over what the draft room set. The sync itself refuses a draft
      // that has started.
      const patchedKeys = new Set(
        [...LEAGUE_SETTINGS_ROW_PATCH_KEYS].filter((k) => body[k] !== undefined),
      )
      await syncDraftSessionFromLeagueSettings(leagueId, updated, teamCount, patchedKeys)
    } catch (e) {
      console.warn('[executeLeagueSettingsPatch] syncDraftSessionFromLeagueSettings', e)
    }
  }

  // A draft time set directly on a tournament conference league goes back onto the tournament's record
  // for that conference. Not when this patch IS the tournament → league sync (see `source`).
  if (shouldPatchLs && updated && body.draftDateUtc !== undefined && patchOptions?.source !== 'tournament') {
    try {
      await copyLeagueDraftTimeToTournament(leagueId, updated.draftDateUtc ?? null, actorUserId)
    } catch (e) {
      console.warn('[executeLeagueSettingsPatch] tournament draft time copy-back', e instanceof Error ? e.message : 'unknown error')
    }
  }

  const fresh = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { leagueSettings: true },
  })
  const lsOut = fresh?.leagueSettings

  await logAction({
    leagueId,
    userId: actorUserId,
    actionType: 'settings_patch',
    entityType: 'league',
    entityId: leagueId,
    metadata: {
      updatedFields: [...new Set(updatedFieldNames)],
      section: patchOptions?.section ?? null,
    },
  }).catch(() => {})

  for (const { section, decision } of confirmedMidSeason) {
    await recordMidSeasonSettingsChange(decision, {
      leagueId,
      userId: actorUserId,
      section,
      source: patchOptions?.section ? `settings-patch:${patchOptions.section}` : 'settings-patch',
      detail: { updatedFields: [...new Set(updatedFieldNames)].slice(0, 40) },
    })
  }

  void import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId,
        eventType: 'settings_changed',
        title: 'League settings updated',
        message: patchOptions?.section
          ? `Settings were updated (${patchOptions.section}).`
          : 'League settings were updated.',
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId,
        meta: {
          section: patchOptions?.section ?? null,
          updatedFields: [...new Set(updatedFieldNames)].slice(0, 40),
        },
      }),
    )
    .catch(() => {})

  recordProductEvent(ENGAGEMENT.COMMISSIONER_SETTINGS, {
    userId: actorUserId,
    meta: {
      leagueId,
      fieldCount: [...new Set(updatedFieldNames)].length,
      section: patchOptions?.section ?? null,
    },
  })

  return NextResponse.json({
    success: true,
    updatedFields: [...new Set(updatedFieldNames)],
    // Commissioner edits on an imported league rewrite AllFantasy's twin only. The source
    // league's real settings on ESPN/Yahoo/Sleeper are unchanged, and the response says so.
    writeAuthority: buildWriteAuthorityEnvelope('settings', league.platform),
    settings: lsOut
      ? {
          ...lsOut,
          draftDateUtc: lsOut.draftDateUtc?.toISOString() ?? null,
          updatedAt: lsOut.updatedAt.toISOString(),
        }
      : null,
  })
}
