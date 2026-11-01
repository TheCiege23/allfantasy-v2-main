/**
 * HARNESS FIXTURES ONLY (app/e2e is 404 in production). Fictional managers and players, shaped like the
 * real route responses the native screens read, so the screens render through their own code paths with
 * no database. Nothing here is imported by product code.
 *
 * Each sport carries its own slot template, positions, cadence (weekly vs daily) and waiver type, so a
 * capture shows the sport differences the screens must handle — not seven copies of NFL.
 */
export type HarnessSport = 'NFL' | 'NBA' | 'NHL' | 'MLB' | 'NCAAF' | 'NCAAB' | 'SOCCER'
export type HarnessStage = 'season' | 'playoffs'

type SportCfg = {
  week: number
  totalWeeks: number
  playoffStart: number
  deadline: number | null
  daily: boolean
  waiverType: 'faab' | 'rolling'
  slots: string[]
  bench: string[]
  teams: string[]
  /** Points scale for one starter in one scoring period. */
  pts: number
}

export const SPORTS: Record<HarnessSport, SportCfg> = {
  NFL: { week: 9, totalWeeks: 17, playoffStart: 15, deadline: 12, daily: false, waiverType: 'faab', slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'], bench: ['RB', 'WR', 'QB', 'TE', 'WR'], teams: ['KC', 'BUF', 'PHI', 'SF', 'DET', 'MIA', 'DAL', 'CIN'], pts: 14 },
  NCAAF: { week: 6, totalWeeks: 15, playoffStart: 13, deadline: 9, daily: false, waiverType: 'faab', slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K'], bench: ['QB', 'RB', 'WR', 'WR'], teams: ['UGA', 'OSU', 'TEX', 'ORE', 'BAMA', 'MICH', 'LSU', 'PSU'], pts: 15 },
  NBA: { week: 4, totalWeeks: 21, playoffStart: 19, deadline: 16, daily: true, waiverType: 'faab', slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL'], bench: ['PG', 'C', 'SF'], teams: ['BOS', 'DEN', 'OKC', 'MIL', 'LAL', 'NYK', 'PHX', 'MIN'], pts: 34 },
  NCAAB: { week: 8, totalWeeks: 18, playoffStart: 16, deadline: 12, daily: true, waiverType: 'rolling', slots: ['G', 'G', 'F', 'F', 'C', 'UTIL'], bench: ['G', 'F', 'C'], teams: ['DUKE', 'UK', 'UNC', 'KU', 'GONZ', 'HOU', 'PUR', 'UCONN'], pts: 26 },
  NHL: { week: 5, totalWeeks: 22, playoffStart: 20, deadline: 17, daily: true, waiverType: 'faab', slots: ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'G', 'G'], bench: ['C', 'D', 'G'], teams: ['EDM', 'COL', 'TOR', 'BOS', 'NYR', 'VGK', 'FLA', 'DAL'], pts: 9 },
  MLB: { week: 7, totalWeeks: 26, playoffStart: 24, deadline: null, daily: true, waiverType: 'faab', slots: ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL', 'SP', 'SP', 'RP', 'RP'], bench: ['OF', 'SP', 'SS'], teams: ['LAD', 'NYY', 'ATL', 'HOU', 'PHI', 'BAL', 'SEA', 'TEX'], pts: 8 },
  SOCCER: { week: 11, totalWeeks: 38, playoffStart: 35, deadline: 26, daily: false, waiverType: 'rolling', slots: ['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'], bench: ['GKP', 'DEF', 'MID', 'FWD'], teams: ['ARS', 'MCI', 'LIV', 'CHE', 'TOT', 'NEW', 'AVL', 'MUN'], pts: 6 },
}

const FIRST = ['Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Rowan', 'Emerson', 'Dakota', 'Sawyer', 'Hayden', 'Reese', 'Parker', 'Logan', 'Kendall', 'Skyler', 'Blake', 'Drew', 'Finley', 'Harper']
const LAST = ['Calloway', 'Brightwater', 'Okafor', 'Lindqvist', 'Marchetti', 'Holloway', 'Sutherland', 'Vance', 'Amari', 'Kowalski', 'Delacroix', 'Whitfield', 'Nakamura', 'Ferreira', 'Ashby', 'Montoya', 'Rourke', 'Valdez', 'Thornbury', 'Esposito']
export const MANAGERS = ['Gridiron Ghosts', 'Second Half Surge', 'Waiver Wire Wizards', 'Bench Mob', 'Late Round Legends', 'Trade Deadline Thieves', 'Sunday Scaries', 'The Comeback Kids', 'Fourth & Forever', 'Bye Week Blues', 'Commissioner’s Pick', 'Draft Day Darlings']

function seeded(n: number) {
  let s = n * 9301 + 49297
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}
const name = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`
/** The real position a slot is filled from (flex slots take a concrete position). */
function fillPosition(sport: HarnessSport, slot: string, i: number): string {
  const flex: Record<string, string[]> = { FLEX: ['RB', 'WR', 'TE'], UTIL: sport === 'MLB' ? ['1B', 'OF'] : ['PG', 'SF', 'C'], G: sport === 'NHL' ? ['G'] : ['PG', 'SG'], F: ['SF', 'PF'] }
  if (sport === 'NCAAB') return slot === 'UTIL' ? ['G', 'F', 'C'][i % 3] : slot
  const pool = flex[slot]
  return pool ? pool[i % pool.length] : slot
}

type Player = { id: string; name: string; position: string; team: string; projected: number; points: number; injury: string | null; status: 'upcoming' | 'live' | 'final'; label: string; opponent: string | null; off: boolean }

function gameLabel(sport: HarnessSport, status: Player['status'], r: number) {
  if (status === 'final') return 'Final'
  if (status === 'live') {
    if (sport === 'NFL' || sport === 'NCAAF') return `Q${1 + Math.floor(r * 4)} ${Math.floor(r * 14)}:${String(Math.floor(r * 59)).padStart(2, '0')}`
    if (sport === 'NHL') return `P${1 + Math.floor(r * 3)} ${Math.floor(r * 19)}:${String(Math.floor(r * 59)).padStart(2, '0')}`
    if (sport === 'MLB') return `${r > 0.5 ? 'Top' : 'Bot'} ${1 + Math.floor(r * 9)}`
    if (sport === 'SOCCER') return `${10 + Math.floor(r * 80)}′`
    return `Q${1 + Math.floor(r * 4)} ${Math.floor(r * 11)}:${String(Math.floor(r * 59)).padStart(2, '0')}`
  }
  return sport === 'NFL' ? 'Sun 4:25 PM' : sport === 'NCAAF' ? 'Sat 3:30 PM' : sport === 'SOCCER' ? 'Sat 10:00 AM' : '7:30 PM'
}

/** One team's players for a sport: starters (slot order) then bench. `seed` keeps each team distinct. */
export function teamPlayers(sport: HarnessSport, seed: number): { starters: Player[]; bench: Player[] } {
  const cfg = SPORTS[sport]
  const rnd = seeded(seed + sport.length * 31)
  const make = (pos: string, i: number, bench: boolean): Player => {
    const r = rnd()
    const status: Player['status'] = r < 0.35 ? 'final' : r < 0.6 ? 'live' : 'upcoming'
    const projected = Math.round(cfg.pts * (0.6 + rnd() * 0.8) * 10) / 10
    const points = status === 'upcoming' ? 0 : Math.round(projected * (status === 'final' ? 0.5 + rnd() : 0.2 + rnd() * 0.6) * 10) / 10
    const idx = seed * 23 + i + (bench ? 11 : 0)
    // One bye (weekly sports) / off day (daily sports) on the bench, one questionable starter, one out on the bench.
    const off = bench && i === 1
    const injury = !bench && i === 2 ? 'Questionable' : bench && i === 0 ? 'Out' : null
    return {
      id: `${sport.toLowerCase()}-${seed}-${bench ? 'b' : 's'}${i}`,
      name: name(idx),
      position: fillPosition(sport, pos, i),
      team: cfg.teams[(idx + seed) % cfg.teams.length],
      projected,
      points: off ? 0 : points,
      injury,
      status: off ? 'upcoming' : status,
      label: off ? (cfg.daily ? 'No game' : 'Bye') : gameLabel(sport, status, rnd()),
      opponent: off ? (cfg.daily ? null : 'BYE') : cfg.teams[(idx + seed + 3) % cfg.teams.length],
      off,
    }
  }
  return { starters: cfg.slots.map((p, i) => make(p, i, false)), bench: cfg.bench.map((p, i) => make(p, i, true)) }
}

function unified(sport: HarnessSport, p: Player, bench: boolean) {
  return {
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.team,
    sport,
    injuryStatus: p.injury,
    projectedPoints: p.off ? null : p.projected,
    periodOpponent: p.opponent,
    periodHomeAway: bench ? 'away' : 'home',
    positionRankLabel: SPORTS[sport].daily ? `${p.position}${3 + (p.name.length % 20)}` : null,
  }
}

function slotTemplate(sport: HarnessSport) {
  const flex: Record<string, string[]> = { FLEX: ['RB', 'WR', 'TE'], UTIL: sport === 'MLB' ? ['C', '1B', '2B', '3B', 'SS', 'OF'] : ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'], G: sport === 'NHL' ? ['G'] : ['PG', 'SG', 'G'], F: sport === 'NCAAB' ? ['F'] : ['SF', 'PF', 'F'] }
  return SPORTS[sport].slots.map((label, index) => ({ index, label, allowedPositions: flex[label] ?? [label], isFlexible: Boolean(flex[label]) && !['G'].includes(label) }))
}

/** `/api/league/roster` — the viewer's roster. */
export function rosterResponse(sport: HarnessSport) {
  const cfg = SPORTS[sport]
  const t = teamPlayers(sport, 0)
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const days = cfg.daily
    ? Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today)
        d.setUTCDate(today.getUTCDate() + i - 2)
        const status = i < 2 ? 'past' : i === 2 ? 'today' : 'future'
        const slots: Record<string, string> = {}
        const points: Record<string, number> = {}
        t.starters.forEach((p, j) => {
          slots[p.id] = cfg.slots[j]
          if (status === 'past') points[p.id] = Math.round(p.projected * (0.6 + ((i + j) % 5) / 6) * 10) / 10
        })
        return { day: iso(d), status, slots, points, starterPoints: Object.values(points).reduce((s, v) => s + v, 0) }
      })
    : []
  return {
    source: 'harness',
    rosterId: 'r-0',
    lineupVersion: 'harness-1',
    faabRemaining: cfg.waiverType === 'faab' ? 64 : null,
    waiverPriority: 4,
    leagueWeek: cfg.week,
    canEditLineup: true,
    roster: { lineup_sections: { starters: t.starters.map((p, slotIndex) => ({ id: p.id, slotIndex })), bench: t.bench.map(p => ({ id: p.id })), ir: [], taxi: [], devy: [] } },
    unifiedRoster: [...t.starters.map(p => unified(sport, p, false)), ...t.bench.map(p => unified(sport, p, true))],
    starterSlots: slotTemplate(sport),
    slotLimits: { bench: cfg.bench.length + 1, ir: 1, taxi: 0 },
    lineupLock: { lockedPlayerIds: t.starters.filter(p => p.status !== 'upcoming').map(p => p.id), perPlayerReasons: {} },
    irRules: { irAllowOut: true, irAllowCovid: false, irAllowSuspended: false, irAllowNA: false, irAllowDNR: false, irAllowDoubtful: false },
    dailyLineups: cfg.daily
      ? { week: cfg.week, today: days[2].day, days, weekPoints: days.reduce((s, d) => s + d.starterPoints, 0), startedPoints: {} }
      : null,
  }
}

const sumPts = (ps: Player[]) => Math.round(ps.reduce((s, p) => s + p.points, 0) * 10) / 10
const sumProj = (ps: Player[]) => Math.round(ps.reduce((s, p) => s + p.projected, 0) * 10) / 10
function slot(p: Player) {
  return { playerId: p.id, name: p.name, position: p.position, team: p.team, opponent: p.opponent, headshotUrl: null, currentPoints: p.points, projectedPoints: p.projected, hasRealProjection: true, injuryStatus: p.injury, newsBlurb: null, weatherSummary: null, gameStatus: p.status, gameLabel: p.label, aiInsight: null }
}

/** `/api/leagues/[id]/matchup-center`. Slot `position` is the SLOT label (what the screen pills). */
export function matchupResponse(sport: HarnessSport) {
  const cfg = SPORTS[sport]
  const l = teamPlayers(sport, 0).starters
  const r = teamPlayers(sport, 1).starters
  const side = (ps: Player[], i: number) => ({ projectedTotalIncludesFallback: false, rosterId: `r-${i}`, teamName: MANAGERS[i], avatarUrl: null, record: { wins: 5 - i, losses: 3 + i, ties: 0 }, winPct: 0.5, totalPoints: sumPts(ps), projectedTotal: sumProj(ps), starters: ps.map((p, j) => ({ ...slot(p), position: cfg.slots[j] })), remainingStarters: ps.filter(p => p.status !== 'final').length })
  return {
    payload: {
      leagueId: 'e2e', season: 2026, week: cfg.week, sport, matchupStatus: 'live', conceptOverlay: null,
      left: side(l, 0), right: side(r, 1), winProbabilityLeft: 0.62,
      insights: { matchupEdge: '', startSit: `Your ${cfg.slots[1]} slot has the bigger ceiling tonight; the projection gap is ${Math.round(cfg.pts * 0.8)} points.`, weather: '' },
      partialData: false, refreshIntervalMs: 0,
    },
  }
}

export function scoreboardResponse(sport: HarnessSport) {
  const rows = MANAGERS.map((teamName, i) => ({ rosterId: `r-${i}`, teamName, totalPoints: Math.round(SPORTS[sport].pts * SPORTS[sport].slots.length * (0.55 + ((i * 37) % 40) / 100) * 10) / 10, opponentRosterId: `r-${i % 2 ? i - 1 : i + 1}` }))
  return { matchups: rows }
}

export function standingsResponse(sport: HarnessSport) {
  const cfg = SPORTS[sport]
  const played = cfg.week - 1
  const standings = MANAGERS.map((teamName, i) => {
    const wins = Math.max(0, played - Math.round((i * played) / 11))
    return { rosterId: `r-${i}`, teamName, wins, losses: played - wins, ties: 0, pointsFor: Math.round(cfg.pts * cfg.slots.length * played * (1.1 - i * 0.03) * 10) / 10, pointsAgainst: Math.round(cfg.pts * cfg.slots.length * played * (0.9 + (i % 4) * 0.04) * 10) / 10, rank: i + 1, streak: i % 3 === 0 ? 'W2' : i % 3 === 1 ? 'L1' : 'W1', allPlay: `${Math.max(0, 70 - i * 6)}-${10 + i * 6}` }
  })
  // The viewer (r-0 is the matchup's left side) sits 3rd so the path card has a real story.
  const swapped = [standings[1], standings[2], { ...standings[0] }, ...standings.slice(3)].map((r, i) => ({ ...r, rank: i + 1 }))
  return { season: 2026, standings: swapped, viewerRosterId: 'r-0', scoredWeeks: played, scoringMode: 'h2h', divisions: null, divisionPlayoffRule: null }
}

export function forecastResponse() {
  const probs = [97, 91, 84, 66, 58, 41, 29, 18, 9, 4, 1, 0]
  const order = ['r-1', 'r-2', 'r-0', 'r-3', 'r-4', 'r-5', 'r-6', 'r-7', 'r-8', 'r-9', 'r-10', 'r-11']
  return { teamForecasts: order.map((teamId, i) => ({ teamId, playoffProbability: probs[i], byeProbability: Math.max(0, probs[i] - 50) })) }
}

export function seedsResponse() {
  const order = ['r-1', 'r-2', 'r-0', 'r-3', 'r-4', 'r-5']
  return { seeds: order.map((rosterId, i) => ({ rosterId, seed: i + 1, teamName: MANAGERS[Number(rosterId.slice(2))] })), projected: true }
}

/** `/api/redraft/playoff-runtime`: an ungenerated bracket in season, a generated round-one bracket in the playoffs. */
export function playoffRuntimeResponse(sport: HarnessSport, stage: HarnessStage) {
  const cfg = SPORTS[sport]
  const order = ['r-1', 'r-2', 'r-0', 'r-3', 'r-4', 'r-5']
  const seeds = order.map((rosterId, i) => ({ seed: i + 1, rosterId, displayName: MANAGERS[Number(rosterId.slice(2))], qualifiedBy: 'standings', wins: 8 - i, losses: 3 + i, ties: 0, winPct: 0.6, pointsFor: 1000, pointsAgainst: 900, divisionRecord: null, tiebreakerValues: {} }))
  const generated = stage === 'playoffs'
  const m = (n: number, round: number, home: string | null, away: string | null, hs: number | null, as: number | null, bye = false) => ({
    matchupId: `m${round}-${n}`, roundId: `round-${round}`, roundNumber: round, roundName: round === 1 ? 'Quarterfinals' : round === 2 ? 'Semifinals' : 'Championship', matchupNumber: n, bracketType: 'championship',
    homeRosterId: home, awayRosterId: away, homeSeed: home ? order.indexOf(home) + 1 : null, awaySeed: away ? order.indexOf(away) + 1 : null,
    homeScore: hs, awayScore: as, winnerRosterId: null, loserRosterId: null, nextMatchupId: null, status: hs != null ? 'live' : 'scheduled', bye, complete: false, metadata: {},
  })
  const rounds = generated
    ? [
        { roundId: 'round-1', roundNumber: 1, roundName: 'Quarterfinals', bracketType: 'championship', status: 'active', matchups: [m(1, 1, 'r-1', null, null, null, true), m(2, 1, 'r-2', null, null, null, true), m(3, 1, 'r-0', 'r-5', Math.round(cfg.pts * cfg.slots.length * 0.7), Math.round(cfg.pts * cfg.slots.length * 0.6)), m(4, 1, 'r-3', 'r-4', Math.round(cfg.pts * cfg.slots.length * 0.5), Math.round(cfg.pts * cfg.slots.length * 0.55))] },
        { roundId: 'round-2', roundNumber: 2, roundName: 'Semifinals', bracketType: 'championship', status: 'pending', matchups: [m(1, 2, 'r-1', null, null, null), m(2, 2, 'r-2', null, null, null)] },
        { roundId: 'round-3', roundNumber: 3, roundName: 'Championship', bracketType: 'championship', status: 'pending', matchups: [m(1, 3, null, null, null, null)] },
      ]
    : []
  return {
    playoffs: {
      leagueId: 'e2e', seasonId: 's', season: 2026, week: generated ? cfg.playoffStart : cfg.week, generatedAtIso: new Date().toISOString(), settings: {},
      teams: MANAGERS.map((n, i) => ({ rosterId: `r-${i}`, displayName: n })), seeds,
      bubbleRosterIds: ['r-4', 'r-5', 'r-6'], eliminatedRosterIds: MANAGERS.map((_, i) => `r-${i}`).filter(id => !order.includes(id)),
      bracket: { bracketId: generated ? 'b' : null, status: generated ? 'in_progress' : 'not_generated', locked: generated, generated, rounds, consolationRounds: [], lowerBracket: 'none', thirdPlaceMatchup: null, championRosterId: null, runnerUpRosterId: null, thirdPlaceRosterId: null, lowerBracketResultRosterId: null, finalStandings: [] },
      coverage: { teamCount: 12, qualifiedTeams: 6, championshipRounds: 3, championshipMatchups: 7, consolationMatchups: 0, thirdPlaceMatchups: 0, completedMatchups: 0 },
    },
  }
}

/** `/api/waiver-wire/leagues/[id]/players` — unrostered players for the sport. */
export function waiverPlayersResponse(sport: HarnessSport) {
  const cfg = SPORTS[sport]
  const positions = Array.from(new Set([...cfg.slots, ...cfg.bench].filter(s => !['FLEX', 'UTIL'].includes(s))))
  const players = Array.from({ length: 14 }, (_, i) => {
    const pos = sport === 'NBA' && positions[i % positions.length] === 'G' ? 'PG' : sport === 'NBA' && positions[i % positions.length] === 'F' ? 'SF' : positions[i % positions.length]
    return { id: `${sport.toLowerCase()}-fa-${i}`, name: name(300 + i * 3), position: pos, team: cfg.teams[i % cfg.teams.length], sport, injuryStatus: i === 3 ? 'Questionable' : i === 7 ? 'Out' : null, projectedPoints: Math.round(cfg.pts * (1.1 - i * 0.05) * 10) / 10, ownershipPercent: Math.max(2, 61 - i * 4) }
  })
  return { players, nhlProspects: null }
}

export function waiverSettingsResponse(sport: HarnessSport) {
  const cfg = SPORTS[sport]
  return { sport, waiverType: cfg.waiverType, processingDayOfWeek: 3, faabBudget: cfg.waiverType === 'faab' ? 100 : null, tiebreakRule: 'rolling_priority', instantFaAfterClear: true, dailyPolicy: null, phasePolicy: null }
}

export function waiverClaimsResponse(sport: HarnessSport) {
  const faab = SPORTS[sport].waiverType === 'faab'
  return {
    claims: [
      { id: 'c1', addPlayerId: `${sport.toLowerCase()}-fa-0`, dropPlayerId: `${sport.toLowerCase()}-0-b2`, faabBid: faab ? 22 : null, priorityOrder: 1, status: 'pending' },
      { id: 'c2', addPlayerId: `${sport.toLowerCase()}-fa-2`, dropPlayerId: null, faabBid: faab ? 9 : null, priorityOrder: 2, status: 'pending' },
    ],
  }
}

export function waiverHistoryResponse(sport: HarnessSport) {
  const faab = SPORTS[sport].waiverType === 'faab'
  const at = new Date(Date.now() - 3 * 86_400_000).toISOString()
  return {
    transactions: [
      { id: 't1', addPlayerId: `${sport.toLowerCase()}-0-b0`, dropPlayerId: null, faabSpent: faab ? 14 : null, processedAt: at, roster: { id: 'r-0' } },
      { id: 't2', addPlayerId: 'x1', dropPlayerId: null, faabSpent: faab ? 31 : null, processedAt: at, roster: { id: 'r-3' } },
      { id: 't3', addPlayerId: 'x2', dropPlayerId: null, faabSpent: faab ? 5 : null, processedAt: at, roster: { id: 'r-7' } },
    ],
  }
}

export function waiverStateResponse() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7 || 7))
  d.setUTCHours(8, 0, 0, 0)
  return { state: { nextRunAt: d.toISOString() } }
}

/** `/api/league/trades-panel`. */
export function tradesResponse(sport: HarnessSport) {
  const mine = teamPlayers(sport, 0)
  const theirs = teamPlayers(sport, 3)
  const asset = (p: Player) => ({ id: p.id, label: p.name, sublabel: `${p.position} · ${p.team}` })
  const now = Date.now()
  return {
    tradeBlock: [teamPlayers(sport, 5).bench[0], teamPlayers(sport, 6).starters[3], teamPlayers(sport, 8).bench[2]].map((p, i) => ({ id: `tb${i}`, ownerName: MANAGERS[5 + i], name: p.name, position: p.position, team: p.team })),
    activeTrades: [
      { id: 'tr1', direction: 'incoming', partnerName: MANAGERS[3], timestamp: new Date(now - 5 * 3_600_000).toISOString(), sent: [asset(mine.starters[1])], received: [asset(theirs.starters[3]), asset(theirs.bench[0])], status: 'pending', viewerIsReceiver: true, leagueGrade: { graded: true, letter: 'B+', partnerLetter: 'C+', percentDiff: 11, label: 'You win', recommendation: 'You get the better weekly starter and keep your depth. Accept unless you need the bench piece.' } },
      { id: 'tr2', direction: 'complete', partnerName: MANAGERS[6], proposerName: MANAGERS[6], receiverName: MANAGERS[9], timestamp: new Date(now - 26 * 3_600_000).toISOString(), sent: [asset(teamPlayers(sport, 6).starters[0])], received: [asset(teamPlayers(sport, 9).starters[2])], status: 'awaiting_commissioner', viewerIsCommissioner: true },
      { id: 'tr3', direction: 'outgoing', partnerName: MANAGERS[8], timestamp: new Date(now - 30 * 3_600_000).toISOString(), sent: [asset(mine.bench[2])], received: [asset(teamPlayers(sport, 8).bench[1])], status: 'pending', viewerIsProposer: true },
    ],
    historyTrades: [
      { id: 'h1', direction: 'complete', partnerName: MANAGERS[2], proposerName: MANAGERS[1], receiverName: MANAGERS[2], timestamp: new Date(now - 6 * 86_400_000).toISOString(), sent: [asset(teamPlayers(sport, 1).starters[4])], received: [asset(teamPlayers(sport, 2).starters[5])], status: 'accepted' },
    ],
  }
}
