import { fireEvent, render, screen, cleanup, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
import { NewTournamentClient } from '@/app/tournament-hub/new/NewTournamentClient'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/*
 * ⚠ THESE ASSERT THE TWO-LIST MODEL, WHICH IS NOT THE ONE THEY WERE WRITTEN
 * FOR. The screen used to show every league as one long checkbox grid, checked
 * or not; it now shows leagues ALREADY IN a conference as rows in that
 * conference's card, and offers the rest in a "Connectable leagues" panel. So
 * an assigned league LEAVES the panel — which is why "the taken league is the
 * third checkbox" no longer describes anything, and is asserted by name here
 * instead. Every guarantee the old file encoded is still checked below; only
 * the way the screen expresses them moved.
 */

describe('connecting imported leagues', () => {
  it('searches and selects matching leagues without selecting leagues already connected', () => {
    render(<NewTournamentClient leagues={[
      { id: 'a', name: 'KBI Black', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: null },
      { id: 'b', name: 'KBI Gold', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: null },
      { id: 'c', name: 'KBI Taken', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: 'Existing cup' },
    ]} />)
    fireEvent.change(screen.getByPlaceholderText('King Buffalo Invitational'), { target: { value: 'Cup' } })

    /* A league connected to another tournament is offered but never selectable. */
    expect(screen.getByRole('checkbox', { name: /KBI Taken/ })).toBeDisabled()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Black' } })
    fireEvent.click(screen.getByText('Select all matching unassigned leagues'))
    expect(screen.getByRole('button', { name: 'Review 1 league' })).toBeEnabled()

    /* Assigned leagues move out of the panel and into the conference card. */
    const conference = screen.getByRole('region', { name: 'Conference 1' })
    expect(within(conference).getByText('KBI Black')).toBeInTheDocument()
    expect(within(conference).getByText('SEED 1')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /KBI Black/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Select all matching unassigned leagues'))
    expect(screen.getByRole('button', { name: 'Review 2 leagues' })).toBeEnabled()
    /* Select-all skipped the taken league both times. */
    expect(screen.getByRole('checkbox', { name: /KBI Taken/ })).toBeDisabled()

    fireEvent.click(screen.getByText('+ Add a conference'))
    expect(screen.getByRole('button', { name: 'Review 2 leagues' })).toBeEnabled()
  })

  it('removes a league from its conference and puts it back on offer', () => {
    render(<NewTournamentClient leagues={[
      { id: 'a', name: 'KBI Black', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: null },
    ]} />)
    fireEvent.change(screen.getByPlaceholderText('King Buffalo Invitational'), { target: { value: 'Cup' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /KBI Black/ }))
    expect(screen.getByRole('button', { name: 'Review 1 league' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove KBI Black from Conference 1' }))
    expect(screen.getByRole('button', { name: 'Review 0 leagues' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /KBI Black/ })).toBeInTheDocument()
  })
})

it('reviews exact leagues and schedule before submitting, and preserves selections when editing', async () => {
  const post = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Please try again' }) })
  vi.stubGlobal('fetch', post)
  render(<NewTournamentClient leagues={[{ id: 'a', name: 'Black League', platform: 'sleeper', season: 2026, teamCount: 12, takenBy: null }]} />)
  fireEvent.change(screen.getByPlaceholderText('King Buffalo Invitational'), { target: { value: 'Cup' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /Black League/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 league' }))
  expect(post).not.toHaveBeenCalled()

  const review = screen.getByRole('region', { name: 'Review tournament connection' })
  expect(review).toHaveTextContent('Black League')
  expect(review).toHaveTextContent('Weeks 1–9')
  /* The season is derived from the picked leagues, never typed. */
  expect(review).toHaveTextContent('season 2026')
  expect(screen.getByText(/advance count/)).toHaveTextContent('team count (12)')

  fireEvent.click(screen.getByRole('button', { name: 'Edit selections and schedule' }))
  /* Editing keeps the selection — the league is still a row in its conference. */
  const conference = screen.getByRole('region', { name: 'Conference 1' })
  expect(within(conference).getByText('Black League')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Review 1 league' }))
  fireEvent.click(screen.getByRole('button', { name: 'Connect 1 league' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Please try again')
  expect(post).toHaveBeenCalledTimes(1)
  expect(JSON.parse(post.mock.calls[0][1].body)).toMatchObject({ name: 'Cup', conferences: [{ name: 'Conference 1', leagueIds: ['a'] }] })
})
