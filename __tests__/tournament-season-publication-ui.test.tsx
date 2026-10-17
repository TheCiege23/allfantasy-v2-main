import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SeasonRulesPublication } from '@/components/tournament/SeasonRulesPublication'
import { buildSeasonBlueprint, type SavedSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { completeConfig } from './helpers/seasonTournamentFixture'
const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))
const saved = (): SavedSeasonBlueprint => ({ ...buildSeasonBlueprint(completeConfig()), tournamentId: 't1', revision: 'r1', isOwner: true, canEditSettings: true, staff: [] })
const calendar = () => ({ ready: true, digest: 'a'.repeat(64), checkedAt: '2026-10-12T12:00:00Z', regularGames: 1200, pendingGames: 30, excludedGames: [{ gameId: 'gap-1', startsAt: '2026-11-01T23:00:00Z' }], periods: [{ number: 1, games: 45 }], blockers: [], warnings: ['Review exceptions'] })
beforeEach(() => { vi.restoreAllMocks(); nav.refresh.mockReset() })
describe('rules review and publication controls', () => {
  it('requires both exception acknowledgements before publishing the saved revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ calendar: calendar() }))).mockResolvedValueOnce(new Response(JSON.stringify({ publicationId: 'pub1' })))
    render(<SeasonRulesPublication saved={saved()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify saved calendar against games' }))
    const button = await screen.findByRole('button', { name: 'Publish and freeze tournament rules' })
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I accept that the listed gap games will not count'))
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I accept the pending NBA games and the required pre-scoring schedule recheck'))
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({ action: 'blueprint_publish_rules', revision: 'r1', digest: 'a'.repeat(64), acceptExcludedGames: true, acceptPendingGames: true })
  })
  it('allows co-commissioner checks but hides publication controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ calendar: calendar() })))
    render(<SeasonRulesPublication saved={{ ...saved(), isOwner: false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify saved calendar against games' }))
    await screen.findByText('Review exceptions')
    expect(screen.queryByRole('button', { name: 'Publish and freeze tournament rules' })).not.toBeInTheDocument()
  })
  it('shows stale/provider failures and does not publish', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Provider schedule unavailable.' }), { status: 409 }))
    render(<SeasonRulesPublication saved={saved()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify saved calendar against games' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider schedule unavailable.')
    expect(screen.queryByRole('button', { name: 'Publish and freeze tournament rules' })).not.toBeInTheDocument()
  })
  it('shows the frozen version and removes mutation controls', () => {
    const plan = saved()
    plan.publication = { id: 'pub1', hash: 'frozen-hash', sourceRevision: 'r1', calendarDigest: 'a'.repeat(64), publishedAt: '2026-10-12T12:00:00Z', checkedAt: '2026-10-12T11:00:00Z', regularGames: 1200, pendingGames: 30, excludedGames: 1 }
    plan.canEditSettings = false
    render(<SeasonRulesPublication saved={plan} />)
    expect(screen.getByText('Rules published and frozen')).toBeInTheDocument()
    expect(screen.getByText('Rule version: frozen-hash')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
