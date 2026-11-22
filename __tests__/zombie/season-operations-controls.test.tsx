import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ZombieSeasonOperations } from '@/components/zombie/ZombieSeasonOperations'
const mockFetch = vi.fn()
const pack = { scope: 'u:test', userId: 'owner', season: 2026, canManage: true, denominator: 'votes_cast', teams: [], records: [] }
const response = (value: unknown, ok = true) => Promise.resolve({ ok, json: async () => value })
beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset(); mockFetch.mockImplementation(() => response(pack)) })
describe('Zombie season operations controls', () => {
  it('requires an explicit confirmation and meaningful reason before applying the exact reviewed allocation', async () => {
    const review = { id: 'review1', hash: 'a'.repeat(64), plan: { blockers: [], leagues: [], ultimate: null } }
    mockFetch.mockResolvedValueOnce(await response(pack)).mockResolvedValueOnce(await response({ review })).mockImplementation(() => response(pack))
    render(<ZombieSeasonOperations leagueId="league1" />)
    fireEvent.click(await screen.findByText('Prepare season allocation'))
    const approve = await screen.findByText('Approve reviewed allocation'); expect(approve).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Review reason'), { target: { value: 'I reviewed every exact allocation and funding record.' } })
    expect(approve).toBeDisabled(); fireEvent.click(screen.getByLabelText('I reviewed funding, owner history, allocations and carryover.')); expect(approve).toBeEnabled()
    fireEvent.click(approve)
    await waitFor(() => expect(mockFetch.mock.calls.some((c: unknown[]) => typeof (c[1] as { body?: string })?.body === 'string' && JSON.parse((c[1] as { body: string }).body).action === 'approve')).toBe(true))
    const call = mockFetch.mock.calls.find((c: unknown[]) => (c[1] as { body?: string })?.body?.includes('"action":"approve"'))!
    expect(JSON.parse(call[1].body)).toMatchObject({ leagueId: 'league1', reviewId: 'review1', hash: review.hash })
  })
  it('keeps a blocked financial preview unapprovable', async () => {
    mockFetch.mockResolvedValueOnce(await response(pack)).mockResolvedValueOnce(await response({ review: { id: 'r', hash: 'h', plan: { blockers: ['Resolve the held week first'], leagues: [], ultimate: null } } })).mockImplementation(() => response(pack))
    render(<ZombieSeasonOperations leagueId="league1" />); fireEvent.click(await screen.findByText('Prepare season allocation'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Resolve the held week first'); expect(screen.getByText('Approve reviewed allocation')).toBeDisabled()
  })
  it('hides owner-only recovery and accounting controls from members', async () => {
    mockFetch.mockImplementation(() => response({ ...pack, canManage: false, userId: 'member' }))
    render(<ZombieSeasonOperations leagueId="league1" />); await screen.findByText('Season operations')
    expect(screen.queryByText('Prepare season allocation')).not.toBeInTheDocument(); expect(screen.queryByText('Review and assign replacement')).not.toBeInTheDocument()
    expect(screen.getByText('I consent to the test week')).toBeEnabled()
  })
  it('records consent without a draft-start request', async () => {
    render(<ZombieSeasonOperations leagueId="league1" />); fireEvent.click(await screen.findByText('I consent to the test week'))
    await waitFor(() => expect(mockFetch.mock.calls.some((c: unknown[]) => (c[1] as { body?: string })?.body?.includes('"type":"consent"'))).toBe(true))
    expect(mockFetch.mock.calls.every((c: unknown[]) => !String(c[0]).includes('draft'))).toBe(true)
  })
  it('shows a failed save without announcing completion', async () => {
    mockFetch.mockResolvedValueOnce(await response(pack)).mockResolvedValueOnce(await response({ error: 'Stale accounting preview' }, false))
    render(<ZombieSeasonOperations leagueId="league1" />); fireEvent.click(await screen.findByText('Prepare season allocation'))
    expect(await screen.findByRole('status')).toHaveTextContent('Stale accounting preview'); expect(screen.queryByText(/Saved. Review/)).not.toBeInTheDocument()
  })
})
