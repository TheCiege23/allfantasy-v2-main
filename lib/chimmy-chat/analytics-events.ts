import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const CHIMMY_AI_EVENT_NAMES = [
  'chip_click',
  'followup_click',
  'mode_change',
  'feedback_submit',
  'message_send',
  'response_rendered',
  'formatter_fallback_used',
  'contract_validation_failed',
  /**
   * The hallucination guard run in observe-only mode on a tool-loop answer (see
   * `lib/chimmy/toolLoopGuardObservation.ts`). Deliberately NOT `contract_validation_failed`: nothing
   * was replaced or annotated, and the KPI rollup counts that name as a failure the user saw.
   */
  'guard_observed',
] as const

export const CHIMMY_AI_SURFACES = [
  'dashboard',
  'league',
  'draft_room',
  'war_room',
  'waiver',
  'trade',
  'player_profile',
  'chimmy_chat',
] as const

export const CHIMMY_AI_MODES = [
  'fast_take',
  'deep_analysis',
  'commissioner_view',
  'dynasty_lens',
  'dfs_upside',
] as const

export const CHIMMY_AI_TOPICS = [
  'trade',
  'start_sit',
  'waiver',
  'draft',
  'injury',
  'general',
  'commissioner',
] as const

const MetadataSchema = z.record(z.string(), z.unknown()).optional()

export const ChimmyAIAnalyticsEventSchema = z.object({
  event_name: z.enum(CHIMMY_AI_EVENT_NAMES),
  user_id: z.string().trim().min(1).optional(),
  league_id: z.string().trim().min(1).optional().nullable(),
  surface: z.enum(CHIMMY_AI_SURFACES),
  mode: z.enum(CHIMMY_AI_MODES).optional(),
  topic: z.enum(CHIMMY_AI_TOPICS).optional().nullable(),
  action: z.string().trim().min(1).max(120),
  timestamp: z.string().datetime().optional(),
  metadata: MetadataSchema,
})

export type ChimmyAIAnalyticsIngressEvent = z.infer<typeof ChimmyAIAnalyticsEventSchema>
export type ChimmyAIAnalyticsEvent = Omit<ChimmyAIAnalyticsIngressEvent, 'user_id'> & {
  user_id: string
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'message',
  'prompt',
  'content',
  'response',
  'rawPrompt',
  'rawResponse',
  'messageText',
  'responseText',
])

function toSafeJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  try {
    const serialized = JSON.stringify(value)
    if (!serialized || serialized === 'null' || serialized === '{}') return undefined
    if (serialized.length > 8_000) {
      return {
        _truncated: true,
        _size: serialized.length,
      } as Prisma.InputJsonValue
    }
    return JSON.parse(serialized) as Prisma.InputJsonValue
  } catch {
    return undefined
  }
}

export function sanitizeChimmyAnalyticsMetadata(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {}
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) continue
    if (typeof value === 'string' && value.length > 400) {
      safe[key] = `${value.slice(0, 400)}…`
      continue
    }
    safe[key] = value
  }
  return safe
}

export async function persistChimmyAIAnalyticsEvent(event: ChimmyAIAnalyticsEvent): Promise<{ ok: boolean; error?: string }> {
  try {
    const metadata = sanitizeChimmyAnalyticsMetadata(event.metadata)
    await prisma.analyticsEvent.create({
      data: {
        event: event.event_name,
        toolKey: 'chimmy_ai_chat',
        userId: event.user_id,
        path: '/api/ai/events',
        sessionId: null,
        referrer: null,
        userAgent: null,
        meta: toSafeJsonValue({
          league_id: event.league_id ?? null,
          surface: event.surface,
          mode: event.mode ?? null,
          topic: event.topic ?? null,
          action: event.action,
          timestamp: event.timestamp ?? new Date().toISOString(),
          metadata,
        }),
      },
    })

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown analytics persistence error',
    }
  }
}
