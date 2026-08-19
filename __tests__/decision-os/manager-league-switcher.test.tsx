import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import ManagerLeagueSwitcher from '@/components/decision-os/ManagerLeagueSwitcher'

describe('ManagerLeagueSwitcher', () => {
  it('shows an honest, manager-appropriate empty state (not commissioner-specific wording)', () => {
    render(<ManagerLeagueSwitcher leagues={[]} />)
    expect(screen.getByTestId('manager-league-switcher-empty')).toHaveTextContent(
      "You don't belong to any leagues yet.",
    )
  })

  it('renders a real navigation link to /league/[id] for each league — no onSelect callback', () => {
    render(
      <ManagerLeagueSwitcher
        leagues={[
          { id: 'league-1', name: 'Dynasty Warriors' },
          { id: 'league-2', name: 'Redraft Rebels' },
        ]}
      />,
    )
    expect(screen.getByTestId('manager-league-switcher-item-league-1')).toHaveAttribute(
      'href',
      '/league/league-1',
    )
    expect(screen.getByTestId('manager-league-switcher-item-league-2')).toHaveTextContent('Redraft Rebels')
  })

  it('shows the real league count in the panel title', () => {
    render(<ManagerLeagueSwitcher leagues={[{ id: 'league-1', name: 'Dynasty Warriors' }]} />)
    expect(screen.getByText('Switch to a league (1)')).toBeInTheDocument()
  })
})
