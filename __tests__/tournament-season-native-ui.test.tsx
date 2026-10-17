import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SeasonNativeSetup } from '@/components/tournament/SeasonNativeSetup'
const setup = { freezeId: 'f1', launchReady: false, leagues: [{ key: 'stage-1-league-1', name: 'Opening One', slots: 8, state: 'pending', leagueId: null }] }
beforeEach(() => vi.restoreAllMocks())
it('creates setup from the frozen manifest and reports saved progress', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup }))).mockResolvedValueOnce(new Response(JSON.stringify({ complete: true, completed: 1, total: 1 }))).mockResolvedValueOnce(new Response(JSON.stringify({ setup: { ...setup, leagues: [{ ...setup.leagues[0], state: 'created' }] } })))
  render(<SeasonNativeSetup tournamentId="t1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create or resume opening setup' }))
  expect(await screen.findByRole('status')).toHaveTextContent('1/1 opening leagues created. Draft launch remains blocked.')
  expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ tournamentId: 't1', freezeId: 'f1' })
  expect(await screen.findByRole('button', { name: 'Verify saved setup' })).toBeEnabled()
})
it('shows failures while preserving the resume command', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup }))).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Setup failed. Retry to resume.' }), { status: 500 })).mockResolvedValueOnce(new Response(JSON.stringify({ setup })))
  render(<SeasonNativeSetup tournamentId="t1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Create or resume opening setup' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry to resume.')
  expect(await screen.findByRole('button', { name: 'Create or resume opening setup' })).toBeEnabled()
})

it('shows roster-fit pool checks separately from launch readiness', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup }))).mockResolvedValueOnce(new Response(JSON.stringify({ launchReady: false, reports: [{ key: 'stage-1-league-1', poolReady: true, players: 300, blockers: [] }], remaining: ['Live scoring still needs verification.'] })))
  render(<SeasonNativeSetup tournamentId="t1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Check draft player pools' }))
  expect(await screen.findByRole('heading', { name: 'Draft readiness · launch blocked' })).toBeInTheDocument()
  expect(screen.getByText('Live scoring still needs verification.')).toBeInTheDocument()
  expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ action: 'check_draft', tournamentId: 't1', freezeId: 'f1' })
})


it('checks created leagues one per request and shows retry recovery details', async () => {
  const created = { ...setup, leagues: [1, 2].map(n => ({ key: 'pool-' + n, name: 'Pool ' + n, slots: 8, state: 'created', leagueId: 'league-' + n })) }
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup: created })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ launchReady: false, reports: [{ key: 'pool-1', poolReady: true, players: 300, blockers: [] }], remaining: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ launchReady: false, reports: [{ key: 'pool-2', poolReady: false, players: 0, blockers: ['Catalog unavailable.'], retryAt: '2026-10-12T12:00:30Z' }], remaining: [] })))
  render(<SeasonNativeSetup tournamentId="t1" />)
  await screen.findByRole('button', { name: 'Verify saved setup' })
  fireEvent.click(screen.getByRole('button', { name: 'Check draft player pools' }))
  expect(await screen.findByText('Catalog unavailable.')).toBeInTheDocument()
  expect(screen.getByText(/Retry after/)).toBeInTheDocument()
  expect(fetchMock.mock.calls.slice(1).map(call => JSON.parse(call[1]!.body as string).key)).toEqual(['pool-1', 'pool-2'])
})

it('explains NBA provider evidence gaps in the commissioner hub without claiming launch readiness', async () => {
  const scoringSource = { sport: 'NBA', source: 'Rolling Insights NBA box', boxContractReady: false, launchReady: false, measured: ['points'], derived: ['double_double'], missing: ['technical_foul', 'flagrant_foul'], blockers: ['Player-level foul evidence is not certified.'] }
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup: { ...setup, scoringSource } })))
  render(<SeasonNativeSetup tournamentId="t1" />)
  expect(await screen.findByRole('heading', { name: 'Scoring feed readiness · launch blocked' })).toBeInTheDocument()
  expect(screen.getByText(/technical foul, flagrant foul/)).toBeInTheDocument()
  expect(screen.getByText('Player-level foul evidence is not certified.')).toBeInTheDocument()
})

it('shows schedule drift as a read-only commissioner review', async () => {
  const report = { scheduleMatches: false, requiresReview: true, actualStartVerified: false, launchReady: false, checkedAt: '2026-10-13T12:00:00Z', pendingGames: 0, coverageBlockers: [], changes: [{ gameId: 'g1', kind: 'postponed', publishedStartsAt: '2026-10-21T00:00:00Z', publishedPeriod: 1, currentScheduledAt: '2026-10-29T00:00:00Z', currentScheduledPeriod: 2, replacedBy: null }], reconciliation: [{ gameId: 'g1', steps: ['Review lineup-lock eligibility before any period transfer.'] }] }
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup }))).mockResolvedValueOnce(new Response(JSON.stringify(report)))
  render(<SeasonNativeSetup tournamentId="t1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Check current schedule' }))
  expect(await screen.findByText('Game g1: Postponed')).toBeInTheDocument()
  expect(screen.getByText(/1 schedule change needs review/)).toBeInTheDocument()
  expect(screen.getByText(/Scheduled times are not proof of actual start/)).toBeInTheDocument()
  expect(screen.getByText('Review lineup-lock eligibility before any period transfer.')).toBeInTheDocument()
  expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ action: 'review_schedule', tournamentId: 't1', freezeId: 'f1' })
})

