/**
 * HARNESS FIXTURES ONLY (app/e2e is notFound() in production — app/e2e/layout.tsx).
 *
 * The four Tailwind tabs (War Room, Live scores, Chimmy Coaching, Schedule) load their data
 * themselves, so this harness answers their requests in the browser instead of letting them reach the
 * dev server's API routes — which would need a database. Nothing here is product data: every value is
 * a labelled fixture, and a request this file does not know is answered `404 {}` so the tab shows its
 * own empty / unavailable state rather than hanging. No request leaves the page.
 */

export type HarnessFormat = 'redraft' | 'dynasty' | 'guillotine'
export const HARNESS_TABS = ['war_room', 'scores', 'ai_coaching', 'schedule'] as const
export type HarnessTab = (typeof HARNESS_TABS)[number]

type Team = { abbr: string; name: string }

/** Two clubs per game, three games: one live, one final, one upcoming. Abbreviations only. */
const CLUBS: Record<string, Team[]> = {
  NFL: [
    { abbr: 'KC', name: 'Kansas City' }, { abbr: 'BUF', name: 'Buffalo' },
    { abbr: 'PHI', name: 'Philadelphia' }, { abbr: 'DAL', name: 'Dallas' },
    { abbr: 'SF', name: 'San Francisco' }, { abbr: 'DET', name: 'Detroit' },
  ],
  NBA: [
    { abbr: 'BOS', name: 'Boston' }, { abbr: 'NYK', name: 'New York' },
    { abbr: 'DEN', name: 'Denver' }, { abbr: 'LAL', name: 'Los Angeles' },
    { abbr: 'OKC', name: 'Oklahoma City' }, { abbr: 'MIL', name: 'Milwaukee' },
  ],
  NHL: [
    { abbr: 'EDM', name: 'Edmonton' }, { abbr: 'FLA', name: 'Florida' },
    { abbr: 'NYR', name: 'NY Rangers' }, { abbr: 'DAL', name: 'Dallas' },
    { abbr: 'COL', name: 'Colorado' }, { abbr: 'TOR', name: 'Toronto' },
  ],
  MLB: [
    { abbr: 'LAD', name: 'Los Angeles' }, { abbr: 'NYY', name: 'New York' },
    { abbr: 'ATL', name: 'Atlanta' }, { abbr: 'HOU', name: 'Houston' },
    { abbr: 'PHI', name: 'Philadelphia' }, { abbr: 'BAL', name: 'Baltimore' },
  ],
  NCAAF: [
    { abbr: 'UGA', name: 'Georgia' }, { abbr: 'ALA', name: 'Alabama' },
    { abbr: 'OSU', name: 'Ohio State' }, { abbr: 'MICH', name: 'Michigan' },
    { abbr: 'TEX', name: 'Texas' }, { abbr: 'ORE', name: 'Oregon' },
  ],
  NCAAB: [
    { abbr: 'DUKE', name: 'Duke' }, { abbr: 'UNC', name: 'North Carolina' },
    { abbr: 'UCONN', name: 'UConn' }, { abbr: 'KU', name: 'Kansas' },
    { abbr: 'HOU', name: 'Houston' }, { abbr: 'PUR', name: 'Purdue' },
  ],
  SOCCER: [
    { abbr: 'ARS', name: 'Arsenal' }, { abbr: 'MCI', name: 'Man City' },
    { abbr: 'LIV', name: 'Liverpool' }, { abbr: 'CHE', name: 'Chelsea' },
    { abbr: 'TOT', name: 'Tottenham' }, { abbr: 'NEW', name: 'Newcastle' },
  ],
}

const LIVE_CLOCK: Record<string, { period: number; clock: string }> = {
  NFL: { period: 3, clock: '8:42' }, NCAAF: { period: 2, clock: '1:15' },
  NBA: { period: 4, clock: '3:07' }, NCAAB: { period: 2, clock: '11:30' },
  NHL: { period: 2, clock: '14:02' }, MLB: { period: 6, clock: '' }, SOCCER: { period: 2, clock: "67'" },
}

const MANAGERS = ['Gridiron Ghosts', 'Waiver Wire Wizards', 'Bench Mob', 'Sleeper Cell', 'Fourth & Long', 'Trade Bait',
  'Late Round Lottery', 'The Taxi Squad', 'Flex Appeal', 'Monday Miracle', 'Handcuff Kings', 'Bye Week Blues']

