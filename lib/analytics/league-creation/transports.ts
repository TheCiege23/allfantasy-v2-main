import type { LeagueCreationAnalyticsTransport } from '@/lib/analytics/league-creation/types'

export const noopLeagueCreationAnalyticsTransport: LeagueCreationAnalyticsTransport = {
  send: () => {},
}

/**
 * Dev / explicit debug only — never noisy in production.
 * Set `NEXT_PUBLIC_LEAGUE_CREATION_ANALYTICS_DEBUG=1` to log in prod builds when diagnosing.
 */
export function createConsoleLeagueCreationAnalyticsTransport(): LeagueCreationAnalyticsTransport {
  return {
    send(event) {
      const debug =
        process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_LEAGUE_CREATION_ANALYTICS_DEBUG === '1'
      if (!debug) return
      // eslint-disable-next-line no-console -- intentional dev-only funnel telemetry
      console.debug('[league-creation-analytics]', event)
    },
  }
}
