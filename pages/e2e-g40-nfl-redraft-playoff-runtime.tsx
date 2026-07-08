import { useEffect, useState } from 'react'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'

const rules = {
  general: { sport: 'NFL', season: 2026, teamCount: 8 },
  playoffs: {
    teamCount: 6,
    startWeek: 15,
    firstRoundByes: 2,
    consolationBracketEnabled: true,
    thirdPlaceGameEnabled: false,
    seedingRules: 'division_winners_then_standings',
    tiebreakerRules: ['win_pct', 'wins', 'division_record', 'points_for', 'points_against'],
    byeRules: 'top_seed_byes',
    reseedBehavior: 'reseed_after_each_round',
    standingsTiebreakers: ['win_pct', 'wins', 'division_record', 'points_for', 'points_against'],
  },
  schedule: { regularSeasonLength: 14, playoffTransitionPoint: 15 },
}

const teams: NflRedraftPlayoffTeamInput[] = [
  { rosterId: 'alpha', displayName: 'Alpha', ownerId: 'u-alpha', divisionId: 'east', wins: 11, losses: 3, pointsFor: 1540, pointsAgainst: 1280, divisionWins: 5, divisionLosses: 1 },
  { rosterId: 'bravo', displayName: 'Bravo', ownerId: 'u-bravo', divisionId: 'east', wins: 10, losses: 4, pointsFor: 1502, pointsAgainst: 1301, divisionWins: 4, divisionLosses: 2 },
  { rosterId: 'charlie', displayName: 'Charlie', ownerId: 'u-charlie', divisionId: 'west', wins: 9, losses: 5, pointsFor: 1488, pointsAgainst: 1320, divisionWins: 5, divisionLosses: 1 },
  { rosterId: 'delta', displayName: 'Delta', ownerId: 'u-delta', divisionId: 'west', wins: 9, losses: 5, pointsFor: 1440, pointsAgainst: 1350, divisionWins: 3, divisionLosses: 3 },
  { rosterId: 'echo', displayName: 'Echo', ownerId: 'u-echo', divisionId: 'east', wins: 8, losses: 6, pointsFor: 1398, pointsAgainst: 1375, divisionWins: 3, divisionLosses: 3 },
  { rosterId: 'foxtrot', displayName: 'Foxtrot', ownerId: 'u-foxtrot', divisionId: 'west', wins: 8, losses: 6, pointsFor: 1370, pointsAgainst: 1388, divisionWins: 2, divisionLosses: 4 },
  { rosterId: 'golf', displayName: 'Golf', ownerId: 'u-golf', divisionId: 'east', wins: 7, losses: 7, pointsFor: 1330, pointsAgainst: 1390, divisionWins: 2, divisionLosses: 4 },
  { rosterId: 'hotel', displayName: 'Hotel', ownerId: 'u-hotel', divisionId: 'west', wins: 6, losses: 8, pointsFor: 1290, pointsAgainst: 1410, divisionWins: 1, divisionLosses: 5 },
]

function buildState() {
  return buildNflRedraftPlayoffRuntimeState({
    leagueId: 'g40-browser-league',
    seasonId: 'g40-browser-season',
    season: 2026,
    week: 15,
    rules,
    teams,
    now: new Date('2026-07-02T12:00:00.000Z'),
  })
}

function scoreActiveRound(state: NflRedraftPlayoffRuntimeState, baseScore: number): NflRedraftPlayoffRuntimeState {
  return {
    ...state,
    bracket: {
      ...state.bracket,
      rounds: state.bracket.rounds.map((round) =>
        round.status === 'active'
          ? {
              ...round,
              matchups: round.matchups.map((matchup, index) =>
                matchup.bye
                  ? matchup
                  : {
                      ...matchup,
                      homeScore: baseScore + index,
                      awayScore: baseScore - 8 - index,
                      status: 'final',
                    },
              ),
            }
          : round,
      ),
    },
  }
}

const pageStyle = {
  minHeight: '100vh',
  background: '#07111c',
  color: 'white',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  padding: '24px 16px',
} as const

const cardStyle = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 14,
  background: 'rgba(255,255,255,0.04)',
  padding: 16,
} as const

