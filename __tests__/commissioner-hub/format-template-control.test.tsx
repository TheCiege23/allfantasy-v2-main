import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { FormatTemplateControl } from '@/components/core-app/commissioner/FormatTemplateControl'

const OFFER = { id: 'efl_promotion_relegation_dynasty', label: 'EFL Promotion/Relegation Dynasty', description: 'Four tiers of eight.' }

afterEach(() => {
  vi.unstubAllGlobals()
  refresh.mockClear()
})

describe('FormatTemplateControl', () => {
  it('offers the owner the template, and applies it only after a confirm', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<FormatTemplateControl leagueId="L1" template={{ applied: null, offers: [OFFER], canChange: true }} />)

    expect(screen.getByText(/Does this league run as EFL Promotion\/Relegation Dynasty\?/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use EFL Promotion/Relegation Dynasty' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, apply' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leagues/L1/commissioner-template',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ templateId: OFFER.id }) }),
    )
  })

  it('shows the route’s own refusal rather than a generic error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: "Only the league's owner can set its format template" }), { status: 403 })))
    render(<FormatTemplateControl leagueId="L1" template={{ applied: null, offers: [OFFER], canChange: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use EFL Promotion/Relegation Dynasty' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, apply' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Only the league's owner can set its format template")
    expect(refresh).not.toHaveBeenCalled()
  })

  it('names an applied template and lets the owner remove it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <FormatTemplateControl
        leagueId="L1"
        template={{ applied: { id: OFFER.id, version: '1.2.0', label: OFFER.label, resolved: true }, offers: [], canChange: true }}
      />,
    )
    expect(screen.getByText(/Run on AllFantasy as/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove format' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ templateId: null }) }))
  })

  it('renders nothing for anyone but the owner, and nothing when there is nothing to offer', () => {
    const { container: notOwner } = render(
      <FormatTemplateControl leagueId="L1" template={{ applied: null, offers: [OFFER], canChange: false }} />,
    )
    expect(notOwner.innerHTML).toBe('')
    const { container: empty } = render(<FormatTemplateControl leagueId="L1" template={{ applied: null, offers: [], canChange: true }} />)
    expect(empty.innerHTML).toBe('')
  })
})
