'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Waivers } from '@/components/core-app/screens/Waivers'
import type { WaiversData } from '@/lib/core-app/waivers'

/**
 * Harness only (app/e2e is 404 in production). SAMPLE data throughout — players, managers and numbers
 * are invented. The "Worth adding" board reads /api/idp/players; here that one request is answered from
 * SAMPLE_BOARD below so the headline and rows can be seen without a database. Every other request goes
 * through untouched.
 */
const SAMPLE_BOARD = {
  state: 'ok',
  season: '2026',
  week: 10,
  currentLineupPoints: 133.7,
  candidates: [
    { sleeperId: null, name: 'Sample Tight End', position: 'TE', team: 'SMA', projectedPoints: 11.1, afProjectedPoints: 11.8, gain: 1.2, displaces: { sleeperId: null, name: 'Sample Flex Back', projectedPoints: 9.9, afProjectedPoints: 10.2 }, basis: 'projection' },
    { sleeperId: null, name: 'Sample Second TE', position: 'TE', team: 'SMB', projectedPoints: 11.0, afProjectedPoints: 11.6, gain: 1.1, displaces: { sleeperId: null, name: 'Sample Flex Back', projectedPoints: 9.9, afProjectedPoints: 10.2 }, basis: 'projection' },
    { sleeperId: null, name: 'Sample Runner', position: 'RB', team: 'SMC', projectedPoints: 10.6, afProjectedPoints: 9.6, gain: 0.7, displaces: { sleeperId: null, name: 'Sample Flex Back', projectedPoints: 9.9, afProjectedPoints: 10.2 }, basis: 'form', formGames: 3 },
    { sleeperId: null, name: 'Sample Kicker', position: 'K', team: 'SMA', projectedPoints: 9.6, afProjectedPoints: 9.8, gain: 0.1, displaces: { sleeperId: null, name: 'Sample Old Kicker', projectedPoints: 9.5, afProjectedPoints: 9.6 }, basis: 'projection' },
  ],
  notes: [
    'Games already kicked off are locked in: 20 free agents whose game has started are not shown.',
    '173 free agents are ruled out, on injured reserve or on a bye this week and not shown.',
    '1641 other active players were skipped because no slot in this league can hold them.',
  ],
}

if (typeof window !== 'undefined' && !(window as unknown as { __afWaiverHarness?: boolean }).__afWaiverHarness) {
  ;(window as unknown as { __afWaiverHarness?: boolean }).__afWaiverHarness = true
  const original = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('view=waiver-board')
      ? Promise.resolve(new Response(JSON.stringify(SAMPLE_BOARD), { headers: { 'content-type': 'application/json' } }))
      : original(input, init)) as typeof window.fetch
}

const DATA = {
  league: { id: 'L1', name: 'Sample Redraft League', platform: 'sleeper', format: 'redraft', platformLeagueId: 'S1' },
  budget: { available: false, reason: 'this league does not use FAAB bidding' },
  waiverPriority: { available: true, data: { priority: 11, leagueRosters: 12 } },
  rosterLoad: { available: true, data: { playersHeld: 15, starters: 9, bench: 5, reserve: 1 } },
  claimsQueued: { available: false, reason: 'claims you place on Sleeper are not visible to AllFantasy' },
  waiverType: { available: true, data: { kind: 'rolling', label: 'Rolling waiver priority', budget: null } },
  processTime: {
    available: true,
    data: {
      schedule: { dayOfWeek: 3, time: '00:10', timeZone: 'America/Los_Angeles' },
      dayLabel: 'Wednesday',
      timeLabel: '00:10 Pacific',
      observedRuns: 5,
      fromSleeperSetting: false,
    },
  },
  tiebreak: { available: true, data: 'Waiver priority order' },
  claimLimits: { available: true, data: '10 per period' },
} as unknown as WaiversData

export default function WaiversGuideHarnessClient() {
  return (
    <AfCoreShell
      active="waivers"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="waivers-guide-harness">
        <Waivers data={DATA} edge={null} edgeAccess={null} />
      </div>
    </AfCoreShell>
  )
}
