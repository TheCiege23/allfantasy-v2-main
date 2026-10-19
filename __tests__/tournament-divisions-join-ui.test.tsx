import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { TournamentJoin } from '@/components/tournament/divisions/TournamentJoin'
import { TournamentReveal } from '@/components/tournament/divisions/TournamentReveal'
import { DivisionControl } from '@/components/tournament/divisions/DivisionControl'
import { ChampionShareStudio } from '@/components/tournament/divisions/ChampionShareCard'
import { computeDivision, defaultFormatSettings, divisionsCalendar } from '@/lib/tournament/divisions/engine'
import { buildHubView } from '@/lib/tournament/divisions/hubView'
import { leagueDisplayName } from '@/lib/tournament/divisions/identity'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'
import { buildShareCard } from '@/lib/tournament/divisions/shareCard'
import type { ControlView, JoinView, RevealView } from '@/lib/tournament/divisions/lifecycle'

const { teams, identity } = sampleDivisionsField()
const settings = defaultFormatSettings('NFL')

function join(overrides: Partial<JoinView> = {}): JoinView {
  return {
    tournamentId: 't', name: 'Angelic vs Demonic 2026', phase: 'registering', sport: 'NFL', settings, calendar: divisionsCalendar(settings), identity,
    registration: { closesAt: '2026-09-01T16:00:00.000Z', allowPreference: true, allowGrouping: false, entry: 'Free' },
    capacity: 240, registered: 212, waitlist: 3, me: null, myLeague: null, commissioner: { name: 'TheCiege26', leaguesRun: 19 }, invitedBy: 'TheCiege26', ...overrides,
  }
}

describe('TournamentJoin', () => {
  it('open: spots bar, preference marked not guaranteed, join button', () => {
    render(<TournamentJoin view={join()} refName={null} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Angelic vs Demonic 2026' })).toBeTruthy()
    expect(screen.getByText('212')).toBeTruthy()
    expect(screen.getByText('Division preference (not guaranteed)')).toBeTruthy()
    expect(within(screen.getByRole('radiogroup', { name: 'Division preference' })).getAllByRole('radio').map(r => r.textContent)).toEqual(['Any', 'Angelic', 'Demonic'])
    expect(screen.getByRole('button', { name: 'Join tournament' })).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /Smoke (Angelic|Demonic)/ }).length).toBeGreaterThanOrEqual(2)
  })

  it('shows the real scoring and roster labels before joining (NFL and NBA)', () => {
    const { unmount } = render(<TournamentJoin view={join()} refName={null} />)
    expect(screen.getByTestId('scoring-pill-half').textContent).toBe('HALF')
    expect(screen.getByText('Half PPR')).toBeTruthy()
    expect(screen.getByTestId('roster-label-nfl-std').textContent).toMatch(/^Standard roster · 9 start/)
    unmount()
    const nba = defaultFormatSettings('NBA')
    render(<TournamentJoin view={join({ sport: 'NBA', settings: nba, calendar: divisionsCalendar(nba) })} refName={null} />)
    expect(screen.getByTestId('scoring-pill-pts').textContent).toBe('PTS')
    expect(screen.getByTestId('roster-label-nba-std').textContent).toMatch(/^Standard roster · 10 start/)
  })

  it('almost full and full (waitlist position)', () => {
    const { unmount } = render(<TournamentJoin view={join({ registered: 236 })} refName={null} />)
    expect(screen.getByText(/Only 4 spots left/)).toBeTruthy()
    unmount()
    render(<TournamentJoin view={join({ registered: 240 })} refName={null} />)
    expect(screen.getByRole('button', { name: /Join the waitlist · you’d be #4/ })).toBeTruthy()
    expect(screen.queryByText('Division preference (not guaranteed)')).toBeNull()
  })

  it('closed offers following; already in shows the league and a reveal link', () => {
    const { unmount } = render(<TournamentJoin view={join({ phase: 'placed' })} refName={null} />)
    expect(screen.getByRole('button', { name: 'Follow the tournament' })).toBeTruthy()
    unmount()
    render(<TournamentJoin view={join({ phase: 'placed', me: { status: 'registered', waitlistPosition: null, preference: null, revealSeen: false }, myLeague: { name: 'Smoke Angelic', draftAt: null, leagueId: null, division: 0, conference: 5 } })} refName={null} />)
    expect(screen.getByText('Smoke Angelic')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to my league' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Reveal my league' })).toBeTruthy()
  })

  it('a waitlisted entrant sees their place in line', () => {
    render(<TournamentJoin view={join({ registered: 240, me: { status: 'waitlisted', waitlistPosition: 2, preference: null, revealSeen: false } })} refName={null} />)
    expect(screen.getByText('#2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Leave the waitlist' })).toBeTruthy()
  })
})

