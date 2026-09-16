import { prisma } from '@/lib/prisma'
import { getAiMemory, upsertAiMemory } from '@/lib/ai-memory/ai-memory-store'
import { recordChimmyQualityEvent } from '@/lib/chimmy-quality/ChimmyQualityAnalytics'
import type {
  ChimmyAlertPreference,
  ChimmyLeagueStylePreference,
  ChimmyPersonalizationEventInput,
  ChimmyPersonalizationExplicitSettings,
  ChimmyPersonalizationInference,
  ChimmyPersonalizationInferenceSignals,
  ChimmyPersonalizationProfile,
  ChimmyStoryContentPreference,
} from './types'
import { CHIMMY_PERSONALIZATION_DEFAULTS } from './types'
import { shrunkRate, shrunkWeightedRate } from '@/lib/chimmy-outcomes/shrinkage'
import { tallyFollowThrough } from '@/lib/chimmy-outcomes/followThrough'
import { followThroughFor } from '@/lib/chimmy-outcomes/learningSnapshot'
// Not `adviceLearning` — that module is server-only, and client components import this one.
import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'

const PROFILE_KEY = 'chimmy_personalization_v1'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
}

function clampRate(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null
  return Math.max(0, Math.min(1, value))
}

async function getExplicitSettings(userId: string): Promise<ChimmyPersonalizationExplicitSettings> {
  const raw = await getAiMemory(userId, 'user_preferences', { key: PROFILE_KEY })
  const obj = asObject(raw)
  return {
    explanationStyle: typeof obj.explanationStyle === 'string' ? (obj.explanationStyle as any) : undefined,
    riskPreference: typeof obj.riskPreference === 'string' ? (obj.riskPreference as any) : undefined,
    leagueStylePreference: typeof obj.leagueStylePreference === 'string' ? (obj.leagueStylePreference as any) : undefined,
    actionPreference: typeof obj.actionPreference === 'string' ? (obj.actionPreference as any) : undefined,
    alertPreference: typeof obj.alertPreference === 'string' ? (obj.alertPreference as any) : undefined,
    storyContentPreferences: asStringArray(obj.storyContentPreferences) as ChimmyStoryContentPreference[],
  }
}

