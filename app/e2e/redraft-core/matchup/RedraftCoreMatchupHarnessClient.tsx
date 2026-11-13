'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import Matchup from '@/components/core-app/screens/Matchup'
import { LiveScores } from '@/components/core-app/screens/LiveScores'
import { coreShellRedraftSport } from '@/lib/core-app/coreShellRedraftIdentity'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { FIXTURE_SPORTS, livePageFixture, matchupFixture, type FixtureSport, type FixtureState } from './fixtures'

type Props = { screen: 'matchup' | 'live'; sport: string; state: FixtureState; leagueType: string; identityOff: boolean; bestBall?: boolean }

/** `?bestBall=1`: the same league scored as best ball, the flag and projection model lib/core-app/matchup.ts sets. */
function bestBallMatchup(d: ReturnType<typeof matchupFixture>): ReturnType<typeof matchupFixture> {
  return {
    ...d,
    league: { ...d.league, bestBall: true },
    projectedFinal: d.projectedFinal.available ? { available: true, data: { ...d.projectedFinal.data, model: 'best_ball_full_roster' } } : d.projectedFinal,
  }
}

/**
 * Harness only (app/e2e is 404 in production). The chrome is the real AfCoreShell — the stamp goes
 * through the real decision (lib/core-app/coreShellRedraftIdentity.ts) — and the body is the real
 * Matchup / LiveScores screen fed fixture data. Network is not needed: the capture script answers the
 * screens' polls itself, so nothing here reaches a database or a provider.
 */
export default function RedraftCoreMatchupHarnessClient(props: Props) {
  const normalized = normalizeToSupportedSport(props.sport)
  const sport: FixtureSport = (FIXTURE_SPORTS as string[]).includes(normalized) ? (normalized as FixtureSport) : 'NFL'
  const league = { id: 'e2e-redraft-core', name: 'Sunday Night Redraft', platform: 'allfantasy', mark: 'SN', sport }
  const other = { id: 'e2e-redraft-core-2', name: 'Office Dynasty', platform: 'sleeper', mark: 'OD', sport: 'NFL' }
  const redraftSport = props.identityOff ? null : coreShellRedraftSport({ platform: 'allfantasy', sport, leagueType: props.leagueType })
  return (
    <AfCoreShell
      active={props.screen === 'live' ? 'live' : 'matchup'}
      leagues={[league, other]}
      selectedLeagueId={league.id}
      nativeLeague
      redraftSport={redraftSport}
      /* The app passes this for a dynasty ?league= on EVERY screen (page.tsx, coreShellDynasty). */
      dynastyEra={props.leagueType === 'dynasty'}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league, other] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="redraft-core-matchup-fixture" data-screen={props.screen} data-sport-fixture={sport}>
        <p className="af-eyebrow" style={{ margin: '0 0 10px' }}>
          Harness fixture · {sport} · fixture data ({redraftSport ?? 'default look'})
        </p>
        {props.screen === 'live' ? (
          <LiveScores data={livePageFixture(sport)} selectedLeagueId={league.id} />
        ) : (
          <Matchup data={props.bestBall ? bestBallMatchup(matchupFixture(sport, props.state)) : matchupFixture(sport, props.state)} />
        )}
      </div>
    </AfCoreShell>
  )
}
