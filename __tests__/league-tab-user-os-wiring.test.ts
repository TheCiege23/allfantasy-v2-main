import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Fantasy OS Suite — Phase D Increment 5.
 *
 * `LeagueTab.tsx` is not fully rendered in tests — this follows the same lightweight source-scan
 * convention as `commissioner-hub-mission-control-wiring.test.ts` to prove User OS is actually wired
 * into the page (the exact page confirmed reachable for any league role, commissioner or plain
 * manager, including imported/Sleeper-origin leagues — see
 * docs/os/USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md), not just built in isolation.
 * `UserOsCard`'s own rendering/degradation behavior is covered separately by
 * `__tests__/decision-os/user-os-card.test.tsx`.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'app', 'league', '[leagueId]', 'tabs', 'LeagueTab.tsx'),
  'utf8',
)

describe('LeagueTab User OS wiring', () => {
  it('imports UserOsCard', () => {
    expect(source).toContain("import UserOsCard from '@/components/decision-os/UserOsCard'")
  })

  it('fetches the user-os snapshot for the current league, same-origin, no-store — unconditionally, not gated by commissioner role', () => {
    expect(source).toContain(
      '`/api/decision-os/user-os?leagueId=${encodeURIComponent(league.id)}`',
    )
    expect(source).toContain("credentials: 'same-origin'")
  })

  it('renders UserOsCard with the fetched snapshot', () => {
    expect(source).toContain('<UserOsCard snapshot={userOs} variant="league" />')
  })
})
