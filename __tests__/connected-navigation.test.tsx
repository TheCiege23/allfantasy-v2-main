import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ usePathname: () => '/core/war-room' }))
import { ConnectedLeagueContext, ConnectedLeagueRailGroup, connectedLeagueHref } from '@/components/core-app/ConnectedLeagueNavigation'
const hub = { id: 'h', name: 'Bowl Franchise', members: [
  { id: 'peach', name: 'Peach Bowl', platform: 'sleeper', href: '/core?league=peach' },
  { id: 'cream', name: 'Cream Bowl', platform: 'fantrax', href: '/core?league=cream' },
] }
afterEach(cleanup)
describe('connected franchise navigation', () => {
  it('keeps War Room selected when switching leagues and states the scoring scope', () => {
    render(<ConnectedLeagueContext hub={hub} selectedLeagueId="cream" />)
    expect(screen.getByRole('link', { name: /Peach Bowl/ }).getAttribute('href')).toBe('/core/war-room?league=peach')
    expect(screen.getByRole('link', { name: /Cream Bowl/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByText(/Viewing Cream Bowl/)).toBeTruthy()
  })
  it('opens the selected member from a compact hub tile', () => {
    render(<ConnectedLeagueRailGroup hub={hub} selectedLeagueId="cream" expanded={false} onNavigate={() => {}} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/core?league=cream')
  })
  it('shows one expandable group with access to both members', () => {
    const { container } = render(<ConnectedLeagueRailGroup hub={hub} selectedLeagueId="cream" expanded onNavigate={() => {}} />)
    expect(container.querySelector('details')?.open).toBe(true)
    expect(screen.getByRole('link', { name: /Cream Bowl/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('link', { name: /Peach Bowl/ })).toBeTruthy()
  })
  it('drops stale tool parameters and sends unsupported screens to overview', () => {
    expect(connectedLeagueHref('/core/draft', 'a b')).toBe('/core?league=a%20b')
  })
})
