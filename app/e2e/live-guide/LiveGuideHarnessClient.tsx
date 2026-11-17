'use client'

import AfCoreShell, { type RailLeague } from '@/components/core-app/AfCoreShell'
import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
import type { MatchupStrip } from '@/lib/live/matchupStrip'
import type { ScoreboardGame, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'
import type { LiveGameCard, LivePageData, LivePlay, LiveRosterTieIn } from '@/lib/live/liveScoresPage'

/**
 * Harness only (app/e2e is 404 in production). SAMPLE data throughout — teams, players, leagues and
 * scores are invented to exercise every section, not read from anywhere.
 */
const tie = (playerName: string, points: number, leagueName = 'Sample League A'): LiveRosterTieIn => ({
  leagueId: 'L1',
  leagueName,
  playerId: playerName,
  playerName,
  position: 'WR',
  imageUrl: null,
  isStarter: true,
  points,
})

const side = (abbrev: string, name: string, score: number, linescores: number[] = []) => ({
  abbrev, name, logo: '', score, record: null, linescores, hits: null, errors: null, leaders: [], shooting: null,
})

function game(id: string, over: Partial<LiveGameCard> = {}): LiveGameCard {
  return {
    gameId: id,
    sport: 'NFL',
    week: 10,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: 'Q3',
    clockLabel: 'Q3 · 8:12',
    isLive: true,
    completed: false,
    startTime: '2026-11-15T18:00:00Z',
    away: side('SMA', 'Sample Away', 17, [7, 10]),
    home: side('SMH', 'Sample Home', 20, [10, 10]),
    winProbability: null,
    topPerformer: null,
    leaders: [],
    situation: null,
    venue: null,
    broadcast: null,
    tieIns: [tie('Sample Receiver', 14.2), tie('Sample Back', 9.8)],
    leaguesAffected: 6,
    leadersArePregame: false,
    espnDetail: true,
    ...over,
  }
}
const final = (id: string, over: Partial<LiveGameCard> = {}) =>
  game(id, { isLive: false, completed: true, status: 'STATUS_FINAL', statusDetail: 'Final', clockLabel: null, ...over })

const play = (i: number): LivePlay => ({
  id: `p${i}`,
  gameId: 'g1',
  canonicalGameId: 'g1',
  type: i % 3 === 0 ? 'TOUCHDOWN' : 'BIG_PLAY',
  playerName: `Sample Player ${i}`,
  sleeperId: null,
  team: 'SMA',
  teamLogoUrl: null,
  imageUrl: null,
  position: 'WR',
  headline: `Sample Player ${i} ${20 + i}-yard catch`,
  action: `${20 + i}-yard catch`,
  yards: 20 + i,
  detectedAt: '2026-11-13T02:00:00Z',
})

function rail(leagueId: string, you: number, them: number, over: Partial<RailMatchup> = {}): RailMatchup {
  return {
    leagueId,
    yourTeam: 'Me',
    yourAvatarUrl: null,
    yourScore: you,
    yourProjection: null,
    opponentTeam: 'Them',
    opponentAvatarUrl: null,
    opponentScore: them,
    opponentProjection: null,
    unpaired: false,
    standing: null,
    scored: true,
    freshAt: null,
    source: 'live_cache',
    season: 2026,
    week: 10,
    ...over,
  }
}

const LEAGUES = [
  { id: 'a', name: 'Sample Dynasty A', sport: 'NFL' },
  { id: 'b', name: 'Sample Redraft B', sport: 'NFL' },
  { id: 'c', name: 'Sample Keeper C', sport: 'NFL' },
  { id: 'd', name: 'Sample Pro League D', sport: 'NFL' },
  { id: 'e', name: 'Sample Best Ball E', sport: 'NFL' },
]
const BY_LEAGUE: Record<string, RailMatchup> = {
  a: rail('a', 12.2, 87.5),
  b: rail('b', 64.1, 66.0),
  c: rail('c', 91.4, 52.3),
  d: rail('d', 40.0, 38.5),
  e: rail('e', 0, 0, { scored: false }),
}

const counts = (nfl: number) => [
  { sport: 'NBA', label: 'NBA', slateCount: 4 },
  { sport: 'WNBA', label: 'WNBA', slateCount: 0 },
  { sport: 'NFL', label: 'NFL', slateCount: nfl },
  { sport: 'MLB', label: 'MLB', slateCount: 0 },
  { sport: 'NHL', label: 'NHL', slateCount: 10 },
  { sport: 'NCAAF', label: 'College Football', slateCount: 0 },
]

const BETWEEN: LivePageData = {
  sport: 'NFL',
  scope: 'my',
  counts: counts(1),
  games: [final('g1', { away: side('SMA', 'Sample Away', 24), home: side('SMH', 'Sample Home', 21) })],
  impact: { totalPoints: 0, livePlayers: 0, liveGames: 0, finishedPlayers: 13, upcomingPlayers: 0, biggestMover: null, plays: Array.from({ length: 12 }, (_, i) => play(i)), upNext: [] },
  fetchedAt: '2026-11-13T04:00:00.000Z',
  hasRosterData: true,
  loadFailed: false,
  rosterFailed: false,
  top25: null,
  lockAlerts: [],
}

const LIVE: LivePageData = {
  ...BETWEEN,
  counts: counts(3),
  games: [game('g2'), game('g3', { leaguesAffected: 3, tieIns: [tie('Sample Tight End', 6.1)] }), BETWEEN.games[0]!],
  impact: {
    ...BETWEEN.impact,
    livePlayers: 4,
    liveGames: 2,
    finishedPlayers: 3,
    upcomingPlayers: 9,
    upNext: [
      { playerName: 'Sample Quarterback', matchup: 'SMX @ SMY', startTime: '2026-11-15T21:05:00.000Z' },
      { playerName: 'Sample Kicker', matchup: 'SMZ @ SMW', startTime: '2026-11-16T01:20:00.000Z' },
    ],
  },
  fetchedAt: '2026-11-15T19:30:00.000Z',
}

/*
 * ?league=1 (2026-11-15): the page as a manager in one league sees it — your matchup scored, the rest of
 * the league, one live game with its full box score and one that has not kicked off. SAMPLE data.
 */
const HELD_STRIP: MatchupStrip = {
  kind: 'scored',
  week: 10,
  isFinal: false,
  you: { name: 'Sample Jets', points: 29 },
  opponent: { name: 'Sample Dolphins', points: 41.7 },
  margin: -12.7,
  pWin: 0.08,
  remaining: { you: { upcoming: 13, live: 3 }, opponent: { upcoming: 11, live: 3 } },
}

const team = (rosterId: string, teamName: string, points: number | null): ScoreboardTeam =>
  ({ rosterId, teamName, managerName: null, avatarUrl: null, points, projected: 95, projectedFrom: 9, starterCount: 9 }) as ScoreboardTeam
const lgGame = (i: number, a: number | null, b: number | null): ScoreboardGame =>
  ({ matchupId: i, teams: [team(`a${i}`, `Sample Team ${i * 2 - 1}`, a), team(`b${i}`, `Sample Team ${i * 2}`, b)], winProbability: null, unplayed: a == null }) as unknown as ScoreboardGame

const LEAGUE_GAMES = {
  week: 10,
  allUnplayed: false,
  weekFinal: false,
  games: [lgGame(1, 20.3, 16), lgGame(2, 29.8, 0), lgGame(3, 43.5, 107.3), lgGame(4, 30.5, 12), lgGame(5, 35.2, 4.7), lgGame(6, 0, 17.7)],
}

const BOX_GAME = game('g2', {
  clockLabel: 'Q2 · 0:00',
  statusDetail: 'Q2 · 0:00',
  away: side('SMA', 'Sample Away', 3, [3, 0]),
  home: side('SMH', 'Sample Home', 21, [7, 14]),
  winProbability: { home: 98, away: 2, isEstimate: true },
  leaders: [
    { label: 'PASS', name: 'Sample Passer', headshot: null, statLine: '12/20, 211 YDS, 2 TD', position: 'QB', teamAbbrev: 'SMH' },
    { label: 'RUSH', name: 'Sample Runner', headshot: null, statLine: '13 CAR, 93 YDS, 1 TD', position: 'RB', teamAbbrev: 'SMH' },
  ] as LiveGameCard['leaders'],
  venue: { name: 'Sample Stadium', location: 'Sample City' } as LiveGameCard['venue'],
  broadcast: 'FOX',
  tieIns: [tie('Sample Safety', 4), tie('Sample Tackle', 8.5), tie('Sample Linebacker', 16.5)],
  leaguesAffected: 1,
})
const PRE_GAME = game('g4', {
  isLive: false,
  status: 'STATUS_SCHEDULED',
  statusDetail: '11/15 - 4:25 PM EST',
  clockLabel: null,
  away: { ...side('SMB', 'Sample Bills', 0), score: null },
  home: { ...side('SMN', 'Sample Nets', 0), score: null },
  leaders: [{ label: 'PASS', name: 'Sample Veteran', headshot: null, statLine: '2078 YDS, 12 TD', position: 'QB', teamAbbrev: 'SMN' }] as LiveGameCard['leaders'],
  leadersArePregame: true,
  venue: { name: 'Sample Dome', location: 'Elsewhere' } as LiveGameCard['venue'],
  broadcast: 'CBS',
  tieIns: [tie('Sample Rookie', 0), tie('Sample Wideout', 0)],
  leaguesAffected: 1,
})
const IN_LEAGUE: LivePageData = {
  ...BETWEEN,
  counts: counts(2),
  games: [BOX_GAME, PRE_GAME],
  impact: { ...BETWEEN.impact, livePlayers: 3, liveGames: 1, finishedPlayers: 0, upcomingPlayers: 2, plays: [] },
  fetchedAt: '2026-11-15T19:30:00.000Z',
}
const HELD_LEAGUE: RailLeague = { id: 'L1', name: 'Sample Dynasty A', platform: 'sleeper', sport: 'NFL', mark: 'S' }

export default function LiveGuideHarnessClient({ mode, league = false }: { mode: 'live' | 'between'; league?: boolean }) {
  if (league) {
    return (
      <AfCoreShell
        active="live"
        leagues={[HELD_LEAGUE]}
        selectedLeagueId="L1"
        syncAge={{ label: 'just now', stale: false }}
        syncEligibleCount={0}
        comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
      >
        <div data-testid="live-guide-harness">
          <LiveScores data={IN_LEAGUE} selectedLeagueId="L1" matchupStrip={HELD_STRIP} leagueGames={LEAGUE_GAMES} />
        </div>
      </AfCoreShell>
    )
  }
  return (
    <AfCoreShell
      active="live"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="live-guide-harness">
        <LiveScores
          data={mode === 'live' ? LIVE : BETWEEN}
          leagueWeek={{ byLeague: BY_LEAGUE, leagues: LEAGUES }}
          sportNextKickoff={mode === 'live' ? null : { sport: 'NFL', at: '2026-11-15T18:00:00.000Z' }}
        />
      </div>
    </AfCoreShell>
  )
}
