/**
 * Best Ball fixtures for the DB-free harness (app/e2e/best-ball). The Best Ball tab's one read,
 * `GET /api/leagues/:id/bestball[?week=]`, is answered from here; the War Room panel's reads come from
 * ./warRoomFixtures.ts. Every other /api/ call gets a 503. Harness-only.
 *
 * ⚠ THE TAB'S RESPONSE TYPE IS LOCAL TO app/league/[leagueId]/tabs/BestBallTab.tsx (`BestBallApiResponse`, not
 * exported), so it is MIRRORED below as `BestBallTabResponse`. It was copied from that file on 2026-11-23; if the
 * tab's type changes, change this one with it. The body is built by
 * app/api/leagues/[leagueId]/bestball/handler.ts.
 *
 * The league: "Underdog Summer Best Ball", 12 teams, native, NFL, half PPR, week 10. The viewer is
 * "Spike Week Society". The week has the cases the tab draws differently: one team still waiting on stats
 * (provisional), one empty slot ("No eligible player on the roster"), a player whose position changed since the
 * week was sealed (`positionNow`), and players who did not count, with the reason.
 */
import type { HarnessApiRoute } from '../harnessApi'
import { BEST_BALL_WAR_ROOM_API } from './warRoomFixtures'

export const BEST_BALL_LEAGUE_ID = 'e2e-bestball'
export const BEST_BALL_SCREENS = ['lineup', 'roster', 'contest', 'history', 'war_room'] as const
export type BestBallHarnessScreen = (typeof BEST_BALL_SCREENS)[number]

type Starter = { playerId: string; name: string; position: string; positionNow?: string; team: string | null; points: number; slot: string | null }
type Bench = { playerId: string; name: string; position: string; positionNow?: string; team: string | null; points: number | null; reason?: string }

