'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'
import type { PlayerShares, ShareRow } from '@/lib/core-app/playerShares'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { PlayerDetail, PlayerMatch } from '@/lib/core-app/playerFinder'
import type { LeagueImpact } from '@/lib/core-app/playerImpact'

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE (same guard as app/e2e/player-finder-sports): every same-origin `/api/`
 * call answers 503, so each widget renders its own "could not load" state and nothing reaches a database.
 */
type HarnessWindow = Window & { __afHarnessFetch?: boolean }
if (typeof window !== 'undefined' && !(window as HarnessWindow).__afHarnessFetch) {
  ;(window as HarnessWindow).__afHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'harness: no API' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    }
    return real(input, init)
  }
}

/* SAMPLE DATA throughout — invented leagues, no row is read from a database. */
const NOW = '2026-11-15T16:10:00.000Z'
const KICKOFF = '2026-11-15T18:00:00.000Z'

const m = (id: string, name: string, position: string, team = 'BUF'): PlayerMatch => ({
  externalId: id, sport: 'NFL', source: 'sleeper', sleeperId: id, name, position, team, imageUrl: null, number: null, rosteredIn: null, platforms: [],
})
const BILLS: PlayerMatch[] = [
  m('4984', 'Josh Allen', 'QB'), m('11100', 'Mitchell Trubisky', 'QB'),
  m('8150', 'James Cook', 'RB'), m('11645', 'Ray Davis', 'RB'),
  m('9500', 'Khalil Shakir', 'WR'), m('10859', 'Keon Coleman', 'WR'), m('5045', 'Curtis Samuel', 'WR'),
  m('10236', 'Dalton Kincaid', 'TE'), m('9493', 'Dawson Knox', 'TE'),
  m('7839', 'Tyler Bass', 'K'), m('BUF', 'Buffalo Bills', 'DEF'),
]

const triage: SectionState<GameDayTriage> = {
  available: true,
  data: {
    rows: [
      {
        player: { sport: 'NFL', externalId: '10236', source: 'sleeper', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null },
        status: { label: 'Questionable', tone: 'warn' },
        description: 'Knee',
        reportedAt: '2026-11-15T13:40:00.000Z',
        leagues: [
          { leagueId: 'L1', leagueName: 'Sample Dynasty League', platform: 'sleeper', platformLeagueId: null, season: 2026, teamId: null },
          { leagueId: 'L2', leagueName: 'Sample Office League', platform: 'espn', platformLeagueId: null, season: 2026, teamId: null },
        ],
        kickoff: KICKOFF,
        noGame: false,
        inactive: null,
        bye: false,
      },
      {
        player: { sport: 'NFL', externalId: '8150', source: 'sleeper', sleeperId: '8150', name: 'James Cook', position: 'RB', team: 'BUF', imageUrl: null },
        status: { label: 'Out', tone: 'bad' },
        description: 'Ankle',
        reportedAt: '2026-11-15T11:05:00.000Z',
        leagues: [{ leagueId: 'L3', leagueName: 'Sample Redraft League', platform: 'yahoo', platformLeagueId: null, season: 2026, teamId: null }],
        kickoff: KICKOFF,
        noGame: false,
        inactive: null,
        bye: false,
      },
    ] as TriageRow[],
    week: { season: 2026, week: 11 },
    leaguesRead: 5,
    startersRead: 42,
    unidentifiedStarters: 0,
    rostersAsOf: NOW,
    rosterAges: [],
    skipped: [],
  } as GameDayTriage,
}

const shareRow = (p: PlayerMatch, leagues: number, starts: number, status: ShareRow['status'] = null): ShareRow => ({
  player: { sport: 'NFL', externalId: p.externalId, source: 'sleeper', sleeperId: p.sleeperId!, name: p.name, position: p.position, team: p.team, imageUrl: null },
  leagues,
  starts,
  ir: 0,
  leagueIds: ['L1', 'L2', 'L3', 'L4', 'L5'].slice(0, leagues),
  status,
  description: null,
})
const shares: SectionState<PlayerShares> = {
  available: true,
  data: {
    rows: [
      shareRow(BILLS[7]!, 3, 2, { label: 'Questionable', tone: 'warn' }),
      shareRow(BILLS[2]!, 2, 1, { label: 'Out', tone: 'bad' }),
      shareRow(BILLS[4]!, 2, 2),
    ],
    leaguesRead: 5,
    playersHeld: 61,
    unsupportedLeagues: 0,
    teamSplit: null,
  },
}

