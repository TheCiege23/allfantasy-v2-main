import React from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import UserOsCard from '@/components/decision-os/UserOsCard'
import { formatDecisionOsUpdated } from '@/components/decision-os/DecisionOsCardPrimitives'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'

/*
 * The /core home renders UserOsCard, a client component, so its "Updated … at …" stamp is printed
 * once on the server (UTC) and again in the reader's browser during hydration. Unpinned, the two
 * disagreed for every reader outside UTC: React #425, then #422.
 *
 * 01:00Z is 9:00 PM the PREVIOUS day in Eastern, so both the day and the hour differ from UTC.
 */
const CROSSES_MIDNIGHT = '2026-09-28T01:00:00.000Z'

const SNAPSHOT: UserOsSnapshot = {
  leagueId: 'league-nfl-1',
  managerId: 'mgr-1',
  generatedAt: CROSSES_MIDNIGHT,
  available: true,
  teamHealth: {
    participationTier: 'active',
    overallEngagementScore: 55,
    retentionRisk: 'low',
    retentionRiskReasons: [],
    isInactive: false,
    daysSinceLastActivity: 3,
  },
  activitySummary: { tradeEventCount: 1, waiverEventCount: 2, lineupEventCount: 5, draftEventCount: 0 },
  leagueTrend: { available: false, reason: 'no_snapshots' },
  managerDna: null,
  recommendations: null,
}

const ORIGINAL_TZ = process.env.TZ

/** Node re-reads `TZ` when it is assigned, so this switches the zone the default formatters use. */
function inZone<T>(zone: string, run: () => T): T {
  process.env.TZ = zone
  return run()
}

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('formatDecisionOsUpdated', () => {
  it('formats the instant in US Eastern and names the zone on the time', () => {
    expect(formatDecisionOsUpdated(CROSSES_MIDNIGHT, true)).toMatch(/^Updated Sep 27 at 9:00\s?PM (EDT|GMT-4)$/)
    expect(formatDecisionOsUpdated(CROSSES_MIDNIGHT)).toBe('Updated Sep 27')
  })

  it('prints the same string whatever zone the runtime is in', () => {
    const server = inZone('UTC', () => formatDecisionOsUpdated(CROSSES_MIDNIGHT, true))
    const browser = inZone('America/Los_Angeles', () => formatDecisionOsUpdated(CROSSES_MIDNIGHT, true))
    expect(browser).toBe(server)
  })
})

describe('UserOsCard hydration', () => {
  it('renders identical markup on a UTC server and in an Eastern browser', () => {
    const server = inZone('UTC', () => renderToString(<UserOsCard snapshot={SNAPSHOT} variant="dashboard" />))
    const browser = inZone('America/New_York', () => renderToString(<UserOsCard snapshot={SNAPSHOT} variant="dashboard" />))
    expect(server).toContain('Sep 27')
    expect(browser).toBe(server)
  })
})
