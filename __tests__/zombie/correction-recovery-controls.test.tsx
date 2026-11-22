import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZombieCorrectionRecovery } from '@/components/zombie/ZombieCorrectionRecovery'
const review = { id: 'R', fromWeek: 1, sourceHash: 'reviewed-source', status: 'ready', effectsPending: false, blockers: [] as string[], externalReviews: [], changes: [],
  summary: [{ week: 1, scoreChanges: 1, roleChanges: 1, itemChanges: 2, winningsChanges: 2, retainedChoices: 0, newChoices: 0 }] }
const pack = { holdFromWeek: 1, teams: [], weeks: [{ week: 1, status: 'complete', requiresStatCorrection: true }], reviews: [] as unknown[] }
let fetchMock: ReturnType<typeof vi.fn>
const response = (body: unknown, ok = true) => ({ ok, json: async () => body })
beforeEach(() => { fetchMock = vi.fn(async () => response(pack)); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function preview() {
  render(<ZombieCorrectionRecovery leagueId="L" />)
  await screen.findByRole('option', { name: 'Week 1 · Review required' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Starting week' }), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare correction preview' }))
  await screen.findByRole('heading', { name: 'Reviewed recovery from Week 1' })
}
describe('commissioner correction recovery controls', () => {
  it('shows the hold and requires both a reason and explicit review before applying the exact saved hash', async () => {
    const posts: Record<string, unknown>[] = []
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (!init?.body) return response(pack)
      const body = JSON.parse(String(init.body)); posts.push(body)
      return response(body.action === 'preview' ? { review } : { effectsPending: false })
    })
    await preview()
    expect(screen.getByRole('alert')).toHaveTextContent('Correction hold from Week 1')
    const approve = screen.getByRole('button', { name: 'Approve and apply reviewed correction' })
    expect(approve).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Approval reason'), { target: { value: 'Reviewed the corrected official scoring evidence' } })
    expect(approve).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(approve)
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toEqual({ leagueId: 'L', action: 'approve', reviewId: 'R', sourceHash: 'reviewed-source', reason: 'Reviewed the corrected official scoring evidence' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Recovery completed'))
  })
  it('keeps blocked dependencies visible and offers no approval button', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => response(init?.body ? { review: { ...review, status: 'blocked', blockers: ['Week 2 has an intervening item trade.'] } } : pack))
    await preview()
    expect(screen.getByText('Week 2 has an intervening item trade.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and apply reviewed correction' })).not.toBeInTheDocument()
  })
  it('shows a stale preview error instead of pretending recovery completed', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const action = init?.body ? JSON.parse(String(init.body)).action : null
      return response(action === 'preview' ? { review } : action === 'approve' ? { error: 'STALE_PREVIEW: prepare a fresh review.' } : pack, action !== 'approve')
    })
    await preview(); fireEvent.change(screen.getByLabelText('Approval reason'), { target: { value: 'Reviewed all affected weeks and changes' } }); fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve and apply reviewed correction' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('STALE_PREVIEW'))
    expect(screen.queryByText('Recovery completed. The game state and reports are up to date.')).not.toBeInTheDocument()
  })
  it('shows a retry action for applied game state with unfinished derived reports', async () => {
    fetchMock.mockResolvedValue(response({ ...pack, reviews: [{ ...review, status: 'applied', effectsPending: true }] }))
    render(<ZombieCorrectionRecovery leagueId="L" />)
    expect(await screen.findByRole('button', { name: 'Retry standings & reports' })).toBeEnabled()
    expect(screen.getByText(/game state applied; standings or reports pending/)).toBeInTheDocument()
  })
})
