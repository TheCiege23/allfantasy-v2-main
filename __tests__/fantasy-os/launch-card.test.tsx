import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FantasyOsLaunchCard } from '@/app/dashboard/components/FantasyOsLaunchCard'

describe('FantasyOsLaunchCard', () => {
  it('owner variant: Enterprise Workspace + Owner Access, links to /fantasy-os', () => {
    render(<FantasyOsLaunchCard reason="owner" />)
    const link = screen.getByTestId('dashboard-fantasy-os-launch-card')
    expect(link).toHaveAttribute('href', '/fantasy-os')
    expect(link).toHaveAttribute('aria-label', 'Open Fantasy OS')
    expect(link).toHaveTextContent('Fantasy OS')
    expect(link).toHaveTextContent('Enterprise Workspace')
    expect(link).toHaveTextContent('Owner Access')
  })

  it('admin variant: Enterprise Workspace', () => {
    render(<FantasyOsLaunchCard reason="admin" />)
    const link = screen.getByTestId('dashboard-fantasy-os-launch-card')
    expect(link).toHaveAttribute('href', '/fantasy-os')
    expect(link).toHaveTextContent('Enterprise Workspace')
  })

  it('enterprise variant: Executive Workspace, no Owner Access', () => {
    render(<FantasyOsLaunchCard reason="enterprise" />)
    const link = screen.getByTestId('dashboard-fantasy-os-launch-card')
    expect(link).toHaveTextContent('Executive Workspace')
    expect(link).not.toHaveTextContent('Owner Access')
  })

  it('never surfaces "Decision OS" or internal authorization terminology in any variant', () => {
    for (const reason of ['owner', 'admin', 'enterprise'] as const) {
      const { container, unmount } = render(<FantasyOsLaunchCard reason={reason} />)
      const text = container.textContent ?? ''
      expect(text).not.toMatch(/Decision OS|Decision Operating System|entitlement resolver|admin bypass|enterprise flag|orchestration layer/i)
      unmount()
    }
  })
})
