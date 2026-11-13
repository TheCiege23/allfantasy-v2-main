'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'
import type { PlayerShares, ShareRow } from '@/lib/core-app/playerShares'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { sportPlayerKey } from '@/lib/core-app/sportRosterKey'

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE (same guard as app/e2e/redraft-core/b5): every same-origin `/api/` call
 * answers 503, so each widget renders its own "could not load" state and nothing reaches a database.
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

/** SAMPLE DATA — the shape the loaders return for a multi-sport account; no row is read from a database. */
type P = { sport: string; source: string; id: string; name: string; pos: string; team: string }
const PLAYERS: P[] = [
  { sport: 'NFL', source: 'rolling_insights', id: '6794', name: 'J.J. McCarthy', pos: 'QB', team: 'MIN' },
  { sport: 'NFL', source: 'rolling_insights', id: '4881', name: 'Hunter Henry', pos: 'TE', team: 'NE' },
  { sport: 'NBA', source: 'rolling_insights', id: '9001', name: 'Anthony Davis', pos: 'F', team: 'DAL' },
  { sport: 'NBA', source: 'rolling_insights', id: '9003', name: "A'ja Wilson", pos: 'F', team: 'LV' },
  { sport: 'NHL', source: 'rolling_insights', id: '9201', name: 'Adrian Kempe', pos: 'RW', team: 'LA' },
  { sport: 'NCAAF', source: 'cfbd', id: 'c-55', name: 'Anthony Evans III', pos: 'WR', team: 'MSST' },
  { sport: 'NCAAB', source: 'rolling_insights', id: '9301', name: 'Aleks Alston', pos: 'F', team: 'UCF' },
]
const LEAGUES: Record<string, Array<{ leagueId: string; leagueName: string; platform: string }>> = {
  NFL: [{ leagueId: 'nfl-1', leagueName: 'Fathers Day-Dads Dynasty', platform: 'sleeper' }, { leagueId: 'nfl-2', leagueName: 'World Football League', platform: 'sleeper' }],
  NBA: [{ leagueId: 'nba-1', leagueName: "A' Ja Wilson is the GOAT", platform: 'fantrax' }, { leagueId: 'nba-2', leagueName: 'Late Start League 10', platform: 'fantrax' }],
  NHL: [{ leagueId: 'nhl-1', leagueName: 'Top Shelf Cartel', platform: 'fantrax' }],
  NCAAF: [{ leagueId: 'cfb-1', leagueName: 'Cream Bowl', platform: 'fantrax' }],
  NCAAB: [{ leagueId: 'cbb-1', leagueName: 'NCAA-FB', platform: 'fantrax' }],
}
const STATUS: Record<string, { label: string; tone: 'bad' | 'warn' }> = {
  'J.J. McCarthy': { label: 'Questionable', tone: 'warn' },
  'Anthony Davis': { label: 'Out', tone: 'bad' },
  'Adrian Kempe': { label: 'Day-to-day', tone: 'warn' },
  'Anthony Evans III': { label: 'Questionable', tone: 'warn' },
}

const keyOf = (p: P) => (p.sport === 'NFL' ? p.id : sportPlayerKey(p.sport, p.source, p.id))
const playerOf = (p: P) => ({ sport: p.sport, externalId: p.id, source: p.source, sleeperId: keyOf(p), name: p.name, position: p.pos, team: p.team, imageUrl: null })

function triageFor(sport: string | null, nowIso: string): SectionState<GameDayTriage> {
  const rows: TriageRow[] = PLAYERS.filter((p) => STATUS[p.name] && (!sport || p.sport === sport)).map((p) => ({
    player: playerOf(p),
    status: STATUS[p.name]!,
    description: STATUS[p.name]!.label === 'Out' ? 'Foot' : 'Lower body',
    reportedAt: new Date(Date.parse(nowIso) - 6 * 3600_000).toISOString(),
    leagues: (LEAGUES[p.sport] ?? []).slice(0, 1).map((l) => ({ ...l, platformLeagueId: null, season: 2026, teamId: null })),
    kickoff: p.sport === 'NFL' ? new Date(Date.parse(nowIso) + 22 * 3600_000).toISOString() : null,
    noGame: false,
    inactive: null,
    bye: false,
  }))
  const leagues = sport ? (LEAGUES[sport] ?? []).length : Object.values(LEAGUES).flat().length
  return {
    available: true,
    data: { rows, week: { season: 2026, week: 10 }, leaguesRead: leagues, startersRead: rows.length * 6, unidentifiedStarters: sport === 'NCAAB' || !sport ? 2 : 0, rostersAsOf: nowIso, rosterAges: [], skipped: [] },
  }
}

function sharesFor(sport: string | null): SectionState<PlayerShares> {
  const rows: ShareRow[] = PLAYERS.filter((p) => !sport || p.sport === sport).map((p, i) => ({
    player: playerOf(p),
    leagues: Math.max(1, (LEAGUES[p.sport] ?? []).length - (i % 2)),
    starts: 1,
    ir: 0,
    leagueIds: (LEAGUES[p.sport] ?? []).map((l) => l.leagueId),
    status: STATUS[p.name] ?? null,
    description: null,
  }))
  const leaguesRead = sport ? (LEAGUES[sport] ?? []).length : Object.values(LEAGUES).flat().length
  return { available: true, data: { rows, leaguesRead, playersHeld: rows.length * 9, unsupportedLeagues: 0, unidentifiedPlayers: sport === 'NCAAB' || !sport ? 8 : 0, teamSplit: null } }
}

export default function PlayerFinderSportsHarnessClient({ sport }: { sport: string | null }) {
  const nowIso = '2026-11-11T21:41:00.000Z'
  const homeSports = Object.entries(LEAGUES).map(([s, ls]) => ({ sport: s, leagues: ls.length }))
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
      <div data-testid="player-finder-sports-fixture" data-sport={sport ?? 'ALL'}>
        <PlayerFinder
          query=""
          sport={sport as never}
          matches={[]}
          detail={null}
          leagueCount={sport ? (LEAGUES[sport] ?? []).length : Object.values(LEAGUES).flat().length}
          signedIn
          homeSports={homeSports}
          triage={triageFor(sport, nowIso)}
          shares={sharesFor(sport)}
          following={null}
          weeklyMvp={null}
          nowIso={nowIso}
        />
      </div>
    </AfCoreShell>
  )
}
