import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HighlightAnalyticsPanel } from '@/components/admin/HighlightAnalyticsPanel'
const fetchMock = vi.fn()
const report = { until: '2026-10-12T00:00:00Z', lastEventAt: null, surfaces: [], returns: { cohort: 0, matured: 0, pending: 0, returned: 0, scheduledDays: 0, rate: null, status: 'no_data' } }
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('shows no observations and unknown return rate without a fabricated zero percent', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => report }); render(<HighlightAnalyticsPanel />)
  await screen.findByText(/No observations yet/)
  expect(screen.getByText(/Seven-day game-day return:/).textContent).not.toContain('0%')
  expect(screen.getByText(/It does not confirm playback/)).toBeTruthy()
})
it('distinguishes pending cohorts from missing schedules', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...report, returns: { ...report.returns, cohort: 4, pending: 4, status: 'pending' } }) })
  render(<HighlightAnalyticsPanel />); await screen.findByText(/Waiting for the first cohort/)
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...report, returns: { ...report.returns, cohort: 4, matured: 4, status: 'schedule_unavailable' } }) })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh report' }))
  await screen.findByText(/Return rate unavailable/)
})
it('shows query errors without fake data and supports retry', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false }); render(<HighlightAnalyticsPanel />)
  await screen.findByRole('alert'); expect(screen.queryByText(/No observations/)).toBeNull()
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => report }); fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  await screen.findByText(/No observations yet/)
})
