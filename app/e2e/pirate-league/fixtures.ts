/**
 * DB-free fixtures for the Pirate league harness (app/e2e/pirate-league). Answers the Pirate Deck's own API
 * (`/api/leagues/<id>/pirate`, `?view=rules`) and lets everything else 404, so a page that reaches further shows its
 * real empty state rather than production data.
 */
export const PIRATE_LEAGUE_ID = 'e2e-pirate-league'
export const PIRATE_HARNESS_TABS = ['pirate', 'rules'] as const
export type PirateHarnessTab = (typeof PIRATE_HARNESS_TABS)[number]
export const PIRATE_HARNESS_STATES = ['winner', 'loser', 'quiet', 'locked'] as const
export type PirateHarnessState = (typeof PIRATE_HARNESS_STATES)[number]

const p = (rosterId: string, playerId: string, playerName: string, position: string, team: string, slotType: string) =>
  ({ id: `${rosterId}-${playerId}`, playerId, playerName, position, team, slotType })

const MINE = 'r-mine'
const RIVAL = 'r-rival'
const OTHER = 'r-other'

const ROSTERS = [
  { id: MINE, ownerId: 'u1', ownerName: 'You', teamName: 'Black Pearl Ballers', players: [
    p(MINE, 'p1', 'Josh Allen', 'QB', 'BUF', 'starter'), p(MINE, 'p2', 'Bijan Robinson', 'RB', 'ATL', 'starter'),
    p(MINE, 'p3', 'Kyren Williams', 'RB', 'LAR', 'starter'), p(MINE, 'p4', 'Puka Nacua', 'WR', 'LAR', 'starter'),
    p(MINE, 'p5', 'Garrett Wilson', 'WR', 'NYJ', 'starter'), p(MINE, 'p6', 'Sam LaPorta', 'TE', 'DET', 'starter'),
    p(MINE, 'p7', 'Jaylen Waddle', 'WR', 'MIA', 'bench'), p(MINE, 'p8', 'Rhamondre Stevenson', 'RB', 'NE', 'bench'),
    p(MINE, 'p9', 'Justin Tucker', 'K', 'BAL', 'starter'), p(MINE, 'p10', 'Christian Watson', 'WR', 'GB', 'ir'),
  ] },
  { id: RIVAL, ownerId: 'u2', ownerName: 'Morgan', teamName: 'Davy Jones Lockers', players: [
    p(RIVAL, 'q1', 'Lamar Jackson', 'QB', 'BAL', 'starter'), p(RIVAL, 'q2', 'Saquon Barkley', 'RB', 'PHI', 'starter'),
    p(RIVAL, 'q3', 'Breece Hall', 'RB', 'NYJ', 'starter'), p(RIVAL, 'q4', "Ja'Marr Chase", 'WR', 'CIN', 'starter'),
    p(RIVAL, 'q5', 'Nico Collins', 'WR', 'HOU', 'starter'), p(RIVAL, 'q6', 'Trey McBride', 'TE', 'ARI', 'starter'),
    p(RIVAL, 'q7', 'DK Metcalf', 'WR', 'PIT', 'bench'), p(RIVAL, 'q8', 'Tony Pollard', 'RB', 'TEN', 'bench'),
  ] },
  { id: OTHER, ownerId: 'u3', ownerName: 'Sam', teamName: 'Jolly Rogers', players: [
    p(OTHER, 'o1', 'Jalen Hurts', 'QB', 'PHI', 'starter'), p(OTHER, 'o2', 'Jahmyr Gibbs', 'RB', 'DET', 'starter'),
    p(OTHER, 'o3', 'CeeDee Lamb', 'WR', 'DAL', 'starter'), p(OTHER, 'o4', 'Brock Bowers', 'TE', 'LV', 'starter'),
  ] },
]

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

