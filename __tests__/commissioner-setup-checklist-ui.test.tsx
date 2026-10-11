import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommissionerSetupChecklist } from '@/components/league/CommissionerSetupChecklist'
import { buildCommissionerSetupChecklist } from '@/lib/league/commissioner-setup-checklist'

const data = buildCommissionerSetupChecklist({ teamCount: 2, teams: [{ claimedByUserId: 'owner' }],
  rosterConfigured: true, scoringConfigured: true, rosterIds: [], draft: null, draftDate: null })
afterEach(() => vi.unstubAllGlobals())
describe('commissioner checklist UI', () => {
  it('links setup actions to the right settings and refreshes after closing settings', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => data })
    vi.stubGlobal('fetch', fetcher)
    const open = vi.fn()
    const view = render(<CommissionerSetupChecklist leagueId="league" onOpenSettings={open} />)
    await screen.findByText('1/2 managers assigned · 1 open slot')
    fireEvent.click(screen.getByRole('button', { name: 'Invite managers' }))
    expect(open).toHaveBeenCalledWith('invite')
    fireEvent.click(screen.getByRole('button', { name: 'Review roster rules' }))
    expect(open).toHaveBeenCalledWith('roster')
    expect(screen.getByRole('link', { name: 'Open draft room' }).getAttribute('href')).toBe('/league/league/draft')
    view.rerender(<CommissionerSetupChecklist leagueId="league" onOpenSettings={open} settingsOpen />)
    expect(fetcher).toHaveBeenCalledTimes(1)
    view.rerender(<CommissionerSetupChecklist leagueId="league" onOpenSettings={open} settingsOpen={false} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })
  it('shows a retryable error instead of claiming completion when the load fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => data })
    vi.stubGlobal('fetch', fetcher)
    render(<CommissionerSetupChecklist leagueId="league" onOpenSettings={vi.fn()} />)
    await screen.findByRole('alert')
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('1/2 managers assigned · 1 open slot')
    expect(screen.getByRole('progressbar').getAttribute('max')).toBe('6')
  })
})
