import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Fantasy OS Suite — Phase OS-B1: Commissioner Multi-League Command Center.
 *
 * `CommissionerHubPageClient.tsx` is not fully rendered in tests (see
 * `commissioner-hub-auth-links.test.ts`) — this file follows the same source-scan convention as
 * `commissioner-hub-mission-control-wiring.test.ts`/`commissioner-hub-league-analytics-wiring.test.ts`
 * to prove (a) the new Multi-League Overview is actually wired in as the default view, and (b) every
 * existing League Focus fetch/render string this phase touched is STILL present, byte-for-byte
 * unchanged — the explicit "no regression" requirement this phase's own instructions called for.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'app', 'commissioner-hub', 'CommissionerHubPageClient.tsx'),
  'utf8',
)

describe('commissioner hub Multi-League Overview wiring', () => {
  it('imports CommissionerCommandCenterSection', () => {
    expect(source).toContain(
      "import CommissionerCommandCenterSection from '@/components/decision-os/CommissionerCommandCenterSection'",
    )
  })

  it('renders CommissionerCommandCenterSection with the commissioner league list and a selection callback', () => {
    expect(source).toContain('<CommissionerCommandCenterSection')
    expect(source).toContain('commissionerLeagues={commissionerLeagues}')
    expect(source).toContain('onSelectLeague={setSelectedLeagueId}')
  })

  it('the Multi-League Overview renders BEFORE League Focus in source order (it is the default view)', () => {
    const overviewIndex = source.indexOf('<CommissionerCommandCenterSection')
    const missionControlIndex = source.indexOf('<MissionControlCard')
    expect(overviewIndex).toBeGreaterThan(-1)
    expect(missionControlIndex).toBeGreaterThan(-1)
    expect(overviewIndex).toBeLessThan(missionControlIndex)
  })

  it('representativeLeagueId now comes from explicit selection state, not an automatic default', () => {
    expect(source).toContain('const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null)')
    expect(source).toContain('const representativeLeagueId = selectedLeagueId')
    // The old automatic-default expression must be gone, not just superseded.
    expect(source).not.toContain('const representativeLeagueId = commissionerLeagues[0]?.id ?? null')
  })

  it('League Focus only renders when a league is actually selected, and offers a way back to the overview', () => {
    expect(source).toContain('{representativeLeagueId && (')
    expect(source).toContain('onClick={() => setSelectedLeagueId(null)}')
    expect(source).toContain('data-testid="league-focus-back-to-overview"')
  })
})

describe('commissioner hub League Focus — no regression (Phase OS-B1)', () => {
  it('still imports every existing Decision OS card unchanged', () => {
    expect(source).toContain("import MissionControlCard from '@/components/decision-os/MissionControlCard'")
    expect(source).toContain("import LeagueAnalyticsCard from '@/components/decision-os/LeagueAnalyticsCard'")
    expect(source).toContain("import LeagueContextCard from '@/components/decision-os/LeagueContextCard'")
  })

  it('still fetches manager-intelligence, mission-control, and league-analytics for representativeLeagueId, same-origin, no-store', () => {
    expect(source).toContain(
      '`/api/decision-os/manager-intelligence?leagueId=${encodeURIComponent(representativeLeagueId)}`',
    )
    expect(source).toContain(
      '`/api/decision-os/mission-control?leagueId=${encodeURIComponent(representativeLeagueId)}`',
    )
    expect(source).toContain(
      '`/api/decision-os/league-analytics?leagueId=${encodeURIComponent(representativeLeagueId)}`',
    )
    expect(source).toContain("credentials: 'same-origin'")
  })

  it('still renders every existing card with the exact same props, in the same relative order', () => {
    expect(source).toContain('<ManagerDnaCard profile={managerDna} variant="commissioner" compact />')
    expect(source).toContain('<DecisionRecommendationsCard model={recommendations} variant="commissioner" compact />')
    expect(source).toContain('<MissionControlCard snapshot={missionControl} variant="commissioner" compact />')
    expect(source).toContain('<LeagueAnalyticsCard snapshot={leagueAnalytics} variant="commissioner" />')
    expect(source).toContain('<LeagueContextCard leagueId={representativeLeagueId} canManage variant="commissioner" />')

    const missionControlIndex = source.indexOf('<MissionControlCard')
    const leagueAnalyticsIndex = source.indexOf('<LeagueAnalyticsCard')
    const leagueContextIndex = source.indexOf('<LeagueContextCard')
    expect(leagueAnalyticsIndex).toBeGreaterThan(missionControlIndex)
    expect(leagueContextIndex).toBeGreaterThan(leagueAnalyticsIndex)
  })

  it('LeagueHealthDashboard and LeaguePulseCard remain unconditional (already multi-league aggregate, untouched by this phase)', () => {
    expect(source).toContain('<LeaguePulseCard pulse={leaguePulse} variant="commissioner" />')
    expect(source).toContain('<LeagueHealthDashboard snapshots={managedHealthSnapshots} demoMode={showDemoMode} />')
  })

  it('CommissionerShowcasePanel wiring (props) is untouched — only its own internal "Platform Readiness Snapshot" badge label was renamed in Phase OS-B6 to resolve the naming collision with this page\'s Multi-League Overview', () => {
    expect(source).toContain('<CommissionerShowcasePanel')
    expect(source).toContain('leagues={leagues}')
    expect(source).toContain('healthSnapshots={managedHealthSnapshots}')
    expect(source).toContain('demoMode={showDemoMode}')
  })
})