function claims(state: PirateHarnessState) {
  const base = { offeredPlayerId: null, counterPlayerId: null, transferredAt: null, resolutionNote: null, scoreCorrectionNeedsReversal: false, overflowGraceUntil: null }
  if (state === 'winner') {
    return [{ ...base, id: 'c1', week: 6, winnerRosterId: MINE, loserRosterId: RIVAL, playerId: null, status: 'awaiting_selection', deadlineAt: null, selectionDeadlineAt: hours(20) }]
  }
  if (state === 'loser') {
    return [
      { ...base, id: 'c1', week: 6, winnerRosterId: OTHER, loserRosterId: MINE, playerId: 'p5', status: 'pending', deadlineAt: hours(30), selectionDeadlineAt: null },
      { ...base, id: 'c0', week: 5, winnerRosterId: MINE, loserRosterId: RIVAL, playerId: 'q7', status: 'transferred', deadlineAt: null, selectionDeadlineAt: null, transferredAt: hours(-120) },
    ]
  }
  if (state === 'locked') {
    return [
      { ...base, id: 'c3', week: 5, winnerRosterId: MINE, loserRosterId: RIVAL, playerId: 'q7', status: 'transferred', deadlineAt: null, selectionDeadlineAt: null, transferredAt: hours(-30), overflowGraceUntil: hours(18), scoreCorrectionNeedsReversal: true },
      { ...base, id: 'c4', week: 4, winnerRosterId: OTHER, loserRosterId: RIVAL, playerId: 'q8', status: 'transferred', deadlineAt: null, selectionDeadlineAt: null, transferredAt: hours(-200) },
      { ...base, id: 'c5', week: 3, winnerRosterId: RIVAL, loserRosterId: OTHER, playerId: null, status: 'void', deadlineAt: null, selectionDeadlineAt: null, resolutionNote: 'Matchup was a tie after a stat correction.' },
    ]
  }
  return []
}

export function pirateState(state: PirateHarnessState) {
  const rules = { protectionLimit: 3, claimHours: 24, selectionHours: 24, overflowGraceHours: 24, playoffClaims: false }
  const rosters = state === 'locked'
    ? ROSTERS.map((r) => (r.id === MINE ? { ...r, players: [...r.players, p(MINE, 'q7', 'DK Metcalf', 'WR', 'PIT', 'bench')] } : r))
    : ROSTERS
  return {
    league: { id: PIRATE_LEAGUE_ID, name: 'Plunder Bay', sport: 'NFL', rosterLimit: 10 },
    rules,
    season: { playoffStartWeek: 15 },
    week: state === 'locked' ? 6 : 7,
    lockAt: hours(state === 'locked' ? -2 : 52),
    canEditProtections: state !== 'locked',
    myRosterId: MINE,
    rosters,
    protections: [
      { rosterId: MINE, week: state === 'locked' ? 6 : 7, playerIds: ['p1', 'p2'], status: 'active', voidReason: null },
      { rosterId: RIVAL, week: 6, playerIds: ['q1', 'q2', 'q4'], status: 'active', voidReason: null },
      { rosterId: MINE, week: 6, playerIds: ['p1', 'p2', 'p4'], status: 'active', voidReason: null },
    ],
    lineupRulings: [],
    lineupPreviews: state === 'winner' ? { c1: { issues: ['TE slot empty at lock'], reason: 'Davy Jones Lockers started no tight end; Trey McBride was on the bench.' } } : {},
    lineupEvidence: {},
    claims: claims(state),
  }
}

export function installPirateHarnessFetch(state: PirateHarnessState) {
  if (typeof window === 'undefined') return
  const w = window as Window & { __pirateHarnessFetch?: boolean }
  if (w.__pirateHarnessFetch) return
  w.__pirateHarnessFetch = true
  const real = window.fetch.bind(window)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin)
    if (url.origin !== window.location.origin || url.pathname.startsWith('/_next')) return real(input, init)
    const path = url.pathname
    if (path === `/api/leagues/${PIRATE_LEAGUE_ID}/pirate`) {
      const s = pirateState(state)
      if ((init?.method ?? 'GET') !== 'GET') return json({ message: 'Saved.', rules: s.rules })
      return json(url.searchParams.get('view') === 'rules' ? { rules: s.rules } : s)
    }
    if (path.startsWith(`/api/leagues/${PIRATE_LEAGUE_ID}/pirate/`)) return json({ message: 'Saved.' })
    return json({ error: 'Not part of this harness.' }, 404)
  }
}
