'use client'

/**
 * Harness only (app/e2e is 404 in production). Answers this page's one rosters request
 * (`/api/leagues/l0/trades/rosters`) from SAMPLE data, so Create a trade — both the 2-team builder and
 * the 3–4 team builder (2026-11-14) — has rosters to work with without a database. Every name and value
 * is invented. Every other request goes through untouched.
 */
const player = (id: string, name: string, position: string, value: number | null) => ({
  id,
  name,
  position,
  team: 'SMP',
  imageUrl: null,
  byeWeek: 10,
  injuryStatus: null,
  value,
})
const team = (rosterId: string, ownerName: string, players: ReturnType<typeof player>[], picks: Array<{ pickId: string; season: number; round: number; value: number }> = []) => ({
  rosterId,
  platformUserId: `u-${rosterId}`,
  players,
  picks: picks.map((p) => ({ ...p, label: `${p.season} ${p.round === 1 ? '1st' : p.round === 2 ? '2nd' : '3rd'}`, itemType: 'future_pick', proposable: false })),
  teamExternalId: rosterId,
  ownerName,
  ownerHandles: [ownerName],
  avatarUrl: null,
  wins: 5,
  losses: 4,
  ties: 0,
  faabRemaining: 100,
  canReceiveProposal: true,
})

const SAMPLE_ROSTERS = {
  viewerRosterId: 'r1',
  viewerTeamRosterId: 'r1',
  rosters: [
    team('r1', 'Sample Team One', [player('p11', 'Sample Running Back', 'RB', 5556), player('p12', 'Sample Receiver', 'WR', 3813), player('p13', 'Sample Tight End', 'TE', 2763)], [{ pickId: 'k1', season: 2027, round: 1, value: 2656 }]),
    team('r2', 'Sample Team Two', [player('p21', 'Sample Veteran TE', 'TE', 1200), player('p22', 'Sample Flex Back', 'RB', 2210)], [{ pickId: 'k2', season: 2027, round: 1, value: 2656 }]),
    team('r3', 'Sample Team Three', [player('p31', 'Sample Second Back', 'RB', 1000), player('p32', 'Sample Slot Receiver', 'WR', 1490)], [{ pickId: 'k3', season: 2028, round: 2, value: 1266 }]),
    team('r4', 'Sample Team Four', [player('p41', 'Sample Rookie WR', 'WR', 700)]),
  ],
}

if (typeof window !== 'undefined' && !(window as unknown as { __afTradesHarness?: boolean }).__afTradesHarness) {
  ;(window as unknown as { __afTradesHarness?: boolean }).__afTradesHarness = true
  const original = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('/trades/rosters')
      ? Promise.resolve(new Response(JSON.stringify(SAMPLE_ROSTERS), { headers: { 'content-type': 'application/json' } }))
      : original(input, init)) as typeof window.fetch
}

export function SampleRosters() {
  return null
}
