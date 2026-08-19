/**
 * Fantasy OS Suite — Phase V7.3 (Part B): the /fantasy-os gateway entry experience.
 *
 * Covers authenticated + unauthenticated states, white-label branding, portfolio + context selection,
 * commissioner eligibility, the honest preview-vs-live-demo distinction, the guided seven-OS rail,
 * singular/plural grammar, and provider abstraction (no provider strings on this executive surface).
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FantasyOsGateway from '@/app/fantasy-os/FantasyOsGateway'

const oneCommish = [{ id: 'a', name: 'Redraft Alpha', isCommissioner: true, role: 'commissioner' }]
const mixed = [
  { id: 'a', name: 'Redraft Alpha', isCommissioner: true, role: 'commissioner' },
  { id: 'b', name: 'Dynasty Beta', isCommissioner: false, role: 'member' },
]

describe('Fantasy OS gateway — entry + routing', () => {
  it('renders the product brand and routes into Platform OS by default', () => {
    render(<FantasyOsGateway leagues={mixed} isAuthenticated />)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    const enter = screen.getByRole('link', { name: /Enter Platform OS/i })
    expect(enter.getAttribute('href')).toBe('/manager-hub')
  })

  it('shows a commissioner entry only when the user commissions a league', () => {
    const { rerender } = render(<FantasyOsGateway leagues={oneCommish} isAuthenticated />)
    expect(screen.getAllByRole('link', { name: /Commissioner Hub/i }).length).toBeGreaterThan(0)
    rerender(
      <FantasyOsGateway
        leagues={[{ id: 'b', name: 'Dynasty Beta', isCommissioner: false, role: 'member' }]}
        isAuthenticated
      />,
    )
    expect(screen.queryByRole('link', { name: /Commissioner Hub/i })).toBeNull()
  })

  it('offers a sign-in path and no context selector when unauthenticated', () => {
    render(<FantasyOsGateway leagues={[]} isAuthenticated={false} />)
    expect(screen.getByRole('link', { name: /Sign in to enter/i })).toBeTruthy()
    expect(screen.queryByLabelText(/Portfolio context/i)).toBeNull()
  })

  it('uses singular/plural correctly in the portfolio summary', () => {
    const { rerender } = render(<FantasyOsGateway leagues={oneCommish} isAuthenticated />)
    expect(screen.getByText(/1 league connected/i)).toBeTruthy()
    rerender(<FantasyOsGateway leagues={mixed} isAuthenticated />)
    expect(screen.getByText(/2 leagues connected/i)).toBeTruthy()
  })

  it('labels the two demo modes with truthful Demo Truth Model badges (preview never says live)', () => {
    render(<FantasyOsGateway leagues={mixed} isAuthenticated />)
    // canonical badges: a "Preview" badge and a "Live" badge (connected account)
    expect(screen.getByLabelText(/Preview\. Presentation preview data/i)).toBeTruthy()
    expect(screen.getByLabelText(/Live\. Your connected/i)).toBeTruthy()
    // the preview affordance must never be labeled live
    expect(screen.queryByLabelText(/Preview.*live/i)).toBeNull()
    const preview = screen.getByRole('link', { name: /Open preview/i })
    expect(preview.getAttribute('href')).toBe('/commissioner-hub')
  })

  it('shows Data unavailable (not Live) for the live path when no leagues are connected', () => {
    render(<FantasyOsGateway leagues={[]} isAuthenticated />)
    expect(screen.getByLabelText(/Data unavailable/i)).toBeTruthy()
    expect(screen.queryByLabelText(/^Live\./i)).toBeNull()
  })

  it('renders the guided seven-OS rail in order', () => {
    render(<FantasyOsGateway leagues={mixed} isAuthenticated />)
    const rail = screen.getByRole('region', { name: /Guided tour/i })
    const items = within(rail).getAllByRole('listitem')
    expect(items).toHaveLength(7)
    expect(within(rail).getByText('Platform OS')).toBeTruthy()
    expect(within(rail).getByText('Draft OS')).toBeTruthy()
  })
})

describe('Fantasy OS gateway — provider abstraction', () => {
  it('renders no provider name or raw provider id on the executive surface', () => {
    const { container } = render(<FantasyOsGateway leagues={mixed} isAuthenticated />)
    expect(container.textContent).not.toMatch(/sleeper|espn|yahoo|fantrax|\bmfl\b/i)
  })

  it('source contains no provider strings', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'app', 'fantasy-os', 'FantasyOsGateway.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/sleeper|espn|yahoo|fantrax/i)
  })
})