const impact = (over: Partial<LeagueImpact> & Pick<LeagueImpact, 'leagueId' | 'leagueName' | 'platform' | 'slot'>): LeagueImpact => ({
  platformLeagueId: null,
  season: 2026,
  exactSlot: null,
  slotConfirmed: true,
  isStarting: over.slot === 'STARTER',
  afPoints: { available: false, reason: 'sample' },
  replacements: { available: false, reason: 'sample' },
  startOver: null,
  ...over,
}) as LeagueImpact

const DETAIL: PlayerDetail = {
  player: { externalId: '10236', sport: 'NFL', source: 'sleeper', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null, number: 86, rosteredIn: 3, platforms: ['sleeper', 'espn', 'yahoo'] },
  identityResolved: true,
  bio: { height: null, weight: null, age: 27, college: 'Utah' },
  injury: { available: true, data: { status: 'Questionable', description: 'Knee', reportedAt: '2026-11-15T13:40:00.000Z' } },
  seasonStats: { available: false, reason: 'sample' },
  leagues: {
    available: true,
    data: [
      { leagueId: 'L1', leagueName: 'Sample Dynasty League', platform: 'sleeper', format: 'Dynasty PPR', platformLeagueId: '111', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      { leagueId: 'L2', leagueName: 'Sample Office League', platform: 'espn', format: 'PPR', platformLeagueId: '222', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      { leagueId: 'L3', leagueName: 'Sample Redraft League', platform: 'yahoo', format: 'Half PPR', platformLeagueId: '333', season: 2026, slot: 'BENCH', isYours: true, owner: null },
      {
        leagueId: 'L4',
        leagueName: 'Sample Keeper League',
        platform: 'sleeper',
        format: 'Keeper',
        platformLeagueId: '444',
        season: 2026,
        slot: 'NOT YOURS',
        isYours: false,
        owner: { teamName: 'Sample Rivals', ownerName: 'sample_rival', avatarUrl: null, externalId: '9' },
      },
    ],
  },
  projection: { available: true, data: { points: 11.4, season: '2026', week: 11 } },
  game: { available: true, data: { kickoff: KICKOFF, opponent: 'KC', home: true, week: 11, season: 2026, preseason: false } },
  kickoffs: { BUF: KICKOFF, KC: KICKOFF },
  scheduleWeek: { season: 2026, week: 11 },
  kickoffsUnresolved: 0,
  snapShare: { available: true, data: { share: 0.74, snaps: 420, teamSnaps: 567, games: 9, basis: 'offense' } },
  positionRank: { available: true, data: { rank: 7, outOf: 118, position: 'TE' } },
  impact: {
    available: true,
    data: [
      impact({ leagueId: 'L1', leagueName: 'Sample Dynasty League', platform: 'sleeper', platformLeagueId: '111', slot: 'STARTER', exactSlot: 'TE', afPoints: { available: true, data: { points: 11.9, matchedKeys: 4, scoredKeys: 20 } } }),
      impact({ leagueId: 'L2', leagueName: 'Sample Office League', platform: 'espn', platformLeagueId: '222', slot: 'STARTER', exactSlot: 'TE', afPoints: { available: true, data: { points: 11.4, matchedKeys: 4, scoredKeys: 20 } } }),
      impact({ leagueId: 'L3', leagueName: 'Sample Redraft League', platform: 'yahoo', platformLeagueId: '333', slot: 'BENCH', afPoints: { available: true, data: { points: 9.6, matchedKeys: 4, scoredKeys: 20 } } }),
    ],
  },
  recommendedMoves: { available: true, data: [] },
  freshness: { label: '4m ago', stale: false },
  rosterCoverage: { unmatched: [] },
} as unknown as PlayerDetail

export default function PlayerFinderGuideHarnessClient({ view }: { view: 'home' | 'player' | 'team' }) {
  const query = view === 'player' ? 'Dalton Kincaid' : view === 'team' ? 'Bills' : ''
  return (
    <AfCoreShell
      active="players"
      leagues={[]}
      selectedLeagueId={null}
      nativeLeague={false}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: 'all', label: 'All leagues', favoriteIds: [], leagues: [] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="player-finder-guide-fixture" data-view={view}>
        <PlayerFinder
          query={query}
          matches={view === 'team' ? BILLS : view === 'player' ? [BILLS[7]!] : []}
          detail={view === 'player' ? DETAIL : null}
          leagueCount={5}
          signedIn
          homeSports={[{ sport: 'NFL', leagues: 5 }, { sport: 'NBA', leagues: 2 }]}
          triage={triage}
          shares={shares}
          following={null}
          weeklyMvp={null}
          nowIso={NOW}
        />
      </div>
    </AfCoreShell>
  )
}