/** Mirror of `BestBallApiResponse` in app/league/[leagueId]/tabs/BestBallTab.tsx (see the header). */
type BestBallTabResponse = {
  league: {
    id: string
    name: string
    sport: string
    season: number
    summary: string
    settings: {
      mode: 'standard' | 'underdog'
      draftMode: string
      contestStructure: string
      matchupFormat: string
      waiversEnabled: boolean
      tradesEnabled: boolean
      substitutionsEnabled: boolean
      playoffTeams: number
      scoringPeriod?: string
    }
    profile: { label: string; scoringPeriod: string; recommendedRosterSize: number; lineupSlots: Array<{ code: string; count: number }>; notes: string[] }
  }
  selectedWeek: number
  weeksAvailable: number[]
  source?: 'native' | 'imported'
  importedNote?: string
  draftNotice?: string | null
  dailyScheduleNotice?: string | null
  lineups: Array<{
    rosterId: string
    teamName: string
    totalPoints: number
    scoringPeriod?: 'daily'
    winLoss: string | null
    status?: 'final' | 'provisional'
    starters: Starter[]
    bench: Bench[]
    unfilledSlots?: string[]
    awaitingStats?: number
    sealedSeatsNote?: string
  }>
  rosterComposition: Array<{ rosterId: string; teamName: string; playerCount: number; players?: Array<{ playerId: string; name: string; position: string; team: string | null; reserve: boolean }> }>
  viewerRosterIds?: string[]
  standings: Array<{ rosterId: string; rank: number | null; teamName: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>
  history: Array<{ rosterId: string; week: number; totalPoints: number; status?: 'final' | 'provisional' }>
}

const TEAMS = [
  'Spike Week Society', 'Zero RB Zealots', 'Stack Attack', 'Late Round QBs', 'Bye Week Bandits', 'Correlation Station',
  'The Ceiling Fans', 'Hero RB Heroes', 'Tight End Truthers', 'Fade the Chalk', 'Pocket Aces', 'Week 17 Dreams',
]
const rosterId = (i: number) => `e2e-bb-r${String(i + 1).padStart(2, '0')}`

/** Real NFL names, one pool per slot, rotated per team so every card differs. */
const POOL: Record<string, Array<[string, string]>> = {
  QB: [['Josh Allen', 'BUF'], ['Jalen Hurts', 'PHI'], ['Lamar Jackson', 'BAL'], ['Joe Burrow', 'CIN'], ['Jayden Daniels', 'WAS'], ['C.J. Stroud', 'HOU']],
  RB: [['Bijan Robinson', 'ATL'], ['Jahmyr Gibbs', 'DET'], ['Breece Hall', 'NYJ'], ['De\'Von Achane', 'MIA'], ['Saquon Barkley', 'PHI'], ['Kyren Williams', 'LAR'], ['James Cook', 'BUF'], ['Josh Jacobs', 'GB']],
  WR: [['Ja\'Marr Chase', 'CIN'], ['CeeDee Lamb', 'DAL'], ['Amon-Ra St. Brown', 'DET'], ['Puka Nacua', 'LAR'], ['Garrett Wilson', 'NYJ'], ['Drake London', 'ATL'], ['Nico Collins', 'HOU'], ['Malik Nabers', 'NYG'], ['Brian Thomas Jr.', 'JAX']],
  TE: [['Trey McBride', 'ARI'], ['Brock Bowers', 'LV'], ['Sam LaPorta', 'DET'], ['Travis Kelce', 'KC']],
}
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'] as const

function pts(seed: number): number {
  return Math.round(((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1 * 2400) / 100 + 4
}

function lineupFor(i: number, week: number) {
  const used = new Map<string, number>()
  const pick = (pos: string) => {
    const pool = POOL[pos]!
    const n = used.get(pos) ?? 0
    used.set(pos, n + 1)
    return pool[(i * 3 + n) % pool.length]!
  }
  const starters: Starter[] = SLOTS.map((slot, s) => {
    const pos = slot === 'FLEX' ? (s % 2 ? 'RB' : 'WR') : slot
    const [name, team] = pick(pos)
    return { playerId: `p-${i}-${s}`, name, position: pos, team, points: pts(i * 31 + s * 7 + week), slot }
  })
  // Case: a player whose position changed after the week was sealed (team 3).
  if (i === 2) starters[7] = { ...starters[7]!, position: 'RB', positionNow: 'WR' }
  // Case: an empty slot — no healthy TE on the roster (team 5).
  const unfilledSlots = i === 4 ? ['TE'] : undefined
  if (i === 4) starters.splice(6, 1)
  // Reasons in the words lib/bestball/nativeBestBallTab.ts writes them.
  const bench: Bench[] = [
    { playerId: `b-${i}-1`, name: 'Rome Odunze', position: 'WR', team: 'CHI', points: 6.4, reason: 'Scored 6.40 this week, but on every day he played a higher scorer filled each slot he fits.' },
    { playerId: `b-${i}-2`, name: 'Tank Bigsby', position: 'RB', team: 'JAX', points: 0, reason: 'No points on any day he was on the roster this week.' },
    { playerId: `b-${i}-3`, name: 'Dalton Kincaid', position: 'TE', team: 'BUF', points: null, reason: 'No stats yet for this week.' },
  ]
  const totalPoints = Math.round(starters.reduce((sum, s) => sum + s.points, 0) * 100) / 100
  const provisional = i === 0 || i === 6
  return {
    rosterId: rosterId(i),
    teamName: TEAMS[i]!,
    totalPoints,
    winLoss: null,
    status: provisional ? ('provisional' as const) : ('final' as const),
    starters,
    bench,
    ...(unfilledSlots ? { unfilledSlots } : {}),
    ...(i === 0 ? { awaitingStats: 2 } : {}),
  }
}

function tabBody(week: number): BestBallTabResponse {
  const lineups = TEAMS.map((_, i) => lineupFor(i, week)).sort((a, b) => b.totalPoints - a.totalPoints)
  const history: BestBallTabResponse['history'] = []
  for (let w = 1; w <= 10; w++) {
    TEAMS.forEach((_, i) => history.push({ rosterId: rosterId(i), week: w, totalPoints: Math.round(pts(i * 17 + w * 5) * 6 * 100) / 100, status: w === 10 ? 'provisional' : 'final' }))
  }
  const pf = (i: number) => Math.round(history.filter((h) => h.rosterId === rosterId(i)).reduce((s, h) => s + h.totalPoints, 0) * 100) / 100
  const standings = TEAMS.map((teamName, i) => ({ rosterId: rosterId(i), teamName, pointsFor: pf(i), pointsAgainst: 0, wins: 0, losses: 0, ties: 0, rank: 0 as number | null }))
    .sort((a, b) => b.pointsFor - a.pointsFor)
    .map((row, n) => ({ ...row, rank: n + 1 }))
  return {
    league: {
      id: BEST_BALL_LEAGUE_ID,
      name: 'Underdog Summer Best Ball',
      sport: 'NFL',
      season: 2026,
      // buildBestBallSettingsSummary (lib/bestball/rules.ts) for these settings, word for word.
      summary: 'Underdog-style Best Ball · snake draft · cumulative points scoring · weekly lineups · waivers off, trades off, manual subs off',
      settings: {
        mode: 'underdog',
        draftMode: 'snake',
        contestStructure: 'season_long',
        matchupFormat: 'cumulative',
        waiversEnabled: false,
        tradesEnabled: false,
        substitutionsEnabled: false,
        playoffTeams: 2,
        scoringPeriod: 'weekly',
      },
      profile: {
        label: 'NFL best ball',
        scoringPeriod: 'weekly',
        recommendedRosterSize: 18,
        lineupSlots: [{ code: 'QB', count: 1 }, { code: 'RB', count: 2 }, { code: 'WR', count: 3 }, { code: 'TE', count: 1 }, { code: 'FLEX', count: 1 }],
        notes: ['Half PPR', 'No waivers, no trades: the draft is the whole game.'],
      },
    },
    selectedWeek: week,
    weeksAvailable: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    source: 'native',
    draftNotice: null,
    dailyScheduleNotice: null,
    lineups,
    // The week's roster: the counted players, the three who did not count, then depth to 18 (17 for team 5).
    rosterComposition: TEAMS.map((teamName, i) => {
      const card = lineupFor(i, week)
      const depth = ['Tyler Allgeier', 'Jaylen Warren', 'Jakobi Meyers', 'Khalil Shakir', 'Wan\'Dale Robinson', 'Jonnu Smith', 'Bo Nix', 'Chuba Hubbard', 'Romeo Doubs', 'Darnell Mooney']
      const players = [
        ...card.starters.map((s) => ({ playerId: s.playerId, name: s.name, position: s.positionNow ?? s.position, team: s.team, reserve: false })),
        ...card.bench.map((b) => ({ playerId: b.playerId, name: b.name, position: b.position, team: b.team, reserve: b.playerId.endsWith('-3') })),
        ...depth.map((name, d) => ({ playerId: `d-${i}-${d}`, name, position: ['RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'QB', 'RB', 'WR', 'WR'][d]!, team: null as string | null, reserve: false })),
      ].slice(0, i === 4 ? 17 : 18)
      return { rosterId: rosterId(i), teamName, playerCount: players.length, players }
    }),
    viewerRosterIds: [rosterId(0)],
    standings,
    history,
  }
}

const TAB_PATH = `/api/leagues/${BEST_BALL_LEAGUE_ID}/bestball`

export const BEST_BALL_API: HarnessApiRoute[] = [
  ...Array.from({ length: 10 }, (_, k) => ({ path: TAB_PATH, query: { week: String(k + 1) }, body: tabBody(k + 1) })),
  // The first, week-less read: the server opens on the latest scored week.
  { path: TAB_PATH, body: tabBody(10) },
  ...BEST_BALL_WAR_ROOM_API,
]
