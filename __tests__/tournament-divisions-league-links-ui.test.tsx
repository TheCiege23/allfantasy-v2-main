import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { LeagueLinks } from '@/components/tournament/divisions/DivisionsHub'
import { CoCommissioners, LeagueSetup, draftSyncText } from '@/components/tournament/divisions/DivisionControl'

describe('Go to your league (hub)', () => {
  it('a member gets a link to their own conference league', () => {
    render(<LeagueLinks myLeagueId="L7" leagueLinks={[]} />)
    expect(screen.getByRole('link', { name: 'Go to your league' }).getAttribute('href')).toBe('/league/L7')
  })

  it('the commissioner gets every conference league', () => {
    render(<LeagueLinks myLeagueId={null} leagueLinks={[{ name: 'North Gold', leagueId: 'L1' }, { name: 'South Gold', leagueId: 'L2' }]} />)
    expect(screen.getByText('Go to a league (2)')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'South Gold' }).getAttribute('href')).toBe('/league/L2')
  })

  it('shows nothing before any league exists', () => {
    const { container } = render(<LeagueLinks myLeagueId={null} leagueLinks={[]} />)
    expect(container.textContent).toBe('')
  })
})

describe('conference league setup (control screen)', () => {
  const leagues = [
    { id: 'tl1', name: 'North Gold', draftAt: null, teams: 12, leagueId: 'L1', ready: true },
    { id: 'tl2', name: 'South Gold', draftAt: null, teams: 12, leagueId: null, ready: false },
  ]
  const audits = [{ id: 'a', action: 'divisions_conference_leagues_provisioned', at: '2026-10-19T00:00:00Z', data: { problems: [{ league: 'South Gold', outcome: 'failed', error: 'The league could not be created: Failed to create league' }] } }]

  it('shows each conference’s outcome and retries only the missing ones', () => {
    const onRetry = vi.fn()
    render(<LeagueSetup leagues={leagues} audits={audits as never} disabled={false} onRetry={onRetry} />)
    expect(screen.getByText(/1 of 2 ready/)).toBeTruthy()
    expect(screen.getByText(/League and draft ready/)).toBeTruthy()
    expect(screen.getByText(/could not be created/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open league' }).getAttribute('href')).toBe('/league/L1')
    fireEvent.click(screen.getByRole('button', { name: 'Set up 1 remaining league' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('offers no retry once every league is ready', () => {
    render(<LeagueSetup leagues={[leagues[0]!]} audits={[]} disabled={false} onRetry={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('league sync outcomes (control screen)', () => {
  it('says what happened to each league draft when a time is set', () => {
    expect(draftSyncText({ outcome: 'scheduled' })).toBe('League draft scheduled.')
    expect(draftSyncText({ outcome: 'skipped_started' })).toMatch(/already started/)
    expect(draftSyncText({ outcome: 'not_ready' })).toMatch(/not set up yet/)
    expect(draftSyncText({ outcome: 'failed', error: 'Refused.' })).toBe('Refused.')
  })

  const control = (isOwner: boolean) => ({
    isOwner,
    coCommissioners: [{ userId: 'co1', name: 'Casey' }],
    leagues: [
      { id: 'tl1', name: 'North Gold', draftAt: null, teams: 12, leagueId: 'L1', ready: true, draftSync: null, coCommissionerSync: { outcome: 'updated', error: null } },
      { id: 'tl2', name: 'South Gold', draftAt: null, teams: 12, leagueId: 'L2', ready: true, draftSync: null, coCommissionerSync: { outcome: 'failed', error: 'Could not update this one.' } },
    ],
  }) as never

  it('lists co-commissioners with their league coverage and lets the owner add and remove', () => {
    const onAdd = vi.fn(), onRemove = vi.fn()
    render(<CoCommissioners control={control(true)} disabled={false} onAdd={onAdd} onRemove={onRemove} />)
    expect(screen.getByText(/co-commissioner in 1 of 2 leagues/)).toBeTruthy()
    expect(screen.getByText(/South Gold: Could not update this one/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledWith('co1', 'Casey')
    fireEvent.change(screen.getByLabelText('Co-commissioner username'), { target: { value: ' pat ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add co-commissioner' }))
    expect(onAdd).toHaveBeenCalledWith('pat')
  })

  it('staff who are not the owner see the list but cannot change it', () => {
    render(<CoCommissioners control={control(false)} disabled={false} onAdd={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
