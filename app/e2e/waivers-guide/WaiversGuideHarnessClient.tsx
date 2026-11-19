'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Waivers } from '@/components/core-app/screens/Waivers'
import type { WaiversData } from '@/lib/core-app/waivers'
import { buildWaiverEdge } from '@/lib/competitive-edge/waiverEdge'

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

/** The FAAB mode's Waiver intelligence, answered here as well. SAMPLE players and bids. */
const SAMPLE_INTEL = {
  supported: true,
  intel: {
    budget: 1000,
    myRemaining: 449,
    history: { claims: 48, medianBid: 75, p75Bid: 156, topBid: 900, recent: [{ season: '2026', week: 9, bid: 55, playerName: 'Sample Receiver', position: 'WR' }] },
    targets: [
      {
        playerId: 'a',
        name: 'Sample Tight End',
        position: 'TE',
        team: 'SMA',
        marketValue: 310,
        fillsSlots: ['FLEX'],
        suggestedBid: 120,
        reasoning: ['market value 310 (redraft chart)', 'fills FLEX', "this league's winning bids: median $75, p75 $156 — calibrate against the room"],
      },
      {
        playerId: 'b',
        name: 'Sample Runner',
        position: 'RB',
        team: 'SMC',
        marketValue: 180,
        fillsSlots: [],
        suggestedBid: 60,
        reasoning: ['market value 180 (redraft chart)', "this league's winning bids: median $75, p75 $156 — calibrate against the room"],
      },
    ],
    formulaNotes: ['No suggestion is more than 60% of the budget.'],
    missing: [],
  },
}

if (typeof window !== 'undefined' && !(window as unknown as { __afWaiverHarness?: boolean }).__afWaiverHarness) {
  ;(window as unknown as { __afWaiverHarness?: boolean }).__afWaiverHarness = true
  const original = window.fetch.bind(window)
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('view=waiver-board')
      ? json(SAMPLE_BOARD)
      : String(input).includes('/api/league/waiver-intel')
        ? json(SAMPLE_INTEL)
        : original(input, init)) as typeof window.fetch
}

/** Other managers' winning claims, for the FAAB mode's Competitive edge. SAMPLE managers. */
const SAMPLE_EDGE = buildWaiverEdge({
  season: 2026,
  usesFaab: true,
  claims: [
    { teamExternalId: '2', position: 'RB', bid: 18, atIso: '2026-09-01T00:00:00.000Z' },
    { teamExternalId: '2', position: 'RB', bid: 4, atIso: '2026-09-02T00:00:00.000Z' },
    { teamExternalId: '2', position: 'WR', bid: 0, atIso: '2026-09-03T00:00:00.000Z' },
    { teamExternalId: '3', position: 'TE', bid: 0, atIso: '2026-09-04T00:00:00.000Z' },
    { teamExternalId: '3', position: 'QB', bid: 0, atIso: '2026-09-05T00:00:00.000Z' },
  ],
  managers: [
    { teamExternalId: '1', name: 'You', faabRemaining: 449 },
    { teamExternalId: '2', name: 'Sample Manager A', faabRemaining: 720 },
    { teamExternalId: '3', name: 'Sample Manager B', faabRemaining: 449 },
    { teamExternalId: '4', name: 'Sample Manager C', faabRemaining: 120 },
  ],
  viewerTeamExternalId: '1',
  asOf: '2026-11-14T12:00:00.000Z',
  stale: false,
} as Parameters<typeof buildWaiverEdge>[0])

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

const FAAB_DATA = {
  ...DATA,
  league: { ...DATA.league, name: 'Sample FAAB League' },
  budget: { available: true, data: { faabRemaining: 449, rankByBudget: 2, leagueRosters: 12, rostersWithBudget: 12 } },
  waiverType: { available: true, data: { kind: 'faab', label: 'FAAB bidding', budget: 1000 } },
} as unknown as WaiversData

export default function WaiversGuideHarnessClient({ faab = false }: { faab?: boolean }) {
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
        <Waivers data={faab ? FAAB_DATA : DATA} edge={faab ? { available: true, data: SAMPLE_EDGE } : null} edgeAccess={null} />
      </div>
    </AfCoreShell>
  )
}
