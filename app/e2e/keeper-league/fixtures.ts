/**
 * Fixture data for the Keeper league harness (/e2e/keeper-league/<tab>). Browser-side fetch override only:
 * no route handler, no Prisma, no database. Shapes follow the components that read them
 * (KeeperSelectionTab, KeeperCommissionerDashboard, KeeperWarRoomPanel, KeeperModal).
 */
export const KEEPER_LEAGUE_ID = 'e2e-keeper-league'
export const KEEPER_HARNESS_TABS = ['keeper', 'war_room', 'commissioner', 'keeper_rosters'] as const
export type KeeperHarnessTab = (typeof KEEPER_HARNESS_TABS)[number]
/** open: window open, 2 of 3 picked · locked: commissioner locked it · none: no window yet */
export type KeeperHarnessState = 'open' | 'locked' | 'none'

const SEASON_NEXT = 'season-2027'
const SEASON_DONE = 'season-2026'
const DAY = 86_400_000

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const ROSTER = [
  { playerId: 'p-bijan', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' },
  { playerId: 'p-puka', playerName: 'Puka Nacua', position: 'WR', team: 'LAR' },
  { playerId: 'p-lamb', playerName: 'CeeDee Lamb', position: 'WR', team: 'DAL' },
  { playerId: 'p-kelce', playerName: 'Travis Kelce', position: 'TE', team: 'KC' },
  { playerId: 'p-daniels', playerName: 'Jayden Daniels', position: 'QB', team: 'WAS' },
  { playerId: 'p-nabers', playerName: 'Malik Nabers', position: 'WR', team: 'NYG' },
  { playerId: 'p-jacobs', playerName: 'Josh Jacobs', position: 'RB', team: 'GB' },
]

const ELIGIBILITY = [
  { playerId: 'p-bijan', isEligible: true, ineligibleReason: null, projectedCost: 'Round 2', projectedCostRound: 2, yearsKept: 1 },
  { playerId: 'p-puka', isEligible: true, ineligibleReason: null, projectedCost: 'Round 9', projectedCostRound: 9, yearsKept: 0 },
  { playerId: 'p-lamb', isEligible: false, ineligibleReason: 'Kept the maximum of 3 seasons', projectedCost: null, projectedCostRound: null, yearsKept: 3 },
  { playerId: 'p-kelce', isEligible: true, ineligibleReason: null, projectedCost: 'Round 4', projectedCostRound: 4, yearsKept: 2 },
  { playerId: 'p-daniels', isEligible: true, ineligibleReason: null, projectedCost: 'Round 11', projectedCostRound: 11, yearsKept: 0 },
  { playerId: 'p-nabers', isEligible: true, ineligibleReason: null, projectedCost: 'Round 6', projectedCostRound: 6, yearsKept: 0 },
  { playerId: 'p-jacobs', isEligible: true, ineligibleReason: null, projectedCost: 'Round 3', projectedCostRound: 3, yearsKept: 1 },
]

const VALUES = {
  'p-bijan': { marketRank: 2, pickSlot: 20, surplus: 18 },
  'p-puka': { marketRank: 9, pickSlot: 102, surplus: 93 },
  'p-kelce': { marketRank: 61, pickSlot: 44, surplus: -17 },
  'p-daniels': { marketRank: 38, pickSlot: 126, surplus: 88 },
  'p-nabers': { marketRank: 14, pickSlot: 68, surplus: 54 },
  'p-jacobs': { marketRank: 27, pickSlot: 32, surplus: 5 },
}

function session(state: KeeperHarnessState) {
  if (state === 'none') return null
  return {
    id: 'ks-1',
    seasonId: SEASON_NEXT,
    status: state === 'locked' ? 'locked' : 'open',
    deadline: new Date(Date.now() + (state === 'locked' ? -2 : 4) * DAY).toISOString(),
    openedAt: new Date(Date.now() - 3 * DAY).toISOString(),
    teamsSubmitted: state === 'locked' ? 12 : 7,
    totalTeams: 12,
    lockedAt: state === 'locked' ? new Date(Date.now() - 2 * DAY).toISOString() : null,
  }
}

function context(state: KeeperHarnessState) {
  return {
    league: {
      keeperCount: 3,
      keeperCostSystem: 'round_based',
      keeperPhaseActive: state !== 'none',
      keeperSelectionDeadline: session(state)?.deadline ?? null,
    },
    seasons: [
      { id: SEASON_NEXT, season: 2027, status: 'upcoming' },
      { id: SEASON_DONE, season: 2026, status: 'completed' },
    ],
    suggestedIncomingSeasonId: SEASON_NEXT,
    session: session(state),
    viewerRoster: { id: 'r-next-1', seasonId: SEASON_NEXT },
    sourceRoster: { id: 'r-done-1', seasonId: SEASON_DONE },
  }
}

const MY_RECORDS = [
  { id: 'kr-1', playerId: 'p-puka', playerName: 'Puka Nacua', status: 'pending', costRound: 9, costLabel: 'Round 9' },
  { id: 'kr-2', playerId: 'p-bijan', playerName: 'Bijan Robinson', status: 'confirmed', costRound: 2, costLabel: 'Round 2' },
]

const LEAGUE_RECORDS = [
  { id: 'kr-1', rosterId: 'r-next-1', teamName: 'Second Chance Saloon', ownerLabel: '@you', playerName: 'Puka Nacua', position: 'WR', status: 'pending', costRound: 9, costLabel: 'Round 9' },
  { id: 'kr-2', rosterId: 'r-next-1', teamName: 'Second Chance Saloon', ownerLabel: '@you', playerName: 'Bijan Robinson', position: 'RB', status: 'confirmed', costRound: 2, costLabel: 'Round 2' },
  { id: 'kr-3', rosterId: 'r-next-2', teamName: 'The Keeper of the Seven Keys', ownerLabel: '@morgan', playerName: "Ja'Marr Chase", position: 'WR', status: 'pending', costRound: 1, costLabel: 'Round 1' },
  { id: 'kr-4', rosterId: 'r-next-3', teamName: 'Waiver Wire Wizards', ownerLabel: '@sam', playerName: 'Brock Bowers', position: 'TE', status: 'rejected', costRound: 5, costLabel: 'Round 5' },
  { id: 'kr-5', rosterId: 'r-next-4', teamName: 'Punt Formation', ownerLabel: null, playerName: 'Lamar Jackson', position: 'QB', status: 'confirmed', costRound: 3, costLabel: 'Round 3' },
]

function fact(p: (typeof ROSTER)[number], i: number) {
  const e = ELIGIBILITY.find((x) => x.playerId === p.playerId)!
  const v = (VALUES as Record<string, { marketRank: number; pickSlot: number; surplus: number }>)[p.playerId]
  const adpRound = v ? Math.ceil(v.marketRank / 12) : null
  return {
    ...p, slotType: i < 5 ? 'starter' : 'bench', isStarterSlot: i < 5, isKept: p.playerId === 'p-bijan', injuryStatus: null,
    adp: v?.marketRank ?? null, adpRound, isEligible: e.isEligible, ineligibleReason: e.ineligibleReason, yearsKept: e.yearsKept,
    keeperCostRound: e.projectedCostRound, keeperCostAuction: null, keeperCostLabel: e.projectedCost,
    surplusRounds: adpRound != null && e.projectedCostRound != null ? e.projectedCostRound - adpRound : null, surplusAuction: null,
    weekProjection: null, seasonAvgActual: null,
  }
}

function warRoomState(state: KeeperHarnessState) {
  const avail = (k: string) => (k === 'freeAgentPool' || k === 'news' ? 'missing' : 'available')
  const keys = ['scoringRules', 'rosterRules', 'standings', 'schedule', 'rosters', 'playerValues', 'keeperRules', 'keeperCosts', 'eligibility', 'projections', 'injuries', 'news', 'freeAgentPool']
  const line = (id: string, verdict: string, reason: string) => {
    const p = ROSTER.find((r) => r.playerId === id)!
    const f = fact(p, 0)
    return { playerId: id, playerName: p.playerName, position: p.position, verdict, surplusRounds: f.surplusRounds, keeperCostLabel: f.keeperCostLabel, reason }
  }
  return {
    context: {
      leagueId: KEEPER_LEAGUE_ID, leagueType: 'keeper', sport: 'NFL', season: 2027, teamCount: 12, currentWeek: 0, totalWeeks: 17,
      seasonStatus: 'offseason', seasonActive: false,
      scoring: { sport: 'NFL', scoringPreset: 'Half PPR', pointsPerReception: 0.5, superflex: false, tePremium: false },
      roster: { totalStarterSlots: 9, benchSlots: 6, irSlots: 1, requiredByPosition: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } },
      keeper: {
        maxKeepers: 3, maxYears: 3, costSystem: 'round_based', roundPenalty: 1, auctionPctIncrease: 0, waiverAllowed: true,
        selectionDeadline: session(state)?.deadline ?? null, keeperPhaseActive: state !== 'none', draftRounds: 15,
      },
      userRosterId: 'r-next-1', isCommissioner: true,
      teams: [{ rosterId: 'r-next-1', ownerId: 'u1', ownerName: 'You', teamName: 'Second Chance Saloon', wins: 9, losses: 5, ties: 0, pointsFor: 1642.4, pointsAgainst: 1501.2, playoffSeed: 3, isEliminated: false, isUserTeam: true, players: ROSTER.map(fact) },
        { rosterId: 'r-next-2', ownerId: 'u2', ownerName: 'Sam', teamName: 'Gridiron Gang', wins: 8, losses: 6, ties: 0, pointsFor: 1588.1, pointsAgainst: 1544.9, playoffSeed: 5, isEliminated: false, isUserTeam: false,
          players: [['p-chase', "Ja'Marr Chase", 'WR'], ['p-gibbs', 'Jahmyr Gibbs', 'RB'], ['p-laporta', 'Sam LaPorta', 'TE']].map(([playerId, playerName, position]) => ({
            playerId, playerName, position, team: 'CIN', slotType: 'starter', isStarterSlot: true, isKept: false, injuryStatus: null, adp: null, adpRound: null, isEligible: true, ineligibleReason: null, yearsKept: 0,
            keeperCostRound: null, keeperCostAuction: null, keeperCostLabel: null, surplusRounds: null, surplusAuction: null, weekProjection: null, seasonAvgActual: null,
          })) }],
      freeAgents: [],
      availability: Object.fromEntries(keys.map((k) => [k, avail(k)])),
      freshness: { generatedAt: new Date().toISOString(), statsAsOf: null, projectionsAsOf: null, injuriesAsOf: null },
      missingDataFlags: ['Free-agent pool is empty until the new season starts.'],
      featureAvailability: { keeperRecommendations: true, cutList: true, rosterNeeds: true, draftPlan: true, tradeAnalyze: true, tradeFind: true, waivers: false, lineup: false },
    },
    recommendations: {
      rosterId: 'r-next-1', maxKeepers: 3,
      recommended: [line('p-puka', 'definite_keep', 'Market WR1-tier for a 9th-round price'), line('p-daniels', 'definite_keep', 'QB value far above an 11th'), line('p-nabers', 'keep', 'Worth a 2nd, costs a 6th')],
      bubble: [line('p-bijan', 'keep', 'Worth a 1st, costs a 2nd'), line('p-jacobs', 'borderline', 'About what he costs')],
      avoid: [line('p-kelce', 'let_go', 'Costs a 4th, goes in the 6th')],
      ranked: [], needsMoreData: false, missingDataFlags: [],
    },
    needs: {
      rosterId: 'r-next-1', keptByPosition: { WR: 2, QB: 1 },
      needs: [{ position: 'RB', severity: 'high' }, { position: 'TE', severity: 'medium' }],
      strengths: ['WR', 'QB'], draftTargetPositions: ['RB', 'TE'], explanationFacts: [], missingDataFlags: [],
    },
  }
}

