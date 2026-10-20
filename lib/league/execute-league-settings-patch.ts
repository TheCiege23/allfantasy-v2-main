/**
 * Shared commissioner league settings PATCH logic used by:
 * - POST /api/league/settings (body.leagueId)
 * - PATCH /api/leagues/[leagueId]/settings (section + updates)
 */

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  buildLeagueUpdateFromBody,
} from '@/lib/league/commissioner-league-patch'
import { keeperProvenanceFromCommissionerSave } from '@/lib/league-contract/keeperProvenance'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { buildWriteAuthorityEnvelope } from '@/lib/league/write-authority'
import { isValidIanaTimeZone } from '@/lib/timezone'
import { syncDraftSessionFromLeagueSettings } from '@/lib/league/league-settings-draft-sync'
import { copyLeagueDraftTimeToTournament } from '@/lib/tournament/divisions/leagueDraftTimeToTournament'
import { validateDraftRoundsFitRoster } from '@/lib/live-draft-engine/RosterFitValidation'
import { syncCommissionerDerivedLeagueState } from '@/lib/league/commissioner-settings-derived-sync'
import { assertSettingsEditAllowed } from '@/server/services/commissionerService'
import { logAction } from '@/server/services/auditService'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { structuralPatchRefusal } from '@/lib/league/structuralSettingsLock'
import { leagueChatThreadLinkRefusalInPatch } from '@/lib/league/leagueChatThreadLink'
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
import { refreshLeagueWaiverNextRunAt } from '@/lib/waiver-wire/waiver-state-service'
import { readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { championshipLengthOverflow, championshipLengthOverflowMessage } from '@/lib/playoff-runtime/championshipLengthFit'
import { REDRAFT_SEASON_STATUS } from '@/lib/redraft/seasonStatus'

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
    await requireCommissionerRole(leagueId, userId)
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

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { leagueSettings: true, teams: true },
  })
  if (!league) return jsonError('League not found', 404)

  // Sport, season, team count, format and dynasty are fixed once the draft has started —
  // regardless of which door (sectioned or not) the request came through.
  const structuralRefusal = await structuralPatchRefusal(leagueId, body, league)
  if (structuralRefusal) return jsonError(structuralRefusal, 409)
  if (body.leagueSize != null) {
    const size = Number(body.leagueSize)
    if (!Number.isInteger(size) || size < 2 || size > 32) return jsonError('leagueSize must be 2–32', 400)
  }

  // The entitlement alone: OR-ing the profile flag kept a lapsed plan's access (livePlanFlags.ts).
  const commissionerEntitlement = await new EntitlementResolver()
    .resolveForUser(userId, 'commissioner_ai_tools')
    .catch(() => ({ hasAccess: false }))
  const hasSub = Boolean(commissionerEntitlement.hasAccess)

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

  const teamCount = league.leagueSize ?? league.teams.length
  if (body.playoffTeams != null) {
    const pt = Number(body.playoffTeams)
    if (Number.isFinite(pt) && pt > Math.max(1, teamCount)) {
      return jsonError(`playoffTeams cannot exceed league size (${teamCount})`, 400)
    }
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
      // A final that ends after the season's last week never seals, so the season never completes.
      // Playoff fields saved in the same request are what the bracket will be built from.
      const overflow = await championshipLengthOverflow({
        league: {
          ...league,
          playoffTeams: body.playoffTeams != null ? Number(body.playoffTeams) : league.playoffTeams,
          playoffWeeksPerRound:
            body.playoffWeeksPerRound != null ? Number(body.playoffWeeksPerRound) : league.playoffWeeksPerRound,
          playoffStartWeek: body.playoffStartWeek != null ? Number(body.playoffStartWeek) : league.playoffStartWeek,
        },
        championshipLength: n,
      })
      if (overflow) return jsonError(championshipLengthOverflowMessage(overflow), 400)
    }
    championshipLengthToStore = n
  }

  // `settingsMerge` spreads any key into `League.settings`, the chat link included, so it is checked
  // here — before the first write below — against the one rule (lib/league/leagueChatThreadLink.ts).
  const chatLinkRefusal = leagueChatThreadLinkRefusalInPatch(leagueId, body.settingsMerge)
  if (chatLinkRefusal) return jsonError(chatLinkRefusal, 400)

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
  if (Object.keys(leaguePatch).length > 0) {
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
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          sportConfig:
            body.sportConfig === null ? Prisma.JsonNull : (body.sportConfig as Prisma.InputJsonValue),
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('sportConfig')
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
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          ...(body.settingsMerge as Record<string, unknown>),
        } as Prisma.InputJsonValue,
      },
    })
    updatedFieldNames.push('settingsMerge')
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