async function inferSignals(userId: string): Promise<ChimmyPersonalizationInferenceSignals> {
  const [events, leagues, profile, learning] = await Promise.all([
    prisma.aIUserFeedback.findMany({
      where: {
        userId,
        actionType: {
          in: [
            'chimmy_recommendation_accepted',
            'chimmy_recommendation_rejected',
            'chimmy_alert_clicked',
            'chimmy_alert_dismissed',
            'chimmy_story_opened',
            'chimmy_story_hidden',
            'chimmy_surface_opened',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 220,
      select: { actionType: true, result: true, createdAt: true },
    }),
    prisma.league.findMany({
      where: { userId },
      select: { sport: true, leagueType: true, isDynasty: true, leagueVariant: true },
      take: 120,
    }),
    prisma.aIUserProfile.findUnique({ where: { userId }, select: { riskMode: true, detailLevel: true, toneMode: true } }),
    readAdviceLearningSnapshot(),
  ])

  // Your "Did it / Not doing it" votes plus what the platform shows you did — one vote per advice.
  const follow = tallyFollowThrough(events, followThroughFor(learning, userId), new Date())

  const alertClicked = events.filter((e) => e.actionType === 'chimmy_alert_clicked').length
  const alertDismissed = events.filter((e) => e.actionType === 'chimmy_alert_dismissed').length
  const alertTotal = alertClicked + alertDismissed

  const sportCounts = new Map<string, number>()
  const leagueTypeCounts = new Map<string, number>()
  for (const l of leagues) {
    const s = String(l.sport || '').toUpperCase()
    if (s) sportCounts.set(s, (sportCounts.get(s) ?? 0) + 1)

    const variant = String(l.leagueVariant || '').toLowerCase()
    const type = l.isDynasty ? 'dynasty' : String(l.leagueType || 'redraft').toLowerCase()
    const normalized = variant.includes('devy') || variant.includes('c2c') ? 'c2c-devy' : type
    leagueTypeCounts.set(normalized, (leagueTypeCounts.get(normalized) ?? 0) + 1)
  }

  const preferredSports = [...sportCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sport]) => sport)

  const preferredLeagueTypes = [...leagueTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t)

  if (profile?.riskMode === 'aggressive') {
    preferredLeagueTypes.unshift('upside_profile')
  }

  /*
   * 🛑 ONE VOTE USED TO FLIP A USER'S ANSWER STYLE. The guard was `recTotal > 0`, so a single
   * accepted recommendation read as a 100% accept rate, crossed the 0.7 threshold below and switched
   * Chimmy to "one quick move" for every later answer. Rates now need ten real events and are
   * shrunk toward 50% (`lib/chimmy-outcomes/shrinkage.ts`): ten straight accepts read as 0.75.
   * Votes are one per piece of advice and weighted by age (`lib/chimmy-outcomes/followThrough.ts`).
   */
  const followCounts = (hits: number) => ({ hits, n: follow.total, rawN: follow.rawN })
  return {
    preferredSports,
    preferredLeagueTypes,
    recommendationAcceptRate: nullableRate(shrunkWeightedRate(followCounts(follow.accepted))),
    recommendationRejectRate: nullableRate(shrunkWeightedRate(followCounts(follow.rejected))),
    alertDismissRate: nullableRate(shrunkRate(alertDismissed, alertTotal)),
    alertClickRate: nullableRate(shrunkRate(alertClicked, alertTotal)),
  }
}

function nullableRate(value: number | null): number | null {
  return value == null ? null : clampRate(value)
}

async function inferSettings(userId: string): Promise<ChimmyPersonalizationInference> {
  const [signals, profile, memoryPrefs, recentFeedback] = await Promise.all([
    inferSignals(userId),
    prisma.aIUserProfile.findUnique({
      where: { userId },
      select: { riskMode: true, detailLevel: true, toneMode: true },
    }),
    getAiMemory(userId, 'user_preferences', { key: 'coaching_profile' }),
    prisma.aIUserFeedback.findMany({
      where: {
        userId,
        actionType: {
          in: [
            'chimmy_story_opened',
            'chimmy_story_hidden',
            'chimmy_surface_opened',
            'chimmy_recommendation_saved',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: { actionType: true, result: true },
    }),
  ])

  const evidence: string[] = []
  const memoryObj = asObject(memoryPrefs)

  const explanationStyle =
    (profile?.detailLevel === 'detailed' ? 'detailed' : profile?.detailLevel === 'concise' ? 'concise' : undefined) ??
    (typeof memoryObj.detailLevel === 'string' ? (memoryObj.detailLevel as any) : undefined)

  if (explanationStyle) evidence.push(`Detail preference inferred from profile/memory (${explanationStyle}).`)

  let riskPreference: 'floor' | 'balanced' | 'upside' | undefined
  if (profile?.riskMode === 'conservative') riskPreference = 'floor'
  else if (profile?.riskMode === 'aggressive') riskPreference = 'upside'
  else riskPreference = 'balanced'

  const leagueStylePreference: ChimmyLeagueStylePreference =
    signals.preferredLeagueTypes.some((x) => x.includes('c2c-devy'))
      ? 'c2c-devy-heavy'
      : signals.preferredLeagueTypes.some((x) => x.includes('dynasty'))
      ? 'dynasty-first'
      : signals.preferredLeagueTypes.some((x) => ['best_ball', 'guillotine', 'survivor', 'zombie'].includes(x))
      ? 'specialty-league-first'
      : 'redraft-first'

  evidence.push(`League style inferred from recent league footprint (${leagueStylePreference}).`)

  let actionPreference: 'quick-one-move' | 'top-3-options' | 'full-breakdown' = 'top-3-options'
  if ((signals.recommendationAcceptRate ?? 0) >= 0.7) actionPreference = 'quick-one-move'
  if ((signals.recommendationRejectRate ?? 0) >= 0.55) actionPreference = 'full-breakdown'
  evidence.push(`Action preference inferred from recommendation acceptance/rejection behavior (${actionPreference}).`)

  let alertPreference: ChimmyAlertPreference = 'balanced-alerts'
  if ((signals.alertDismissRate ?? 0) >= 0.65) alertPreference = 'minimal-alerts'
  else if ((signals.alertClickRate ?? 0) >= 0.65) alertPreference = 'aggressive-proactive-alerts'
  evidence.push(`Alert preference inferred from alert lifecycle behavior (${alertPreference}).`)

  const storyOpened = recentFeedback.filter((f) => f.actionType === 'chimmy_story_opened').length
  const storyHidden = recentFeedback.filter((f) => f.actionType === 'chimmy_story_hidden').length
  const storyPrefs: ChimmyStoryContentPreference[] = []
  if (storyHidden > storyOpened * 1.3) storyPrefs.push('no-story-content')
  else if (storyOpened > 0) storyPrefs.push('likes-recaps')
  if ((profile?.toneMode ?? '').toLowerCase().includes('unfiltered')) storyPrefs.push('likes-humor')
  else storyPrefs.push('likes-serious-analysis')

  const inferred = {
    explanationStyle,
    riskPreference,
    leagueStylePreference,
    actionPreference,
    alertPreference,
    storyContentPreferences: [...new Set(storyPrefs)],
    confidence: 0.62,
    evidence,
    signals,
  }

  await recordChimmyQualityEvent({
    userId,
    eventType: 'personalization_signal_inferred',
    meta: {
      explanationStyle: inferred.explanationStyle,
      riskPreference: inferred.riskPreference,
      leagueStylePreference: inferred.leagueStylePreference,
      actionPreference: inferred.actionPreference,
      alertPreference: inferred.alertPreference,
      signalPreferredSportsCount: inferred.signals.preferredSports.length,
      signalPreferredLeagueTypesCount: inferred.signals.preferredLeagueTypes.length,
      recommendationAcceptRate: inferred.signals.recommendationAcceptRate,
      recommendationRejectRate: inferred.signals.recommendationRejectRate,
    },
  })

  return inferred
}

function pickEffective<T>(
  explicit: T | undefined,
  inferred: T | undefined,
  fallback: T,
): { value: T; source: 'explicit' | 'inferred' | 'default' } {
  if (explicit !== undefined) return { value: explicit, source: 'explicit' }
  if (inferred !== undefined) return { value: inferred, source: 'inferred' }
  return { value: fallback, source: 'default' }
}

export async function resolveChimmyPersonalizationProfile(userId: string): Promise<ChimmyPersonalizationProfile> {
  const [explicit, inferred] = await Promise.all([getExplicitSettings(userId), inferSettings(userId)])

  const explanation = pickEffective(explicit.explanationStyle, inferred.explanationStyle, CHIMMY_PERSONALIZATION_DEFAULTS.explanationStyle)
  const risk = pickEffective(explicit.riskPreference, inferred.riskPreference, CHIMMY_PERSONALIZATION_DEFAULTS.riskPreference)
  const leagueStyle = pickEffective(explicit.leagueStylePreference, inferred.leagueStylePreference, CHIMMY_PERSONALIZATION_DEFAULTS.leagueStylePreference)
  const action = pickEffective(explicit.actionPreference, inferred.actionPreference, CHIMMY_PERSONALIZATION_DEFAULTS.actionPreference)
  const alert = pickEffective(explicit.alertPreference, inferred.alertPreference, CHIMMY_PERSONALIZATION_DEFAULTS.alertPreference)

  const explicitStory = explicit.storyContentPreferences && explicit.storyContentPreferences.length > 0 ? explicit.storyContentPreferences : undefined
  const inferredStory = inferred.storyContentPreferences && inferred.storyContentPreferences.length > 0 ? inferred.storyContentPreferences : undefined
  const story = pickEffective(explicitStory, inferredStory, CHIMMY_PERSONALIZATION_DEFAULTS.storyContentPreferences)

  return {
    userId,
    explicit,
    inferred,
    effective: {
      explanationStyle: explanation.value,
      riskPreference: risk.value,
      leagueStylePreference: leagueStyle.value,
      actionPreference: action.value,
      alertPreference: alert.value,
      storyContentPreferences: story.value,
    },
    sources: {
      explanationStyle: explanation.source,
      riskPreference: risk.source,
      leagueStylePreference: leagueStyle.source,
      actionPreference: action.source,
      alertPreference: alert.source,
      storyContentPreferences: story.source,
    },
    transparency: {
      note: 'Personalization is suggestive and never hard-locks recommendations. You can override any setting.',
      editable: true,
      generatedAt: new Date().toISOString(),
    },
  }
}

/**
 * A settings change. `null` CLEARS a setting — the value goes back to whatever Chimmy infers, or
 * the default — which is different from `undefined`, "leave it alone".
 *
 * ⚠ BEFORE 2026-09-16 AN EXPLICIT SETTING COULD NEVER BE UNSET. The merge spread `partial` over
 * the stored object and dropped `undefined`, so once a user picked "detailed" there was no way
 * back to "let Chimmy learn". The settings screen needs that way back.
 */
export type ChimmyPersonalizationSettingsPatch = {
  [K in keyof ChimmyPersonalizationExplicitSettings]?: ChimmyPersonalizationExplicitSettings[K] | null
}

export async function updateChimmyPersonalizationSettings(
  userId: string,
  partial: ChimmyPersonalizationSettingsPatch,
): Promise<ChimmyPersonalizationExplicitSettings> {
  const current = await getExplicitSettings(userId)
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue
    if (value === null) delete next[key]
    else next[key] = key === 'storyContentPreferences' && Array.isArray(value) ? [...new Set(value)] : value
  }

  await upsertAiMemory({
    userId,
    scope: 'user_preferences',
    key: PROFILE_KEY,
    value: {
      ...next,
      updatedAt: new Date().toISOString(),
    },
  })

  await recordChimmyQualityEvent({
    userId,
    eventType: 'explicit_preference_update',
    meta: {
      updatedKeys: Object.keys(partial),
      clearedKeys: Object.keys(partial).filter((k) => partial[k as keyof ChimmyPersonalizationSettingsPatch] === null),
      storyContentPreferenceCount: Array.isArray(next.storyContentPreferences) ? next.storyContentPreferences.length : 0,
      source: 'chimmy_personalization_settings',
    },
  })

  // Every value in `next` came from `getExplicitSettings` or a schema-validated patch.
  return next as ChimmyPersonalizationExplicitSettings
}

export async function recordChimmyPersonalizationEvent(userId: string, event: ChimmyPersonalizationEventInput): Promise<void> {
  const actionType = `chimmy_${event.type}`
  await prisma.aIUserFeedback.create({
    data: {
      userId,
      actionType,
      referenceType: 'chimmy_personalization',
      result: {
        ...(event.metadata ?? {}),
        recordedAt: new Date().toISOString(),
      },
    },
  })

  await prisma.engagementEvent.create({
    data: {
      userId,
      eventType: 'chimmy_personalization_event',
      meta: {
        type: event.type,
        ...(event.metadata ?? {}),
      },
    },
  })

  const qualityMappedType =
    event.type === 'recommendation_saved'
      ? 'recommendation_saved'
      : event.type === 'recommendation_reopened'
        ? 'recommendation_reopened'
        : event.type === 'recommendation_accepted'
          ? 'recommendation_acted_on'
          : event.type === 'memory_item_corrected'
            ? 'memory_item_corrected'
            : event.type === 'memory_item_ignored'
              ? 'memory_item_ignored'
              : null

  if (qualityMappedType) {
    await recordChimmyQualityEvent({
      userId,
      eventType: qualityMappedType,
      meta: {
        source: 'chimmy_personalization_event',
        ...(event.metadata ?? {}),
      },
    })
  }
}
