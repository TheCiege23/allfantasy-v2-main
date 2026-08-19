/**
 * Regression lock for the NFL redraft Playoffs UI wiring gap: the nflRedraftCore
 * Standings tab rendered only a "coming soon" placeholder — there was no reachable
 * UI to generate a bracket, advance rounds, or finalize a champion (the engine +
 * `/api/redraft/playoffs/*` routes worked, but nothing in the shell called them).
 *
 * These prove the Standings tab now renders REAL standings + the playoff runtime
 * bracket, with commissioner-only, runtime-contextual Generate / Advance / Finalize
 * controls — and that no bracket is fabricated when the API returns no playoff data.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RedraftPlayoffRuntimeClient } from '@/lib/redraft/client'
import { RedraftStandingsPlayoffsView } from '@/app/league/[leagueId]/tabs/redraft/RedraftStandingsPlayoffsView'
import { StandingsView } from '@/app/league/[leagueId]/tabs/redraft/StandingsView'
import * as client from '@/lib/redraft/client'

vi.mock('@/lib/redraft/client', () => ({
  fetchRedraftSeason: vi.fn(),
  fetchRedraftStandings: vi.fn(),
  fetchRedraftPlayoffRuntime: vi.fn(),
  finalizeRedraftSeason: vi.fn(),
  generatePlayoffs: vi.fn(),
  advancePlayoffRound: vi.fn(),
}))

const mocked = vi.mocked(client)

const STANDINGS = [
  { id: 'a', teamName: 'Alpha', wins: 5, losses: 1, pointsFor: 800, pointsAgainst: 600 },
  { id: 'b', teamName: 'Bravo', wins: 4, losses: 2, pointsFor: 750, pointsAgainst: 620 },
]

function buildRuntime(bracket: {
  generated?: boolean
  status?: string
  championRosterId?: string | null
  rounds?: unknown[]
}): RedraftPlayoffRuntimeClient {
  return {
    settings: { playoffTeamCount: 4, roundCount: 2, playoffStartWeek: 15, firstRoundByes: 0 },
    seeds: [
      { rosterId: 'a', seed: 1, displayName: 'Alpha' },
      { rosterId: 'b', seed: 2, displayName: 'Bravo' },
    ],
    teams: [
      { rosterId: 'a', displayName: 'Alpha' },
      { rosterId: 'b', displayName: 'Bravo' },
    ],
    bracket: {
      generated: bracket.generated ?? false,
      status: bracket.status ?? 'not_generated',
      locked: false,
      championRosterId: bracket.championRosterId ?? null,
      finalStandings: [],
      rounds: bracket.rounds ?? [],
    },
  } as unknown as RedraftPlayoffRuntimeClient
}

const matchup = (winnerRosterId: string | null, status: string) => ({
  matchupId: 'm1', homeRosterId: 'a', awayRosterId: 'b', homeSeed: 1, awaySeed: 2, winnerRosterId, bye: false, status,
})
const noBracket = buildRuntime({})
const activeResolved = buildRuntime({ generated: true, status: 'active', rounds: [{ roundId: 'r1', roundName: 'Semifinal', status: 'active', matchups: [matchup('a', 'final')] }] })
const activeUnresolved = buildRuntime({ generated: true, status: 'active', rounds: [{ roundId: 'r1', roundName: 'Semifinal', status: 'active', matchups: [matchup(null, 'scheduled')] }] })
const allRoundsDone = buildRuntime({ generated: true, status: 'active', rounds: [{ roundId: 'r1', roundName: 'Championship', status: 'completed', matchups: [matchup('a', 'final')] }] })

beforeEach(() => {
  vi.clearAllMocks()
  mocked.fetchRedraftSeason.mockResolvedValue({ id: 's1', leagueId: 'L', sport: 'NFL', season: 2026, currentWeek: 15, status: 'active', rosters: [] } as never)
  mocked.fetchRedraftStandings.mockResolvedValue(STANDINGS as never)
  mocked.fetchRedraftPlayoffRuntime.mockResolvedValue(noBracket)
})

describe('nflRedraftCore Standings tab — real standings + playoffs (not a placeholder)', () => {
  it('renders real standings (not the "coming soon" placeholder) when a redraft season exists', async () => {
    render(<RedraftStandingsPlayoffsView leagueId="L" isCommissioner={false} />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })

  it('shows an honest empty state (no mock bracket/standings) when there is no redraft season', async () => {
    mocked.fetchRedraftSeason.mockResolvedValue(null)
    render(<RedraftStandingsPlayoffsView leagueId="L" isCommissioner />)
    expect(await screen.findByTestId('redraft-standings-no-season')).toBeInTheDocument()
    expect(mocked.fetchRedraftStandings).not.toHaveBeenCalled()
    expect(screen.queryByTestId('redraft-playoff-bracket')).not.toBeInTheDocument()
  })
})

describe('StandingsView — commissioner playoff controls (contextual + gated)', () => {
  it('commissioner sees Generate Bracket when no bracket exists', async () => {
    mocked.fetchRedraftPlayoffRuntime.mockResolvedValue(noBracket)
    render(<StandingsView rows={STANDINGS} seasonId="s1" isCommissioner />)
    expect(await screen.findByTestId('redraft-generate-bracket')).toBeInTheDocument()
    expect(screen.queryByTestId('redraft-advance-round')).not.toBeInTheDocument()
  })

  it('commissioner sees an ENABLED Advance Round when the active round is resolved', async () => {
    mocked.fetchRedraftPlayoffRuntime.mockResolvedValue(activeResolved)
    render(<StandingsView rows={STANDINGS} seasonId="s1" isCommissioner />)
    expect(await screen.findByTestId('redraft-advance-round')).toBeEnabled()
    expect(screen.queryByTestId('redraft-generate-bracket')).not.toBeInTheDocument()
  })

  it('Advance Round is shown but DISABLED when the active round is unresolved (no fabricated winners)', async () => {
    mocked.fetchRedraftPlayoffRuntime.mockResolvedValue(activeUnresolved)
    render(<StandingsView rows={STANDINGS} seasonId="s1" isCommissioner />)
    expect(await screen.findByTestId('redraft-advance-round')).toBeDisabled()
  })

  it('Finalize Season does NOT show while a round is still active', async () => {
    mocked.fetchRedraftPlayoffRuntime.mockResolvedValue(activeResolved)
    render(<StandingsView rows={STANDINGS} seasonId="s1" isCommissioner />)
    await screen.findByTestId('redraft-advance-round')
    expect(screen.queryByTestId('redraft-finalize-season')).not.toBeInTheDocument()
  })

  it('Finalize Season shows once all rounds are complete', async () => {
    mocked.fetchRedraftPlayoffRuntime.mockResolvedValue(allRoundsDone)
    render(<StandingsView rows={STANDINGS} seasonId="s1" isCommissioner />)
    expect(await screen.findByTestId('redraft-finalize-season')).toBeInTheDocument()
    expect(screen.queryByTestId('redraft-advance-round')).not.toBeInTheDocument()
  })

  it('non-commissioner cannot see any commissioner control, but still sees the bracket', async () => {
    mocked.fetchRedraftPlayoffRuntime.mockResolvedValue(activeResolved)
    render(<StandingsView rows={STANDINGS} seasonId="s1" isCommissioner={false} />)
    expect(await screen.findByTestId('redraft-playoff-bracket')).toBeInTheDocument()
    expect(screen.queryByTestId('redraft-playoff-commissioner-controls')).not.toBeInTheDocument()
    expect(screen.queryByTestId('redraft-generate-bracket')).not.toBeInTheDocument()
    expect(screen.queryByTestId('redraft-advance-round')).not.toBeInTheDocument()
    expect(screen.queryByTestId('redraft-finalize-season')).not.toBeInTheDocument()
  })

  it('does not fabricate a bracket when the playoff runtime API returns no data', async () => {
    mocked.fetchRedraftPlayoffRuntime.mockResolvedValue(null)
    render(<StandingsView rows={STANDINGS} seasonId="s1" isCommissioner />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByTestId('redraft-playoff-bracket')).not.toBeInTheDocument()
    expect(screen.queryByTestId('redraft-playoff-seeds')).not.toBeInTheDocument()
  })
})
