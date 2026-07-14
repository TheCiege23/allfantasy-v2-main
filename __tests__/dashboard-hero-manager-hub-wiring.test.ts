import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 37 — real, fresh-audit finding: `/manager-hub` was reachable from `/league/[leagueId]`
 * (via the Phase 36 PRIMARY_NAV_ITEMS fix) but NOT from `/dashboard`, the platform's actual
 * primary landing page — `app/dashboard/layout.tsx` explicitly hides the global top header
 * (`hideHeader`) and uses its own in-shell nav instead (the DashboardHero nav-chip row).
 * Commissioner Hub already had a chip there; Manager Hub did not. Same lightweight
 * source-scan convention as league-tab-user-os-wiring.test.ts, since this component is not
 * fully rendered in tests (heavy i18n/context dependencies).
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'app', 'dashboard', 'components', 'warroom', 'DashboardHero.tsx'),
  'utf8',
)

describe('DashboardHero Manager Hub nav chip wiring (Phase 37)', () => {
  it('imports the Users icon for the new chip', () => {
    expect(source).toContain('Users')
  })

  it('renders a NavChip linking to /manager-hub, using the existing NavChip pattern', () => {
    expect(source).toContain('href="/manager-hub"')
    expect(source).toContain("t('dashboard.warroom.hero.navManagerHubTitle')")
  })

  it('places the Manager Hub chip alongside War Room and Commissioner Hub (not gated by isCommissioner)', () => {
    const warRoomIndex = source.indexOf('href="/war-room"')
    const managerHubIndex = source.indexOf('href="/manager-hub"')
    const commissionerHubIndex = source.indexOf('href="/commissioner-hub"')
    expect(warRoomIndex).toBeGreaterThan(-1)
    expect(managerHubIndex).toBeGreaterThan(warRoomIndex)
    expect(commissionerHubIndex).toBeGreaterThan(managerHubIndex)
  })
})