function liveScores(sport: string, week: number) {
  const c = CLUBS[sport] ?? CLUBS.NFL!
  const clock = LIVE_CLOCK[sport] ?? LIVE_CLOCK.NFL!
  const big = sport === 'NBA' || sport === 'NCAAB'
  const low = sport === 'NHL' || sport === 'SOCCER' || sport === 'MLB'
  const s = (n: number) => (big ? 80 + n * 3 : low ? n % 6 : 7 + n * 3)
  const base = { venue: null as string | null, broadcast: null as string | null, week, homeLogo: '', awayLogo: '' }
  return [
    { ...base, gameId: 'fx-live', awayTeam: c[0]!.abbr, awayTeamFull: c[0]!.name, homeTeam: c[1]!.abbr, homeTeamFull: c[1]!.name,
      awayScore: s(5), homeScore: s(4), status: 'STATUS_IN_PROGRESS', statusDetail: '', period: clock.period, clock: clock.clock,
      completed: false, startTime: '2026-11-01T18:00:00.000Z', broadcast: 'Fixture TV', venue: 'Fixture Stadium' },
    { ...base, gameId: 'fx-final', awayTeam: c[2]!.abbr, awayTeamFull: c[2]!.name, homeTeam: c[3]!.abbr, homeTeamFull: c[3]!.name,
      awayScore: s(2), homeScore: s(6), status: 'STATUS_FINAL', statusDetail: 'Final', period: 4, clock: '',
      completed: true, startTime: '2026-11-01T15:00:00.000Z' },
    { ...base, gameId: 'fx-upcoming', awayTeam: c[4]!.abbr, awayTeamFull: c[4]!.name, homeTeam: c[5]!.abbr, homeTeamFull: c[5]!.name,
      awayScore: 0, homeScore: 0, status: 'STATUS_SCHEDULED', statusDetail: '', period: 0, clock: '',
      completed: false, startTime: '2026-11-02T01:20:00.000Z', broadcast: 'Fixture+' },
  ]
}

export type HarnessSeason = { week: number; total: number; playoffs: number; deadline: number }

function schedule(leagueId: string, s: HarnessSeason) {
  const regularSeasonWeeks = s.playoffs - 1
  const teams = MANAGERS.map((name, i) => ({ rosterId: `r${i + 1}`, displayName: name }))
  const weeks = Array.from({ length: regularSeasonWeeks }, (_, i) => {
    const week = i + 1
    const done = week < s.week
    return {
      week,
      status: done ? 'completed' : week === s.week ? 'open' : 'scheduled',
      locked: done,
      isCurrent: week === s.week,
      byeRosterIds: [],
      matchups: Array.from({ length: teams.length / 2 }, (_, m) => {
        const home = teams[(m + week) % teams.length]!
        const away = teams[(teams.length - 1 - m + week) % teams.length]!
        return {
          id: `m-${week}-${m}`, week, slot: m, type: 'regular', homeRosterId: home.rosterId, awayRosterId: away.rosterId,
          homeName: home.displayName, awayName: away.displayName, homeDivisionId: null, awayDivisionId: null,
          homeDivisionName: null, awayDivisionName: null, divisionGame: false, bye: false, repeatCycle: 0, sourceRound: week,
          status: done ? 'final' : 'scheduled', locked: done,
          homeScore: done ? 98 + ((m * 7 + week * 3) % 40) : null, awayScore: done ? 92 + ((m * 5 + week * 11) % 44) : null,
        }
      }),
    }
  })
  const standings = teams.map((t, i) => ({
    rosterId: t.rosterId, displayName: t.displayName, divisionId: null, divisionName: null,
    wins: Math.max(0, s.week - 1 - (i % 5)), losses: Math.min(s.week - 1, i % 5), ties: 0,
    pointsFor: 900 - i * 23.4, pointsAgainst: 820 + i * 9.1, winPct: 0, divisionWins: 0, divisionLosses: 0, divisionTies: 0,
    streak: null, playoffSeed: i + 1, rankMovement: null, byeWeeks: [],
  }))
  return {
    leagueId, rulesVersion: 1, generatedAtIso: '2026-10-31T00:00:00.000Z', season: 2026, currentWeek: s.week, status: 'in_season',
    regularSeasonWeeks, playoffStartWeek: s.playoffs, generated: true, locked: false, teams, weeks, standings,
    playoffQualificationSnapshot: {
      playoffTeamCount: 6,
      seeds: standings.slice(0, 6).map(r => ({ rosterId: r.rosterId, seed: r.playoffSeed, displayName: r.displayName, record: `${r.wins}-${r.losses}`, pointsFor: r.pointsFor })),
    },
    validationIssues: [],
  }
}

