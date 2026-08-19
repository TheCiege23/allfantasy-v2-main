import 'server-only'

import { prisma } from '@/lib/prisma'
import { toPrismaNullableJsonInput } from '@/lib/prisma-json'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type RecordAfLearningEventArgs = {
  eventType: string
  sport: string
  leagueId?: string | null
  userId?: string | null
  source?: string
  payload?: Record<string, unknown> | null
}

/**
 * Append-only learning event. Best-effort: never throws to callers.
 */
export async function recordAfLearningEvent(args: RecordAfLearningEventArgs): Promise<void> {
  try {
    const sport = normalizeToSupportedSport(args.sport)
    await prisma.afLearningEvent.create({
      data: {
        eventType: args.eventType.slice(0, 64),
        sport,
        leagueId: args.leagueId?.trim() || null,
        userId: args.userId?.trim() || null,
        source: (args.source ?? 'server').slice(0, 32),
        payload: toPrismaNullableJsonInput(args.payload),
      },
    })
  } catch (err) {
    console.warn('[af-learning] recordEvent failed', err)
  }
}