export default function G40PlayoffRuntimeHarnessPage() {
  const [state, setState] = useState(buildState)
  const [message, setMessage] = useState('Ready')
  const [events, setEvents] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [scoreBase, setScoreBase] = useState(120)

  useEffect(() => {
    setHydrated(true)
  }, [])

  function generateBracket() {
    const generated = generateNflRedraftPlayoffBracket({ state, actorUserId: 'commissioner', lockBracket: true })
    setState({ ...state, bracket: generated.bracket })
    setEvents((prev) => [...generated.events.map((event) => event.type), ...prev])
    setMessage('Bracket generated and locked')
  }

  function advanceRound() {
    const scored = scoreActiveRound(state, scoreBase)
    const result = advanceNflRedraftPlayoffRound({ state: scored, actorUserId: 'commissioner' })
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setScoreBase((current) => current + 10)
    setState(result.state)
    setEvents((prev) => [...result.events.map((event) => event.type), ...prev])
    setMessage(result.status === 'championship_ready' ? 'Championship ready to finalize' : 'Round advanced')
  }

  function finalizeSeason() {
    const result = finalizeNflRedraftPlayoffChampion({ state, actorUserId: 'commissioner' })
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setState(result.state)
    setEvents((prev) => [...result.events.map((event) => event.type), ...prev])
    setMessage('Champion crowned')
  }

  const champion = state.teams.find((team) => team.rosterId === state.bracket.championRosterId)

  return (
    <main style={pageStyle} data-testid="g40-playoff-harness" data-hydrated={hydrated ? 'true' : 'false'}>
      <section style={{ margin: '0 auto', maxWidth: 1080 }}>
        <p style={{ color: 'rgba(165,243,252,0.74)', fontSize: 12, letterSpacing: 2.4, textTransform: 'uppercase' }}>
          NFL Redraft Runtime Proof
        </p>
        <h1 style={{ fontSize: 28, margin: '8px 0 18px' }}>Playoff Runtime</h1>

        <div data-testid="playoff-runtime-summary" style={{ ...cardStyle, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <Metric label="Teams" value={state.settings.playoffTeamCount} />
          <Metric label="Rounds" value={state.settings.roundCount} />
          <Metric label="Byes" value={state.settings.firstRoundByes} />
          <Metric label="Status" value={state.bracket.status} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' }}>
          <button type="button" data-testid="generate-playoff-bracket" onClick={generateBracket} style={buttonStyle('#22d3ee', '#06121a')}>
            Generate bracket
          </button>
          <button type="button" data-testid="advance-playoff-round" onClick={advanceRound} style={buttonStyle('#34d399', '#06120c')}>
            Advance round
          </button>
          <button type="button" data-testid="finalize-playoff-season" onClick={finalizeSeason} style={outlineButtonStyle('#fde68a')}>
            Finalize season
          </button>
        </div>

        <p style={{ ...cardStyle, color: 'rgba(255,255,255,0.78)' }} data-testid="playoff-message">
          {message}
        </p>

        {champion ? (
          <div style={{ ...cardStyle, borderColor: 'rgba(252,211,77,0.32)', marginTop: 12 }} data-testid="champion-banner">
            <strong>Champion crowned:</strong> {champion.displayName}
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginTop: 12 }}>
          <div style={cardStyle} data-testid="playoff-seeds">
            <p style={{ margin: 0, fontWeight: 800 }}>Seeds</p>
            <ol style={{ color: 'rgba(255,255,255,0.78)', fontSize: 14, margin: '10px 0 0', paddingLeft: 22 }}>
              {state.seeds.map((seed) => (
                <li key={seed.rosterId}>
                  {seed.displayName} ({seed.qualifiedBy})
                </li>
              ))}
            </ol>
          </div>

          <div style={cardStyle} data-testid="playoff-bracket">
            <p style={{ margin: 0, fontWeight: 800 }}>Bracket</p>
            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              {state.bracket.rounds.length ? (
                state.bracket.rounds.map((round) => (
                  <div key={round.roundId} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 10 }}>
                    <p style={{ margin: 0, fontWeight: 700 }}>
                      {round.roundName} - {round.status}
                    </p>
                    {round.matchups.map((matchup) => (
                      <p key={matchup.matchupId} style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13, margin: '6px 0 0' }}>
                        {teamName(state, matchup.homeRosterId)} vs {teamName(state, matchup.awayRosterId)}
                      </p>
                    ))}
                  </div>
                ))
              ) : (
                <span>No bracket generated yet</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, marginTop: 12 }} data-testid="final-standings">
          <p style={{ margin: 0, fontWeight: 800 }}>Final Standings</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
            {state.bracket.finalStandings.length
              ? state.bracket.finalStandings.map((row) => (
                  <span key={row.rosterId} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '4px 8px' }}>
                    {row.finish}. {row.displayName}
                  </span>
                ))
              : 'Not finalized'}
          </div>
        </div>

        <div style={{ ...cardStyle, marginTop: 12 }} data-testid="playoff-events">
          <p style={{ margin: 0, fontWeight: 800 }}>Runtime Events</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
            {events.length
              ? events.map((event, index) => (
                  <span key={`${event}-${index}`} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '4px 8px' }}>
                    {event}
                  </span>
                ))
              : 'No events yet'}
          </div>
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p style={{ margin: 0, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>{value}</p>
    </div>
  )
}

function teamName(state: NflRedraftPlayoffRuntimeState, rosterId: string | null) {
  if (!rosterId) return 'TBD'
  return state.teams.find((team) => team.rosterId === rosterId)?.displayName ?? rosterId
}

function buttonStyle(background: string, color: string) {
  return {
    background,
    border: 0,
    borderRadius: 10,
    color,
    cursor: 'pointer',
    fontWeight: 800,
    padding: '10px 12px',
  } as const
}

function outlineButtonStyle(color: string) {
  return {
    background: 'transparent',
    border: `1px solid ${color}`,
    borderRadius: 10,
    color,
    cursor: 'pointer',
    fontWeight: 800,
    padding: '10px 12px',
  } as const
}
