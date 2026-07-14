import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 36 — real, verified fix for the Phase 35 reachability gap: NFL/NCAAF leagues
 * (both routed through NflRedraftLeagueHomeDashboard.tsx per LeagueShell.tsx's tab map —
 * confirmed via this phase's fresh audit, NCAAF is not a fork of this component, it's the
 * same instance) previously had zero path to Manager OS, since they never use the 'league'
 * tab id that carries UserOsCard for other sports. Same lightweight source-scan convention
 * as league-tab-user-os-wiring.test.ts, since this dashboard is not fully rendered in tests.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'components', 'league-home', 'NflRedraftLeagueHomeDashboard.tsx'),
  'utf8',
)

describe('NflRedraftLeagueHomeDashboard Manager OS wiring (Phase 36)', () => {
  it('imports the UserOsCardConnected connector', () => {
    expect(source).toContain("import UserOsCardConnected from '@/components/decision-os/UserOsCardConnected'")
  })

  it('renders UserOsCardConnected with the real leagueId, unconditionally (not gated by isCommissioner)', () => {
    expect(source).toContain('<UserOsCardConnected leagueId={leagueId} variant="league" />')
    // Confirm it is NOT nested inside the `isCommissioner ? ... : ...` branch — it must appear
    // after that whole conditional closes, so both commissioners and members reach it.
    const commissionerBranchEnd = source.indexOf(') : (')
    const managerBranchEnd = source.indexOf(')}', source.indexOf('g32-manager-intelligence-section'))
    const cardIndex = source.indexOf('<UserOsCardConnected')
    expect(commissionerBranchEnd).toBeGreaterThan(-1)
    expect(managerBranchEnd).toBeGreaterThan(-1)
    expect(cardIndex).toBeGreaterThan(managerBranchEnd)
  })
})
