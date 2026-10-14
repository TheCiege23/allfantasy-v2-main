import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'
import { SeasonTournamentEntry } from '@/components/tournament/SeasonTournamentEntry'
import { SeasonRegistrationManager } from '@/components/tournament/SeasonRegistrationManager'
import type { SeasonEntryView } from '@/lib/tournament/seasonRegistration'
const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))
const entry = (): SeasonEntryView => ({ tournamentId: 't1', name: 'NBA Pilot', sport: 'NBA', publicationId: 'pub1', hash: 'rule-hash', config: completeConfig(), scheduleExceptions: { pendingGames: 30, excludedGames: [{ gameId: 'gap1', startsAt: '2026-11-01T12:00:00Z' }] }, registered: 63, capacity: 64, status: 'not_joined', participantId: null, waitlistPosition: null, canJoin: true, canWithdraw: false, fieldFrozen: false, closesAt: '2026-10-17T00:00:00Z' })
beforeEach(() => { vi.restoreAllMocks(); nav.refresh.mockReset() })
describe('entrant registration interface', () => {
  it('requires acceptance and submits the displayed rule version', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'registered' })))
    render(<SeasonTournamentEntry entry={entry()} token={'a'.repeat(64)} />)
    const button = screen.getByRole('button', { name: 'Join tournament' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/30 NBA Cup-dependent games are pending/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('I accept this published tournament rule version'))
    fireEvent.click(button)
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({ action: 'join', publicationId: 'pub1', acceptedHash: 'rule-hash', acceptedRules: true })
  })
  it('makes a full-field invite a waitlist action and shows queue position for members', () => {
    const view = entry(); view.registered = 64
    const { rerender } = render(<SeasonTournamentEntry entry={view} token={'a'.repeat(64)} />)
    expect(screen.getByRole('button', { name: 'Join waitlist' })).toBeDisabled()
    rerender(<SeasonTournamentEntry entry={{ ...view, status: 'waitlisted', canJoin: false, canWithdraw: true, waitlistPosition: 2 }} />)
    expect(screen.getByText('Waitlist position: 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw my entry' })).toBeEnabled()
  })
  it('keeps expired and removed invites read-only', () => {
    render(<SeasonTournamentEntry entry={{ ...entry(), status: 'removed', canJoin: false }} />)
    expect(screen.queryByRole('button', { name: 'Join tournament' })).not.toBeInTheDocument()
    expect(screen.getByText('Contact the tournament owner to restore your eligibility.')).toBeInTheDocument()
  })
  it('shows retryable server failures without losing rule acceptance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Registration is busy. Please retry.' }), { status: 409 }))
    render(<SeasonTournamentEntry entry={entry()} token={'a'.repeat(64)} />)
    fireEvent.click(screen.getByLabelText('I accept this published tournament rule version'))
    fireEvent.click(screen.getByRole('button', { name: 'Join tournament' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration is busy.')
    expect(screen.getByLabelText('I accept this published tournament rule version')).toBeChecked()
  })
})
describe('commissioner registration interface', () => {
  const board = { publicationId: 'pub1', capacity: 64, registered: 1, waitlisted: 0, state: 'not_opened', closesAt: '', waitlistLimit: 64, fullField: false, openingDraftAt: '2026-10-18T00:00:00Z', entrants: [{ id: 'p1', displayName: 'Manager One', status: 'registered' }] }
  it('opens an invite against the frozen publication and displays its link', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ board }))).mockResolvedValueOnce(new Response(JSON.stringify({ invitePath: '/tournament-entry/t1?invite=' + 'a'.repeat(64) }))).mockResolvedValueOnce(new Response(JSON.stringify({ board: { ...board, state: 'open' } })))
    render(<SeasonRegistrationManager tournamentId="t1" publicationId="pub1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open registration and create invite' }))
    expect((await screen.findByLabelText('Tournament invite link') as HTMLInputElement).value).toContain('invite=')
    const body = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)
    expect(body).toMatchObject({ action: 'open', publicationId: 'pub1', closesAt: '2026-10-17T00:00:00.000Z', waitlistLimit: 64 })
  })
  it('shows the deadline in local time and saves the selected instant', async () => {
    const previousTimeZone = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      const datedBoard = { ...board, closesAt: '2026-10-17T00:00:00.000Z' }
      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ board: datedBoard })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ invitePath: '/tournament-entry/t1?invite=' + 'a'.repeat(64) })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ board: { ...datedBoard, state: 'open' } })))
      render(<SeasonRegistrationManager tournamentId="t1" publicationId="pub1" />)
      const deadline = await screen.findByLabelText('Registration closes (your local time)') as HTMLInputElement
      expect(deadline.value).toBe('2026-10-16T20:00')
      fireEvent.change(deadline, { target: { value: '2026-10-16T21:00' } })
      fireEvent.click(screen.getByRole('button', { name: 'Open registration and create invite' }))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
      expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).closesAt).toBe('2026-10-17T01:00:00.000Z')
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimeZone
    }
  })
  it('requires a removal reason and sends only the selected entrant ID', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ board }))).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }))).mockResolvedValueOnce(new Response(JSON.stringify({ board })))
    render(<SeasonRegistrationManager tournamentId="t1" publicationId="pub1" />)
    const button = await screen.findByRole('button', { name: 'Remove Manager One' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason for removing an entrant'), { target: { value: 'Account review' } })
    fireEvent.click(button)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toMatchObject({ action: 'remove', participantId: 'p1', reason: 'Account review' })
  })
})


describe('opening field commissioner controls', () => {
  const board = { publicationId: 'pub1', capacity: 64, registered: 64, waitlisted: 0, state: 'open', closesAt: '2026-10-17T12:00:00Z', waitlistLimit: 64, fullField: true, openingDraftAt: '2026-10-18T00:00:00Z', entrants: [{ id: 'p1', displayName: 'Manager One', status: 'registered' }] }
  it('requires review acknowledgement and freezes against the publication', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ board }))).mockResolvedValueOnce(new Response(JSON.stringify({ freezeId: 'f1' }))).mockResolvedValueOnce(new Response(JSON.stringify({ board })))
    render(<SeasonRegistrationManager tournamentId="t1" publicationId="pub1" />)
    const button = await screen.findByRole('button', { name: 'Freeze field and assign opening leagues' })
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I have reviewed the full field and want to lock these entrants.'))
    fireEvent.click(button)
    await screen.findByRole('status')
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ action: 'freeze', tournamentId: 't1', publicationId: 'pub1' })
  })
  it('shows frozen assignments and disables participant changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ board: { ...board, state: 'field_frozen', frozenField: { id: 'f1', manifestHash: 'abc', leagues: [{ key: 'one', name: 'Opening One', slots: 8, division: null, members: [{ id: 'p1', displayName: 'Manager One', draftSlot: 1, waiverPriority: 8 }] }] } } })))
    render(<SeasonRegistrationManager tournamentId="t1" publicationId="pub1" />)
    expect(await screen.findByRole('heading', { name: 'Opening field frozen' })).toBeInTheDocument()
    expect(screen.getByText('Draft slot 1: Manager One · waiver priority 8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Manager One' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Freeze field and assign opening leagues' })).not.toBeInTheDocument()
  })
})
