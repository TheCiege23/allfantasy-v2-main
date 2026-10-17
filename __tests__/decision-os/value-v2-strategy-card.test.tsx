import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ChimmyStrategyCard from '@/components/chimmy/ChimmyStrategyCard'

const ready = { available: true, active: 'balanced', revision: 3,
  pending: { strategy: 'rebuild', observations: 3, readyToConfirm: true },
  evidence: { available: true, completedWeek: 5, canConfirm: true } }
const fetchMock = vi.fn()
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('refreshes on entry, requires an explicit click and sends only the confirmed revision', async () => {
  fetchMock.mockResolvedValueOnce(response(ready))
  let complete!: (r: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve }))
  render(<ChimmyStrategyCard leagueId="L" />)
  const button = await screen.findByRole('button', { name: 'Use rebuild strategy' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fireEvent.click(button); fireEvent.click(button)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ expectedRevision: 3, strategy: 'rebuild', confirmed: true })
  await act(async () => complete(response({ available: true, active: 'rebuild', revision: 4, pending: null })))
  expect(await screen.findByText('Your strategy preference is saved.')).toBeTruthy()
  expect(screen.getByText('League strategy · Rebuild')).toBeTruthy()
})
it('reloads a conflict for review without automatically resubmitting confirmation', async () => {
  fetchMock.mockResolvedValueOnce(response(ready)).mockResolvedValueOnce(response({}, 409))
    .mockResolvedValueOnce(response({ ...ready, revision: 4, pending: null }))
  render(<ChimmyStrategyCard leagueId="L" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Use rebuild strategy' }))
  expect(await screen.findByText(/Review it before confirming again/)).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: 'refresh' })
})
it('ignores an old leagues late response after switching leagues', async () => {
  let first!: (r: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { first = resolve }))
    .mockResolvedValueOnce(response({ ...ready, active: 'win-now', pending: null }))
  const component = render(<ChimmyStrategyCard leagueId="old" />)
  component.rerender(<ChimmyStrategyCard leagueId="new" />)
  expect(await screen.findByText('League strategy · Win now')).toBeTruthy()
  await act(async () => first(response(ready)))
  expect(screen.queryByRole('button', { name: 'Use rebuild strategy' })).toBeNull()
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
})
it('keeps incomplete evidence unconfirmable and offers retry after failure', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response({ ...ready, evidence: { available: false, canConfirm: false } }))
  render(<ChimmyStrategyCard leagueId="L" />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh strategy' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(screen.queryByRole('button', { name: 'Use rebuild strategy' })).toBeNull()
  expect(screen.getByText(/Fresh, complete weekly league results/)).toBeTruthy()
})
