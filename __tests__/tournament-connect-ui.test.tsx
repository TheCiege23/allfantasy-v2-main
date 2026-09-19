import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
import { NewTournamentClient } from '@/app/tournament-hub/new/NewTournamentClient'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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
    expect(screen.getByRole('button', { name: 'Review 1 league' })).toBeEnabled()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Select all matching unassigned leagues'))
    expect(screen.getByRole('button', { name: 'Review 2 leagues' })).toBeEnabled()
    expect(screen.getAllByRole('checkbox')[2]).toBeDisabled()
    fireEvent.click(screen.getByText('+ Add a conference'))
    expect(screen.getByRole('button', { name: 'Review 2 leagues' })).toBeEnabled()
  })
})

it('reviews exact leagues and schedule before submitting, and preserves selections when editing', async () => {
  const post = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Please try again' }) })
  vi.stubGlobal('fetch', post)
  render(<NewTournamentClient leagues={[{ id: 'a', name: 'Black League', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: null }]} />)
  fireEvent.change(screen.getByPlaceholderText('King Buffalo Invitational'), { target: { value: 'Cup' } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 league' }))
  expect(post).not.toHaveBeenCalled()
  expect(screen.getByRole('region', { name: 'Review tournament connection' })).toHaveTextContent('Black League')
  expect(screen.getByText(/Regular season: weeks/)).toHaveTextContent('weeks 1–9')
  expect(screen.getByText(/advance count/)).toHaveTextContent('team count (12)')
  fireEvent.click(screen.getByRole('button', { name: 'Edit selections and schedule' }))
  expect(screen.getByRole('checkbox')).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 league' }))
  fireEvent.click(screen.getByRole('button', { name: 'Connect 1 league' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again')
  expect(post).toHaveBeenCalledTimes(1)
  expect(JSON.parse(post.mock.calls[0][1].body)).toMatchObject({ name: 'Cup', conferences: [{ name: 'Conference 1', leagueIds: ['a'] }] })
})