function warRoomState(leagueId: string, sport: string, s: HarnessSeason) {
  return {
    context: {
      leagueId, leagueType: 'redraft', sport, season: 2026, currentWeek: s.week, totalWeeks: s.total, playoffStartWeek: s.playoffs,
      seasonStatus: 'in_season', userRosterId: 'r1', isCommissioner: true,
      teams: [
        { rosterId: 'r1', isUserTeam: true, teamName: MANAGERS[0], wins: 6, losses: 2, ties: 0, pointsFor: 1012.4, playoffSeed: 2, players: [] },
        { rosterId: 'r2', isUserTeam: false, teamName: MANAGERS[3], players: [] },
      ],
      upcomingMatchup: { week: s.week, opponentRosterId: 'r2' }, recentMatchup: null,
      freeAgents: [{ playerName: 'Fixture FA', position: 'FLEX' }],
      availability: { projections: 'available', tradeValues: 'available', injuries: 'missing', waiverPool: 'available' },
      freshness: {}, missingDataFlags: ['Fixture: injury feed not connected in the harness.'],
      featureAvailability: { teamNeeds: true, lineup: true, waivers: true, tradeAnalyze: true, tradeFind: true },
    },
    needs: { urgencyScore: 62, needs: [{ position: 'RB', severity: 'high' }, { position: 'TE', severity: 'medium' }], strengths: ['WR depth', 'QB floor'], tradeTargetPositions: ['RB', 'TE'] },
  }
}

const COACHING_PLAN = {
  mode: 'contend', timelineYears: 3, confidence: 74,
  summary: 'Fixture plan: a top-four roster with a thin RB room. Push for the playoffs and patch depth before the deadline.',
  priorityActions: ['Add an RB2 before the trade deadline', 'Stream a TE by matchup', 'Hold your top WR through the playoffs'],
  rosterStrengths: ['Three startable WRs', 'A top-six QB'], rosterWeaknesses: ['RB2 is a weekly coin flip', 'No TE floor'],
  marketStrategy: ['Sell bench WR depth while it is valued'], draftStrategy: ['Redraft: next draft resets every roster'],
  tradeStrategy: ['Target RBs on losing teams'], waiverStrategy: ['Prioritise RB handcuffs'],
  windowToWin: { label: 'Push now', risk: 'low', explanation: 'Fixture: strongest roster window is this season.' },
  positionHealth: [
    { position: 'QB', strengthScore: 82, outlook: 'strong' }, { position: 'RB', strengthScore: 41, outlook: 'weak' },
    { position: 'WR', strengthScore: 77, outlook: 'strong' }, { position: 'TE', strengthScore: 55, outlook: 'average' },
  ],
  futureCapital: { summary: 'Fixture: redraft — picks reset each season.', picksByYear: {} },
  coreAssets: [], timelinePlan: [{ year: 2026, title: 'Win the season', actions: ['Patch RB', 'Stream TE'] }],
  formatBadges: [] as string[],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Install once per page. Only same-origin `/api/` requests are answered; anything else (fonts, the
 * Next.js runtime, CSS art) goes through untouched.
 */
export function installHarnessFetch(opts: { leagueId: string; sport: string; season: HarnessSeason; format: HarnessFormat }) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __rdtHarnessFetch?: boolean }
  if (w.__rdtHarnessFetch) return
  w.__rdtHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const p = url.pathname
    if (p === '/api/sports/live-scores') {
      return json({ sport: opts.sport, scores: liveScores(opts.sport, opts.season.week), count: 3, source: 'harness_fixture', hasLiveGames: false, fetchedAt: null })
    }
    if (p === '/api/sports/weather') return json({ weather: [] })
    if (p === '/api/subscription/entitlements') return json({ hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } })
    if (p === '/api/guest-mode/status') return json({ isGuest: false })
    if (p === '/api/redraft/season') {
      return json({ season: { id: 'fx-season', leagueId: opts.leagueId, sport: opts.sport, season: 2026, currentWeek: opts.season.week, totalWeeks: opts.season.total, playoffStartWeek: opts.season.playoffs, status: 'in_season', rosters: [] } })
    }
    if (p === '/api/redraft/schedule') return json({ schedule: schedule(opts.leagueId, opts.season) })
    if (p === `/api/leagues/${opts.leagueId}/redraft-war-room`) return json(warRoomState(opts.leagueId, opts.sport, opts.season))
    if (p === '/api/ai/coaching/plan') {
      const plan = { ...COACHING_PLAN, formatBadges: opts.format === 'redraft' ? [] : [opts.format === 'dynasty' ? 'Dynasty' : 'Guillotine'] }
      return json({ ok: true, plan, usedFallback: false, aiModel: null })
    }
    return json({}, 404)
  }
}
