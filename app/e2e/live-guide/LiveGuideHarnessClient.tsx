'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
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

export default function LiveGuideHarnessClient({ mode }: { mode: 'live' | 'between' }) {
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
