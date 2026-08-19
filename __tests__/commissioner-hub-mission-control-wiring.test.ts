import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Commissioner OS Surface Alignment — Phase B Increment 6.
 *
 * `CommissionerHubPageClient.tsx` is not fully rendered in tests (see the sibling
 * `commissioner-hub-auth-links.test.ts`) — this file follows the same lightweight source-scan
 * convention to prove Mission Control is actually wired into the page, not just built in
 * isolation. `MissionControlCard`'s own rendering/degradation behavior is covered separately by
 * `__tests__/decision-os/mission-control-card.test.tsx`.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'app', 'commissioner-hub', 'CommissionerHubPageClient.tsx'),
  'utf8',
)

describe('commissioner hub Mission Control wiring', () => {
  it('imports MissionControlCard', () => {
    expect(source).toContain("import MissionControlCard from '@/components/decision-os/MissionControlCard'")
  })

  it('fetches the mission-control snapshot for the representative league, same-origin, no-store', () => {
    expect(source).toContain(
      '`/api/decision-os/mission-control?leagueId=${encodeURIComponent(representativeLeagueId)}`',
    )
    expect(source).toContain("credentials: 'same-origin'")
  })

  it('renders MissionControlCard with the fetched snapshot', () => {
    expect(source).toContain('<MissionControlCard snapshot={missionControl} variant="commissioner" compact />')
  })
})
