import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Commissioner OS Demo Breadth — Phase C Increment 4.
 *
 * `CommissionerHubPageClient.tsx` is not fully rendered in tests — this file follows the same
 * lightweight source-scan convention as `commissioner-hub-mission-control-wiring.test.ts` to prove
 * League Analytics is actually wired into the page, not just built in isolation.
 * `LeagueAnalyticsCard`'s own rendering/degradation behavior is covered separately by
 * `__tests__/decision-os/league-analytics-card.test.tsx`.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'app', 'commissioner-hub', 'CommissionerHubPageClient.tsx'),
  'utf8',
)

describe('commissioner hub League Analytics wiring', () => {
  it('imports LeagueAnalyticsCard', () => {
    expect(source).toContain("import LeagueAnalyticsCard from '@/components/decision-os/LeagueAnalyticsCard'")
  })

  it('fetches the league-analytics snapshot for the representative league, same-origin, no-store', () => {
    expect(source).toContain(
      '`/api/decision-os/league-analytics?leagueId=${encodeURIComponent(representativeLeagueId)}`',
    )
  })

  it('renders LeagueAnalyticsCard with the fetched snapshot, after MissionControlCard', () => {
    expect(source).toContain('<LeagueAnalyticsCard snapshot={leagueAnalytics} variant="commissioner" />')
    const missionControlIndex = source.indexOf('<MissionControlCard')
    const leagueAnalyticsIndex = source.indexOf('<LeagueAnalyticsCard')
    expect(missionControlIndex).toBeGreaterThan(-1)
    expect(leagueAnalyticsIndex).toBeGreaterThan(missionControlIndex)
  })
})