const CUT_LIST = {
  cutList: {
    rosterId: 'r-next-1',
    cutList: [
      { playerId: 'p-lamb', playerName: 'CeeDee Lamb', position: 'WR', reason: 'Not eligible: kept the maximum 3 seasons' },
      { playerId: 'p-kelce', playerName: 'Travis Kelce', position: 'TE', reason: 'Costs a round 4 pick; market has him in round 6' },
    ],
    riskFlags: ['Kelce turns 38 before the season.'],
    missingDataFlags: [],
  },
}

const DRAFT_PLAN = {
  draftPlan: {
    rosterId: 'r-next-1', totalRounds: 15, consumedRounds: [6, 9, 11], remainingRounds: [1, 2, 3, 4, 5, 7, 8, 10, 12, 13, 14, 15],
    priorityPositions: ['RB', 'TE', 'WR'],
    roundPlan: [
      { round: 1, focus: 'RB', note: 'Your keepers cover WR and QB; the top RBs go first.' },
      { round: 2, focus: 'RB', note: 'Pair him with a second starter.' },
      { round: 3, focus: 'TE', note: 'The TE tier drops off after round 4.' },
    ],
    costSystem: 'round_based', explanationFacts: [], missingDataFlags: [],
  },
}

const TEAMS_ROSTERS: Record<string, string[]> = {
  'u-you': ['Bijan Robinson', 'Puka Nacua', 'CeeDee Lamb', 'Travis Kelce'],
  'u-morgan': ["Ja'Marr Chase", 'Saquon Barkley', 'Joe Burrow'],
  'u-sam': ['Brock Bowers', 'Kyren Williams'],
}

