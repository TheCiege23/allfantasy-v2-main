import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { SeasonTournamentPlanner } from '@/components/tournament/SeasonTournamentPlanner'
import { buildSeasonBlueprint, defaultSeasonBlueprint, type SavedSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))
const savedPlan = (overrides: Partial<SavedSeasonBlueprint> = {}): SavedSeasonBlueprint => ({
  ...buildSeasonBlueprint({ ...defaultSeasonBlueprint(), name: 'NBA Cup' }),
  tournamentId: 'saved', revision: 'rev-1', isOwner: true, canEditSettings: true, staff: [], ...overrides,
})
beforeEach(() => { vi.restoreAllMocks(); nav.push.mockReset(); nav.refresh.mockReset() })
describe('tournament planner interface', () => {
  it('previews three stages and enables saving only after valid settings', () => {
    render(<SeasonTournamentPlanner />)
    expect(screen.getByRole('button', { name: 'Save tournament plan' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Tournament name'), { target: { value: 'NBA Cup' } })
    expect(screen.getByText('Opening qualifier')).toBeInTheDocument()
    expect(screen.getByText('Championship bracket')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save tournament plan' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Participants'), { target: { value: '66' } })
    expect(screen.getByRole('button', { name: 'Save tournament plan' })).toBeDisabled()
  })
  it('does not ignore league names typed before saving', () => {
    render(<SeasonTournamentPlanner />)
    fireEvent.change(screen.getByLabelText('Tournament name'), { target: { value: 'NBA Cup' } })
    fireEvent.change(screen.getByLabelText('Opening league names, one per line (optional)'), { target: { value: 'One' } })
    expect(screen.getByRole('button', { name: 'Save tournament plan' })).toBeDisabled()
  })
  it('saves a valid plan and opens its hub', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ tournamentId: 'saved' }), { status: 201 }))
    render(<SeasonTournamentPlanner />)
    fireEvent.change(screen.getByLabelText('Tournament name'), { target: { value: 'NBA Cup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save tournament plan' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/tournament-hub/saved'))
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).config.name).toBe('NBA Cup')
  })
  it('keeps reviewers read-only without staff controls', () => {
    render(<SeasonTournamentPlanner saved={savedPlan({ isOwner: false, canEditSettings: false })} />)
    expect(screen.getByLabelText('Tournament name')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Edit tournament rules' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add staff member' })).not.toBeInTheDocument()
  })
  it('allows editing by an authorized co-commissioner without staff delegation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ tournamentId: 'saved', revision: 'rev-2' }), { status: 200 }))
    render(<SeasonTournamentPlanner saved={savedPlan({ isOwner: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tournament rules' }))
    fireEvent.change(screen.getByLabelText('Tournament name'), { target: { value: 'New Rules' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule changes' }))
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body).toMatchObject({ action: 'blueprint_update', tournamentId: 'saved', revision: 'rev-1', config: { name: 'New Rules' } })
    expect(screen.queryByRole('button', { name: 'Add staff member' })).not.toBeInTheDocument()
  })
  it('keeps unsaved rules after a conflict until explicit reload or cancellation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Someone saved newer rules.' }), { status: 409 }))
    render(<SeasonTournamentPlanner saved={savedPlan()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tournament rules' }))
    fireEvent.change(screen.getByLabelText('Tournament name'), { target: { value: 'My Unsaved Changes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule changes' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Tournament name')).toHaveValue('My Unsaved Changes')
    expect(nav.refresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest plan' }))
    expect(nav.refresh).toHaveBeenCalledOnce()
  })
  it('cancels edits and restores saved multiline names', () => {
    const saved = savedPlan()
    saved.config.divisions = ['East', 'West']
    render(<SeasonTournamentPlanner saved={saved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tournament rules' }))
    fireEvent.change(screen.getByLabelText('Division names, one per line (optional)'), { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }))
    expect(screen.getByLabelText('Division names, one per line (optional)')).toHaveValue('East\nWest')
    expect(screen.getByLabelText('Tournament name')).toBeDisabled()
  })
  it('lets the owner add an editing co-commissioner', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    render(<SeasonTournamentPlanner saved={savedPlan()} />)
    fireEvent.change(screen.getByLabelText('AllFantasy username'), { target: { value: 'Helper' } })
    fireEvent.change(screen.getByLabelText('New staff access'), { target: { value: 'co_commissioner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }))
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ action: 'blueprint_add_staff', tournamentId: 'saved', username: 'Helper', role: 'co_commissioner' })
  })
  it('lists staff with controls to remove only the selected member', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    render(<SeasonTournamentPlanner saved={savedPlan({ staff: [{ userId: 'helper-id', username: 'Helper', displayName: 'Helper Person', role: 'co_commissioner' }] })} />)
    expect(screen.getByLabelText('Access for Helper Person')).toHaveValue('co_commissioner')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Helper Person' }))
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ action: 'blueprint_remove_staff', tournamentId: 'saved', assigneeId: 'helper-id' })
  })
})


describe('playing rules in the commissioner planner', () => {
  it('saves the scoring and calendar contract with the existing plan request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ tournamentId: 'saved' }), { status: 201 }))
    render(<SeasonTournamentPlanner />)
    fireEvent.change(screen.getByLabelText('Tournament name'), { target: { value: 'NBA Cup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add playing rules and calendar' }))
    fireEvent.change(screen.getByLabelText('Counted starts per seven-day period'), { target: { value: '32' } })
    fireEvent.change(screen.getByLabelText('Period 1 starts (UTC)'), { target: { value: '2026-10-20T23:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save tournament plan' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalled())
    const rules = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).config.rules
    expect(rules.nbaGames.startsPerPeriod).toBe(32)
    expect(rules.calendar.periods[0].startsAt).toBe('2026-10-20T23:00:00.000Z')
    expect(rules.calendar.drafts).toHaveLength(3)
    expect(rules.calendar.scheduleReviewed).toBe(false)
  })
  it('keeps saved playing rules read-only for reviewers', () => {
    const saved = savedPlan({ isOwner: false, canEditSettings: false })
    saved.config.rules = defaultSeasonRules('NBA', 'nba_points')
    render(<SeasonTournamentPlanner saved={saved} />)
    expect(screen.getByLabelText('Lineup lock')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset playing rules and calendar to defaults' })).toBeDisabled()
  })
  it('requires calendar review again when cut periods change', () => {
    const saved = savedPlan()
    saved.config.rules = defaultSeasonRules('NBA', 'nba_points')
    saved.config.rules.calendar.scheduleReviewed = true
    render(<SeasonTournamentPlanner saved={saved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit tournament rules' }))
    expect(screen.getByLabelText('I reviewed these windows against actual games and season breaks')).toBeChecked()
    fireEvent.change(screen.getByLabelText('First cut after period'), { target: { value: '9' } })
    expect(screen.getByLabelText('I reviewed these windows against actual games and season breaks')).not.toBeChecked()
  })
})
