'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Waivers } from '@/components/core-app/screens/Waivers'
import type { WaiversData } from '@/lib/core-app/waivers'
import { availabilityUnverifiedSentence } from '@/lib/core-app/foreignIdSpaceCopy'

/**
 * Harness only (app/e2e is 404 in production). SAMPLE data throughout — players, managers and numbers
 * are invented. The two requests the pasted-Yahoo states change are answered here: the "Worth adding"
 * board (/api/idp/players?view=waiver-board) and Chimmy's recommendations (/api/ai/waivers/recommend).
 * Every other request goes through untouched.
 */
const UNVERIFIED = {
  board: {
    state: 'availability_unverified',
    season: null,
    week: null,
    currentLineupPoints: null,
    candidates: [],
    notes: [availabilityUnverifiedSentence(41)],
    unmatchedRostered: 41,
  },
  recommend: {
    ok: true,
    insufficientData: true,
    recommendations: [],
    rosterNeeds: [],
    leagueContext: { leagueId: 'Y1', waiverType: 'unknown', faabBudget: null, faabRemaining: null },
    generatedAt: '2026-11-27T12:00:00.000Z',
    meta: { dataGaps: ['availability_unverified'], mode: 'quick' },
    availability: { verified: false, unmatchedRostered: 41 },
  },
}

const VERIFIED = {
  board: {
    state: 'ok',
    season: '2026',
    week: 13,
    currentLineupPoints: 121.4,
    candidates: [
      { sleeperId: null, name: 'Sample Receiver', position: 'WR', team: 'SMA', projectedPoints: 12.4, gain: 2.1, displaces: { sleeperId: null, name: 'Sample Flex Back', projectedPoints: 10.3 }, basis: 'projection' },
      { sleeperId: null, name: 'Sample Tight End', position: 'TE', team: 'SMB', projectedPoints: 9.8, gain: 1.4, displaces: { sleeperId: null, name: 'Sample Old TE', projectedPoints: 8.4 }, basis: 'projection' },
      { sleeperId: null, name: 'Sample Runner', position: 'RB', team: 'SMC', projectedPoints: 10.9, gain: 0.6, displaces: { sleeperId: null, name: 'Sample Flex Back', projectedPoints: 10.3 }, basis: 'form', formGames: 3 },
    ],
    notes: ['173 free agents are ruled out, on injured reserve or on a bye this week and not shown.'],
    unmatchedRostered: 9,
  },
  recommend: {
    ok: true,
    insufficientData: false,
    recommendations: [
      {
        addPlayerId: 's1',
        addPlayerName: 'Sample Receiver',
        dropPlayerId: null,
        dropPlayerName: 'Sample Flex Back',
        priority: 1,
        suggestedFaabBid: null,
        confidence: 'high',
        risk: 'low',
        reasoning: 'Fills your WR2 slot this week.',
        deeperAnalysisPath: '/chimmy/chat?topic=waiver-analysis&leagueId=Y1',
        tags: ['WR', 'Must Add'],
      },
    ],
    rosterNeeds: ['WR'],
    leagueContext: { leagueId: 'Y1', sport: 'NFL', waiverType: 'rolling', faabBudget: null, faabRemaining: null },
    generatedAt: '2026-11-27T12:00:00.000Z',
    meta: { dataGaps: [], mode: 'quick' },
    availability: { verified: true, unmatchedRostered: 9 },
  },
}

function install(verified: boolean) {
  if (typeof window === 'undefined') return
  const w = window as unknown as { __afYahooPasteHarness?: boolean }
  if (w.__afYahooPasteHarness) return
  w.__afYahooPasteHarness = true
  const sample = verified ? VERIFIED : UNVERIFIED
  const original = window.fetch.bind(window)
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('view=waiver-board')
      ? json(sample.board)
      : String(input).includes('/api/ai/waivers/recommend')
        ? json(sample.recommend)
        : original(input, init)) as typeof window.fetch
}

const DATA = {
  league: { id: 'Y1', name: 'Sample Pasted Yahoo League', platform: 'yahoo', format: 'redraft', platformLeagueId: 'Y1' },
  budget: { available: false, reason: 'this league does not use FAAB bidding' },
  waiverPriority: { available: true, data: { priority: 4, leagueRosters: 10 } },
  rosterLoad: { available: true, data: { playersHeld: 15, starters: 9, bench: 6, reserve: 0 } },
  claimsQueued: { available: false, reason: 'claims you place on Yahoo are not visible to AllFantasy' },
  waiverType: { available: true, data: { kind: 'rolling', label: 'Rolling waiver priority', budget: null } },
  processTime: { available: false, reason: 'no waiver run schedule was ingested for this league' },
  tiebreak: { available: true, data: 'Waiver priority order' },
  claimLimits: { available: false, reason: 'no claim limit was published — this platform does not expose one' },
} as unknown as WaiversData

export default function YahooPasteWaiversHarnessClient({ verified = false }: { verified?: boolean }) {
  install(verified)
  return (
    <AfCoreShell
      active="waivers"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="yahoo-paste-waivers-harness">
        <Waivers data={DATA} edge={null} edgeAccess={null} />
      </div>
    </AfCoreShell>
  )
}
