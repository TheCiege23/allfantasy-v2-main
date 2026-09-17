import { prisma } from '@/lib/prisma'

const QUALITY_PREFIX = 'chimmy_quality_'

export type ChimmyQualityEventType =
  | 'memory_item_created'
  | 'memory_item_used_in_response'
  | 'memory_item_corrected'
  | 'memory_item_ignored'
  | 'recommendation_saved'
  | 'recommendation_reopened'
  | 'recommendation_acted_on'
  | 'recommendation_marked_stale'
  | 'personalization_signal_inferred'
  | 'explicit_preference_update'

export interface ChimmyQualityMetrics {
  periodDays: number
  counts: Record<ChimmyQualityEventType, number>
  rates: {
    staleRecommendationRate: number | null
    recommendationFollowThroughRate: number | null
    memoryCorrectionOrIgnoreRate: number | null
  }
  /**
   * ⚠ NOT TRACKED — ALWAYS NULL. These were read from the saved-recommendations service, a
   * Supabase-era stub with no database behind it (retired 2026-09-16), so they reported 0 — which
   * reads as "you saved none" rather than "nobody can save one". Null says what is true.
   */
  lifecycle: {
    savedRecommendationsTotal: number | null
    savedRecommendationsStale: number | null
    savedRecommendationsActedOn: number | null
  }
  principles: {
    scope: 'product_quality_user_benefit'
    invasiveTracking: false
    note: string
  }
}

function compactMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {}
  const out: Record<string, unknown> = {}
  const blocked = /(message|content|prompt|response|body|text)/i

  for (const [key, value] of Object.entries(meta)) {
    if (blocked.test(key)) continue
    if (typeof value === 'string') {
      out[key] = value.slice(0, 160)
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
      out[key] = value
      continue
    }
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 8).map((item) =>
        typeof item === 'string' ? item.slice(0, 80) : typeof item === 'number' || typeof item === 'boolean' ? item : null,
      )
      continue
    }
    if (typeof value === 'object') {
      out[key] = '[object]'
    }
  }

  return out
}

function eventActionType(eventType: ChimmyQualityEventType): string {
  return `${QUALITY_PREFIX}${eventType}`
}

function emptyCounts(): Record<ChimmyQualityEventType, number> {
  return {
    memory_item_created: 0,
    memory_item_used_in_response: 0,
    memory_item_corrected: 0,
    memory_item_ignored: 0,
    recommendation_saved: 0,
    recommendation_reopened: 0,
    recommendation_acted_on: 0,
    recommendation_marked_stale: 0,
    personalization_signal_inferred: 0,
    explicit_preference_update: 0,
  }
}

export async function recordChimmyQualityEvent(input: {
  userId: string
  leagueId?: string | null
  eventType: ChimmyQualityEventType
  meta?: Record<string, unknown>
}): Promise<void> {
  const safeMeta = compactMeta(input.meta)
  const actionType = eventActionType(input.eventType)

  try {
    await prisma.aIUserFeedback.create({
      data: {
        userId: input.userId,
        leagueId: input.leagueId ?? null,
        actionType,
        referenceType: 'chimmy_quality',
        result: {
          ...safeMeta,
          recordedAt: new Date().toISOString(),
        },
      },
    })

    await prisma.engagementEvent.create({
      data: {
        userId: input.userId,
        eventType: 'chimmy_quality_event',
        meta: {
          eventType: input.eventType,
          ...safeMeta,
        },
      },
    })
  } catch {
    // Quality analytics must never block product flows.
  }
}

export async function getChimmyQualityMetrics(input: {
  userId: string
  periodDays?: number
}): Promise<ChimmyQualityMetrics> {
  const periodDays = Math.max(1, Math.min(365, input.periodDays ?? 30))
  const start = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

  const events = await prisma.aIUserFeedback.findMany({
    where: {
      userId: input.userId,
      actionType: { startsWith: QUALITY_PREFIX },
      createdAt: { gte: start },
    },
    select: { actionType: true },
  })

  const counts = emptyCounts()
  for (const event of events) {
    const raw = event.actionType.replace(QUALITY_PREFIX, '') as ChimmyQualityEventType
    if (raw in counts) counts[raw] += 1
  }

  // Saved-recommendation lifecycle is not tracked anywhere — see the `lifecycle` type note.
  const staleRecommendationRate = null
  const recommendationFollowThroughRate = null

  const memoryCorrectionOrIgnoreRate =
    counts.memory_item_created > 0
      ? (counts.memory_item_corrected + counts.memory_item_ignored) / counts.memory_item_created
      : null

  return {
    periodDays,
    counts,
    rates: {
      staleRecommendationRate,
      recommendationFollowThroughRate,
      memoryCorrectionOrIgnoreRate,
    },
    lifecycle: {
      savedRecommendationsTotal: null,
      savedRecommendationsStale: null,
      savedRecommendationsActedOn: null,
    },
    principles: {
      scope: 'product_quality_user_benefit',
      invasiveTracking: false,
      note:
        'Only product-quality lifecycle events are tracked; no raw chat content or sensitive response text is stored in this analytics channel.',
    },
  }
}