it('samples a published game live without claiming exact tipoff or unlocking scoring', async () => {
  const result = { gameId: 'g1', status: 'in_progress', observedAt: '2026-10-21T00:03:00Z', verifiedWindow: true, startAfter: '2026-10-20T23:59:00Z', startedBy: '2026-10-21T00:03:00Z', exactStartVerified: false, lineupLockCertified: false, launchReady: false, impact: { lockedLeagues: 2, scoreRevisions: 1, finalizedWeeks: 0, receiptReviewRequired: true } }
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup }))).mockResolvedValueOnce(new Response(JSON.stringify(result)))
  render(<SeasonNativeSetup tournamentId="t1" />)
  fireEvent.change(await screen.findByLabelText('Published game ID'), { target: { value: 'g1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sample live status' }))
  expect(await screen.findByText(/Start observed after/)).toBeInTheDocument()
  expect(screen.getByText('Exact start and lineup lock remain unverified. Scoring stays blocked.')).toBeInTheDocument()
  expect(screen.getByText(/2 leagues with lineups · 1 score revisions/)).toBeInTheDocument()
  expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ action: 'observe_start', tournamentId: 't1', freezeId: 'f1', gameId: 'g1' })
})
it('shows whole-period feed gaps without exposing player boxes or unlocking scoring', async () => {
  const withPeriods = { ...setup, scoringPeriods: [1, 2] }
  const result = { period: 1, observedAt: '2026-10-13T12:00:00Z', expectedGames: 3, fetchedGames: 2, finalGames: 1,
    missingGameIds: ['g2'], futureGameIds: ['g3'], unknownGameIds: [], allGameRowsFinal: false,
    exactStartVerified: false, playerCoverageVerified: false, scoringCertified: false, launchReady: false,
    boxAudit: { measuredSport: true, gamesWithPlayerBoxes: 1, providerPlayerRows: 20, missingBoxGameIds: [], malformedBoxGameIds: [], duplicatePlayerGameIds: [], invalidWeightedBoxGameIds: [], unscorableWeightedStats: ['technical_foul'], draftedPlayerCoverageVerified: false } }
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup: withPeriods }))).mockResolvedValueOnce(new Response(JSON.stringify(result)))
  render(<SeasonNativeSetup tournamentId="t1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Check whole-period feed' }))
  expect(await screen.findByText(/2 of 3 published game rows found/)).toBeInTheDocument()
  expect(screen.getByText(/Missing game IDs: g2/)).toBeInTheDocument()
  expect(screen.getByText(/NBA box preflight: 1 game boxes, 20 provider player rows/)).toBeInTheDocument()
  expect(screen.getByText(/Unscorable frozen stats: technical_foul/)).toBeInTheDocument()
  expect(screen.getByText(/Exact starts, player coverage and scoring remain unverified/)).toBeInTheDocument()
  expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ action: 'refresh_period', tournamentId: 't1', freezeId: 'f1', period: 1 })
})
it('checks one created opening league and labels absent final players unresolved', async () => {
  const created = { ...setup, scoringPeriods: [1], leagues: [{ ...setup.leagues[0], state: 'created', leagueId: 'league-1' }] }
  const result = { period: 1, observedAt: '2026-10-13T12:00:00Z', expectedGames: 1, fetchedGames: 1, finalGames: 1,
    missingGameIds: [], futureGameIds: [], unknownGameIds: [], allGameRowsFinal: true, exactStartVerified: false, playerCoverageVerified: false,
    boxAudit: { measuredSport: true, gamesWithPlayerBoxes: 1, providerPlayerRows: 2, missingBoxGameIds: [], malformedBoxGameIds: [], duplicatePlayerGameIds: [], invalidWeightedBoxGameIds: [], unscorableWeightedStats: [], draftedPlayerCoverageVerified: false },
    lockedCoverage: { leagueKey: 'stage-1-league-1', leagueName: 'Opening One', lockedGames: 1, lockedPlayerGamePairs: 2, matchedPairs: 1, unresolvedIdentityPairs: 0, missingGamePairs: 0, unverifiedBoxPairs: 0, absentFinalPlayerPairs: 1, pendingPlayerPairs: 0, scheduledFuturePlayerPairs: 0, scoringCertified: false, publishedGames: 2, publishedGamesPending: 0, publishedGameRowsMissing: 1, publishedGamesWithoutLockedReceipt: 1, lockedGamesOutsidePublication: 0, draftedPlayers: 3, draftedPlayersWithoutLockedGame: 1, explicitDnpOutcomes: 0, completeGameAndPlayerCoverageVerified: false },
    outcomeEvidence: { revisions: 2, correctedSubjects: 1, candidateDnp: 0, candidateNoGame: 1, candidateNoDraftedPlayers: 0, contractVerified: false, scoringCertified: false } }
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ setup: created }))).mockResolvedValueOnce(new Response(JSON.stringify(result)))
  render(<SeasonNativeSetup tournamentId="t1" />)
  fireEvent.change(await screen.findByLabelText('Opening league'), { target: { value: 'stage-1-league-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check whole-period feed' }))
  expect(await screen.findByText(/1 absent from final boxes/)).toBeInTheDocument()
  expect(screen.getByText(/Missing players and DNPs are unresolved, never zero scores/)).toBeInTheDocument()
  expect(screen.getByText(/1 of 3 drafted players have no locked game or verified no-game outcome/)).toBeInTheDocument()
  expect(screen.getByText(/1 no-game, 0 no-drafted-player claims across 2 saved revisions/)).toBeInTheDocument()
  expect(screen.getByText(/these claims do not close coverage or score points/)).toBeInTheDocument()
  expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ action: 'refresh_period', tournamentId: 't1', freezeId: 'f1', period: 1, key: 'stage-1-league-1' })
})
