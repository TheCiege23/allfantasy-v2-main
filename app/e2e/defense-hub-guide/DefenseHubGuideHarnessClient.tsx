'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { DefenseHubClient } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'

/**
 * Harness only (app/e2e is 404 in production). The real Defense Hub inside the real shell, with its two
 * requests (`/api/idp/players?view=defense-hub` and `view=trade-board`) answered from SAMPLE data below.
 * Every name and number is invented. Every other request goes through untouched.
 */
const POS = ['LB', 'DT', 'DB', 'LB', 'DE', 'CB', 'LB', 'DB']
const MINE = ['Sample Linebacker', 'Sample Tackle', 'Sample Safety', 'Sample Backer', 'Sample Edge', 'Sample Corner', 'Sample Rookie LB', 'Sample Nickel']
const PROJ = [13.8, 12.1, 11.5, 11.1, 9.8, 8.4, 7.2, null]

const defenders = MINE.map((name, i) => ({
  sleeperId: `d${i}`,
  name,
  team: 'SMP',
  position: POS[i],
  positionGroup: POS[i] === 'DT' || POS[i] === 'DE' ? 'DL' : POS[i] === 'CB' ? 'DB' : POS[i],
  projection: PROJ[i],
  vorp: PROJ[i] == null ? null : Number((PROJ[i]! - 9.8).toFixed(1)),
  positionRank: PROJ[i] == null ? null : 10 + i * 6,
  value: PROJ[i] == null ? null : i < 4 ? 1500 - i * 300 : 88,
  valueIsFloor: i >= 4 && PROJ[i] != null,
  reason: PROJ[i] == null ? 'no projection history yet: no scored game on file for this player' : null,
  lastWeek: PROJ[i] == null ? null : { scored: true, points: 8 + i, reason: null, lineKeys: 9 },
}))

const HUB = {
  state: 'ok',
  projectedFor: { season: 2026, week: 10 },
  coverage: { defenders: 295, projected: 291, priced: 291 },
  defenders,
  kickers: [],
  kickerValue: null,
  snaps: MINE.map((name, i) => ({
    sleeperId: `d${i}`,
    name,
    share: i === 7 ? null : [0.97, 0.67, 0.95, 0.89, 0.61, 0.86, 0.37, 0][i],
    games: i === 7 ? 0 : 30 + i,
    basis: i === 7 ? null : 'defense',
    trend: null,
    reason: i === 7 ? 'no game on file carries both def_snp and tm_def_snp for this player' : null,
  })),
  roles: MINE.map((name, i) => ({
    sleeperId: `d${i}`,
    name,
    games: i === 7 ? 0 : 30 + i,
    snaps: i === 7 ? 0 : [2486, 1730, 2382, 1787, 1059, 1899, 525, 0][i],
    sacks: [9.5, 13.5, 7, 3, 8, 0, 2.5, 0][i],
    tackles: i === 7 ? null : [295, 124, 255, 184, 80, 154, 70, 0][i],
    lines: [],
  })),
  tendencies: [],
  notes: [],
  unresolvedIds: 1,
}

const BOARD = {
  state: 'ok',
  projectedFor: { season: 2026, week: 10 },
  rows: Array.from({ length: 60 }, (_, i) => ({
    sleeperId: `b${i}`,
    name: i === 3 ? 'Sample Linebacker' : `Sample Defender ${i + 1}`,
    team: 'SMP',
    position: ['LB', 'DL', 'DB'][i % 3],
    value: i < 40 ? 5500 - i * 130 : 88,
    vorp: Number((8.4 - i * 0.2).toFixed(1)),
    projectedPoints: Number((18.2 - i * 0.15).toFixed(1)),
    positionRank: Math.floor(i / 3) + 1,
    valueIsFloor: i >= 40,
    ownedBy: i === 3 ? { teamName: 'Your Team', ownerName: 'You', isMine: true } : { teamName: `Sample Team ${(i % 13) + 1}`, ownerName: `manager${(i % 13) + 1}`, isMine: false },
  })),
  kickerValue: null,
  kickers: [],
  coverage: { defenders: 60, projected: 60, priced: 60 },
  notes: [],
}

if (typeof window !== 'undefined' && !(window as unknown as { __afDefenseHarness?: boolean }).__afDefenseHarness) {
  ;(window as unknown as { __afDefenseHarness?: boolean }).__afDefenseHarness = true
  const original = window.fetch.bind(window)
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/idp/players') && url.includes('view=defense-hub')) return json(HUB)
    if (url.includes('/api/idp/players') && url.includes('view=trade-board')) return json(BOARD)
    return original(input, init)
  }) as typeof window.fetch
}

export default function DefenseHubGuideHarnessClient() {
  return (
    <AfCoreShell
      active="defense-hub"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="defense-hub-guide-harness">
        <DefenseHubClient leagueId="sample-idp-league" embedded />
      </div>
    </AfCoreShell>
  )
}