describe('TournamentReveal', () => {
  const reveal = (seen: boolean): RevealView => ({
    tournamentId: 't', tournament: 'Angelic vs Demonic 2026', identity, settings, division: 0, conference: 5, conferences: 10,
    league: { name: leagueDisplayName('Smoke', 'Angelic'), teams: 12, draftAt: null, leagueId: null },
    mates: [{ id: 'me', name: 'TheCiege26', isMe: true }, { id: 'x', name: 'Hoovi', isMe: false }], seen,
  })

  it('plays once: first visit shows the mystery card, then marks it seen', () => {
    const fetchSpy = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchSpy)
    render(<TournamentReveal view={reveal(false)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reveal my league' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Smoke Angelic' })).toBeTruthy()
    expect(screen.getByText('You')).toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ action: 'reveal_seen', tournamentId: 't' })
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('a returning visitor lands on the end state with Replay', () => {
    render(<TournamentReveal view={reveal(true)} />)
    expect(screen.queryByRole('button', { name: 'Reveal my league' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Replay' })).toBeTruthy()
  })
})

function control(overrides: Partial<NonNullable<ControlView>['seeding']> = {}): NonNullable<ControlView> {
  const view = buildHubView({ tournament: { id: 't', name: 'T', sport: 'NFL', status: 'placed', season: 2026 }, settings, identity, teams })
  return {
    view, state: { status: 'placed', registration: { closesAt: null, allowPreference: true, allowGrouping: false, entry: 'Free' }, capacity: 240 },
    seeding: { week: 10, results: 240, provisional: true, correctionsClosed: false, ties: [], committed: false, blockers: ['Confirm the stat-correction window has closed.'], ...overrides },
    rounds: { committedRounds: 0, nextRound: 1, nextWeek: 11, nextLabel: 'Round of 64', correctionsClosed: false, championship: null },
    audits: [], counts: { registered: 240 }, leagues: [], roundPreview: null,
  }
}

describe('DivisionControl', () => {
  it('seeding cannot be committed while a blocker stands, even after acknowledging', () => {
    render(<DivisionControl control={control()} />)
    expect(screen.getByRole('heading', { name: 'Seeding and round control' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand' }))
    expect((screen.getByRole('button', { name: 'Commit seeding' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Confirm the stat-correction window has closed.')).toBeTruthy()
  })

  it('with no blockers, commit needs the acknowledgement', () => {
    render(<DivisionControl control={control({ correctionsClosed: true, blockers: [] })} />)
    const commit = screen.getByRole('button', { name: 'Commit seeding' }) as HTMLButtonElement
    expect(commit.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand' }))
    expect(commit.disabled).toBe(false)
    expect(screen.getByText(/Gold cells are wildcards \(seeds 14–16\)/)).toBeTruthy()
  })

  it('the notifications tab shows the default channel matrix', () => {
    render(<DivisionControl control={control()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }))
    expect(screen.getByLabelText('Email off', { selector: 'span' })).toBeTruthy()
    expect(screen.getAllByText('ON').length).toBe(24)
    expect(screen.getAllByText('OFF').length).toBe(4)
  })
})

describe('ChampionShareStudio', () => {
  it('previews the card and switches sizes', () => {
    const view = buildHubView({ tournament: { id: 't', name: 'T', sport: 'NFL', status: 'live', season: 2026 }, settings, identity, teams })
    const top = computeDivision(teams.filter(t => t.divisionIndex === 0), settings).ranked[0]!
    const card = buildShareCard(view, top.id)!
    render(<ChampionShareStudio card={card} view={view} shareUrl="/tournament-trophy/t" />)
    expect(screen.getByText(/Exports at 1080 × 1920/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Square' }))
    expect(screen.getByText(/Exports at 1080 × 1080/)).toBeTruthy()
    expect(screen.getAllByText('created by KB').length).toBeGreaterThan(0)
  })
})