const TEAMS_POSITIONS: Record<string, string> = {
  'Bijan Robinson': 'RB', 'Puka Nacua': 'WR', 'CeeDee Lamb': 'WR', 'Travis Kelce': 'TE', "Ja'Marr Chase": 'WR',
  'Saquon Barkley': 'RB', 'Joe Burrow': 'QB', 'Brock Bowers': 'TE', 'Kyren Williams': 'RB',
}

export const KEEPER_SETTINGS_TEAMS = [
  { id: 't1', teamName: 'Second Chance Saloon', ownerName: 'You', claimedByUserId: 'u-you' },
  { id: 't2', teamName: 'The Keeper of the Seven Keys', ownerName: 'Morgan', claimedByUserId: 'u-morgan' },
  { id: 't3', teamName: 'Waiver Wire Wizards', ownerName: 'Sam', claimedByUserId: 'u-sam' },
  { id: 't4', teamName: 'Open team', ownerName: null, claimedByUserId: null },
]

export function installKeeperHarnessFetch(state: KeeperHarnessState) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __keeperHarnessFetch?: boolean }
  if (w.__keeperHarnessFetch) return
  w.__keeperHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const p = url.pathname
    const method = (init?.method ?? 'GET').toUpperCase()
    if (p === '/api/keeper/context' && method === 'GET') return json(context(state))
    if (p === '/api/keeper/eligibility' && method === 'GET') return json({ raw: ELIGIBILITY, valueReport: { available: true, values: VALUES } })
    if (p === '/api/redraft/roster' && method === 'GET') return json({ roster: { players: ROSTER.map((r) => ({ ...r, droppedAt: null })) } })
    if (p === '/api/keeper/selections' && method === 'GET') return json({ records: state === 'none' ? [] : state === 'locked' ? MY_RECORDS.map((r) => ({ ...r, status: 'locked' })) : MY_RECORDS })
    if (p === '/api/keeper/commissioner/records' && method === 'GET') return json({ records: url.searchParams.get('seasonId') === SEASON_NEXT && state !== 'none' ? LEAGUE_RECORDS : [] })
    if (p === `/api/leagues/${KEEPER_LEAGUE_ID}/keeper-war-room` && method === 'GET') return json(warRoomState(state))
    if (p === `/api/leagues/${KEEPER_LEAGUE_ID}/keeper-war-room/cut-list`) return json(CUT_LIST)
    if (p === `/api/leagues/${KEEPER_LEAGUE_ID}/keeper-war-room/draft-plan`) return json(DRAFT_PLAN)
    if (p === `/api/leagues/${KEEPER_LEAGUE_ID}/keeper-war-room/trade-analyze`) {
      return json({ tradeAnalysis: { explanationFacts: ['You give Josh Jacobs (RB) and get Sam LaPorta (TE).'], keeperImpact: ['LaPorta would cost a round 8 pick to keep next year.'], riskFlags: [] }, tradeGrade: null })
    }
    if (p === '/api/league/roster' && method === 'GET') {
      const names = TEAMS_ROSTERS[url.searchParams.get('userId') ?? ''] ?? []
      return json({ roster: { players: names.map((n, i) => ({ playerId: `${n}-${i}`, playerName: n, position: TEAMS_POSITIONS[n] ?? null })) } })
    }
    if (p === '/api/subscription/entitlements') return json({ hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } })
    if (p === '/api/guest-mode/status') return json({ isGuest: false })
    // Writes and AI calls are not part of a visual harness: answer "unavailable" rather than reach a route.
    return json({ error: 'Not part of this harness.' }, 404)
  }
}
