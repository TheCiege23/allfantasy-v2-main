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
import { requireCommissionerRole } from '@/lib/league/permissions'
import { isValidIanaTimeZone } from '@/lib/timezone'
import { syncDraftSessionFromLeagueSettings } from '@/lib/league/league-settings-draft-sync'
import { syncCommissionerDerivedLeagueState } from '@/lib/league/commissioner-settings-derived-sync'
import { assertSettingsEditAllowed } from '@/server/services/commissionerService'
import { logAction } from '@/server/services/auditService'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'

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

/**
 * Applies commissioner-only updates to `League`, `League.settings` JSON, and `LeagueSettings` row.
 */
export async function executeLeagueSettingsPatch(
  userId: string,
  body: LeagueSettingsPatchBody,
  patchOptions?: { section?: string; scoringOverrideInPlayoffs?: boolean },
): Promise<Response> {
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) return jsonError('leagueId required', 400)

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

  const [profile, commissionerEntitlement] = await Promise.all([
    prisma.userProfile.findFirst({
      where: { userId },
      select: { afCommissionerSub: true },
    }),
    new EntitlementResolver()
      .resolveForUser(userId, 'commissioner_ai_tools')
      .catch(() => ({ hasAccess: false })),
  ])
  const hasSub = Boolean(profile?.afCommissionerSub) || Boolean(commissionerEntitlement.hasAccess)

  const premiumCommissionerKeys = requestedPremiumCommissionerKeys(body)
  if (premiumCommissionerKeys.length > 0 && !hasSub) {
    return jsonError('AF Commissioner or AF Supreme is required for Commissioner Intelligence and Decision OS settings.', 403)
  }

  if (body.playoffTeams != null) {
    const pt = Number(body.playoffTeams)
    if ((pt === 7 || pt === 9) && !hasSub) {
      return jsonError('7- and 9-team playoff brackets require an AF Commissioner subscription.', 403)
    }
  }

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

  const teamCount = league.leagueSize ?? league.teams.length
  if (body.playoffTeams != null) {
    const pt = Number(body.playoffTeams)
    if (Number.isFinite(pt) && pt > Math.max(1, teamCount)) {
      return jsonError(`playoffTeams cannot exceed league size (${teamCount})`, 400)
    }
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

  if (body.sportConfig !== undefined) {
    if (body.sportConfig !== null && typeof body.sportConfig !== 'object') {
      return jsonError('sportConfig must be an object or null', 400)
    }
    const prev = (league.settings as Record<string, unknown> | null) ?? {}
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
    const prev = (league.settings as Record<string, unknown> | null) ?? {}
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
    const prev = (league.settings as Record<string, unknown> | null) ?? {}
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
      await syncCommissionerDerivedLeagueState(leagueId)
      updatedFieldNames.push('derived_playoff_waiver_sync')
    } catch (e) {
      console.warn('[executeLeagueSettingsPatch] syncCommissionerDerivedLeagueState', e)
    }
  }

  const lsUpdate: Prisma.LeagueSettingsUpdateInput = { updatedBy: userId }

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
        updatedBy: userId,
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
      await syncDraftSessionFromLeagueSettings(leagueId, updated, teamCount)
    } catch (e) {
      console.warn('[executeLeagueSettingsPatch] syncDraftSessionFromLeagueSettings', e)
    }
  }

  const fresh = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { leagueSettings: true },
  })
  const lsOut = fresh?.leagueSettings

  await logAction({
    leagueId,
    userId,
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
        actorUserId: userId,
        meta: {
          section: patchOptions?.section ?? null,
          updatedFields: [...new Set(updatedFieldNames)].slice(0, 40),
        },
      }),
    )
    .catch(() => {})

  recordProductEvent(ENGAGEMENT.COMMISSIONER_SETTINGS, {
    userId,
    meta: {
      leagueId,
      fieldCount: [...new Set(updatedFieldNames)].length,
      section: patchOptions?.section ?? null,
    },
  })

  return NextResponse.json({
    success: true,
    updatedFields: [...new Set(updatedFieldNames)],
    settings: lsOut
      ? {
          ...lsOut,
          draftDateUtc: lsOut.draftDateUtc?.toISOString() ?? null,
          updatedAt: lsOut.updatedAt.toISOString(),
        }
      : null,
  })
}
