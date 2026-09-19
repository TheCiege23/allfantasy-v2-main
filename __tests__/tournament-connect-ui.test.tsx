import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
import { NewTournamentClient } from '@/app/tournament-hub/new/NewTournamentClient'
afterEach(cleanup)

describe('connecting imported leagues', () => {
  it('searches and selects matching leagues without selecting leagues already connected', () => {
    render(<NewTournamentClient leagues={[
      { id: 'a', name: 'KBI Black', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: null },
      { id: 'b', name: 'KBI Gold', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: null },
      { id: 'c', name: 'KBI Taken', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: 'Existing cup' },
    ]} />)
    fireEvent.change(screen.getByPlaceholderText('King Buffalo Invitational'), { target: { value: 'Cup' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Black' } })
    fireEvent.click(screen.getByText('Select all matching unassigned leagues'))
    expect(screen.getByRole('button', { name: 'Connect 1 leagues' })).toBeEnabled()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Select all matching unassigned leagues'))
    expect(screen.getByRole('button', { name: 'Connect 2 leagues' })).toBeEnabled()
    expect(screen.getAllByRole('checkbox')[2]).toBeDisabled()
    fireEvent.click(screen.getByText('+ Add a conference'))
    expect(screen.getByRole('button', { name: 'Connect 2 leagues' })).toBeEnabled()
  })
})
