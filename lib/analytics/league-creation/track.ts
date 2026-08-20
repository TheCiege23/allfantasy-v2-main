import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { getEffectiveLeagueType } from '@/lib/create-league-v2/state'
import type {
  LeagueCreationAnalyticsEvent,
  LeagueCreationAnalyticsEventName,
  LeagueCreationAnalyticsTransport,
} from '@/lib/analytics/league-creation/types'
import { compactLeagueCreationAnalyticsEvent } from '@/lib/analytics/league-creation/normalize'
import {
  ensureLeagueCreationAnalyticsSession,
  getLeagueCreationAnalyticsSessionMeta,
  resetLeagueCreationAnalyticsSession,
  touchLeagueCreationAnalyticsMode,
} from '@/lib/analytics/league-creation/session'
import { createConsoleLeagueCreationAnalyticsTransport, noopLeagueCreationAnalyticsTransport } from '@/lib/analytics/league-creation/transports'

let customTransport: LeagueCreationAnalyticsTransport | null = null

/** Tests / future multi-provider wiring. */
export function setLeagueCreationAnalyticsTransport(t: LeagueCreationAnalyticsTransport | null): void {
  customTransport = t
}

export function getLeagueCreationAnalyticsTransport(): LeagueCreationAnalyticsTransport {
  if (customTransport) return customTransport
  if (typeof window === 'undefined') return noopLeagueCreationAnalyticsTransport
  return createConsoleLeagueCreationAnalyticsTransport()
}

export function buildLeagueCreationAnalyticsContext(
  state: CreateLeagueV2State,
): Pick<LeagueCreationAnalyticsEvent, 'createMode' | 'sport' | 'leagueType' | 'selectedTemplateId'> {
  return {
    createMode: state.creationMode,
    sport: state.sport,
    leagueType: getEffectiveLeagueType(state),
    selectedTemplateId: state.selectedTemplateId,
  }
}

export function trackLeagueCreationEvent(
  name: LeagueCreationAnalyticsEventName,
  partial: Omit<LeagueCreationAnalyticsEvent, 'name' | 'timestamp' | 'sessionId'> = {},
): LeagueCreationAnalyticsEvent {
  const sessionId = ensureLeagueCreationAnalyticsSession()
  const { elapsedMs } = getLeagueCreationAnalyticsSessionMeta()
  const event: LeagueCreationAnalyticsEvent = {
    name,
    timestamp: Date.now(),
    sessionId,
    elapsedMs,
    ...partial,
  }
  getLeagueCreationAnalyticsTransport().send(event)
  return event
}

export { resetLeagueCreationAnalyticsSession, touchLeagueCreationAnalyticsMode, compactLeagueCreationAnalyticsEvent }

/** Export compacted shape for tests / future beacon payloads. */
export function trackLeagueCreationEventCompacted(
  name: LeagueCreationAnalyticsEventName,
  partial: Omit<LeagueCreationAnalyticsEvent, 'name' | 'timestamp' | 'sessionId'> = {},
): Record<string, string | number | boolean | null> {
  return compactLeagueCreationAnalyticsEvent(trackLeagueCreationEvent(name, partial))
}
