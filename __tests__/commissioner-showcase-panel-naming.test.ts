import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Fantasy OS Suite — Phase OS-B6: Demo Excellence Pass.
 *
 * `CommissionerShowcasePanel` (a separate, pre-existing widget) originally used the exact label
 * "Commissioner Command Center" — a real naming collision with the Multi-League Overview's own
 * `CommissionerCommandCenterSection`/`commissionerCommandCenter.ts` composition (a different,
 * Decision-OS-driven surface entirely). Resolved by renaming this widget's badge to "Platform
 * Readiness Snapshot" — its actual content (foundation proof, readiness percentages) matches that
 * label more accurately anyway. Source-scan convention (matching
 * `commissioner-hub-command-center-wiring.test.ts`'s own approach) since fully rendering this
 * component requires extensive `UserLeague[]`/health-snapshot fixtures unrelated to this specific
 * regression check.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'components', 'redraft', 'CommissionerShowcasePanel.tsx'),
  'utf8',
)

describe('CommissionerShowcasePanel naming collision fix (Phase OS-B6)', () => {
  it('no longer uses the exact label "Commissioner Command Center", which collides with the real Multi-League Overview', () => {
    expect(source).not.toContain('Commissioner Command Center')
  })

  it('uses the new, accurate "Platform Readiness Snapshot" badge label', () => {
    expect(source).toContain('Platform Readiness Snapshot')
  })
})
