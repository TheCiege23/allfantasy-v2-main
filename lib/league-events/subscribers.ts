/**
 * Optional extension point: register async handlers invoked after `publishLeagueFanoutEvent` persists
 * (`LeagueEvent` row, optional notifications, SSE via `leagueRealtimeStore`).
 *
 * @example
 * ```ts
 * import { registerLeagueFanoutHandler } from '@/lib/league-events/subscribers'
 * registerLeagueFanoutHandler(async ({ leagueId, eventType, meta }) => {
 *   if (eventType === 'score_finalized') { ... }
 * })
 * ```
 * Keep handlers fast; offload heavy work to workers.
 */

import type { LeagueFanoutEventType } from '@/lib/league-events/types'

type LeagueFanoutHandler = (input: {
  leagueId: string
  eventType: LeagueFanoutEventType | string
  actorUserId?: string | null
  meta?: Record<string, unknown>
}) => Promise<void>

const handlers: LeagueFanoutHandler[] = []

export function registerLeagueFanoutHandler(handler: LeagueFanoutHandler): () => void {
  handlers.push(handler)
  return () => {
    const i = handlers.indexOf(handler)
    if (i >= 0) handlers.splice(i, 1)
  }
}

export async function invokeLeagueFanoutHandlers(input: Parameters<LeagueFanoutHandler>[0]): Promise<void> {
  await Promise.allSettled(handlers.map((h) => h(input)))
}
