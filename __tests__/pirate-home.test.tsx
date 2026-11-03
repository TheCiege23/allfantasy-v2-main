import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PirateHome } from '@/components/pirate/PirateHome'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Pirate Deck', () => {
  const players = ['Alex Starter', 'Blake Bench', 'Casey Reserve'].map((playerName, i) => ({
    id: String(i), playerId: String(i), playerName, position: 'QB', team: 'GB', slotType: ['QB', 'BENCH', 'IR'][i],
  }))
  function deck() {
    return {
      league: { id: 'league', name: 'Sea Wolves', sport: 'NFL', rosterLimit: 4 },
      rules: { protectionLimit: 2, claimHours: 24 },
      season: { playoffStartWeek: 15 }, week: 9,
      lockAt: new Date(Date.now() + 60 * 60000).toISOString(),
      canEditProtections: true, myRosterId: 'mine',
      rosters: [{ id: 'mine', ownerId: 'owner', ownerName: 'Captain', teamName: null, players }],
      protections: [{ rosterId: 'mine', week: 9, status: 'active', playerIds: ['0'] }],
      lineupRulings: [], lineupPreviews: {}, claims: [] as Array<Record<string, unknown>>,
    }
  }

  it('distinguishes saved and unsaved protections, enforces capacity and saves an IR lock', async () => {
    const initial = deck()
    const next = { ...initial, protections: [{ ...initial.protections[0], playerIds: ['0', '2'] }] }
    const json = (value: unknown) => ({ ok: true, json: async () => value })
    const fetcher = vi.fn().mockResolvedValueOnce(json(initial)).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json(next))
    vi.stubGlobal('fetch', fetcher)
    render(<PirateHome leagueId="league" isCommissioner={false} />)
    expect(await screen.findByRole('heading', { name: 'Your protections are saved' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Manage protections' }).getAttribute('href')).toBe('#pirate-protections')
    expect(screen.getByText('1 of 2 protected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Alex Starter' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Casey Reserve' }))
    expect(screen.getByText('Lock unsaved')).toBeTruthy()
    expect(screen.getByText('1 of 2 protected · 2 selected, unsaved')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Blake Bench' }))
    expect(screen.getByRole('alert').textContent).toContain('Only 2 players')
    fireEvent.click(screen.getByRole('button', { name: 'Save protection locks' }))
    expect(await screen.findByText('2 of 2 protected')).toBeTruthy()
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ rosterId: 'mine', week: 9, playerIds: ['0', '2'] })
  })

  it('shows the most urgent personal claim and links to that exact claim', async () => {
    const data = deck()
    const soon = new Date(Date.now() + 5 * 60000).toISOString()
    data.claims = [
      { id: 'unrelated', winnerRosterId: 'other', loserRosterId: 'other2', status: 'pending', week: 8, deadlineAt: soon },
      { id: 'win', winnerRosterId: 'mine', loserRosterId: 'other', status: 'awaiting_selection', week: 8, selectionDeadlineAt: data.lockAt },
      { id: 'loss', winnerRosterId: 'other', loserRosterId: 'mine', status: 'pending', playerId: '0', week: 8, deadlineAt: soon },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }))
    render(<PirateHome leagueId="league" isCommissioner={false} />)
    expect(await screen.findByRole('heading', { name: 'Respond to a claim' })).toBeTruthy()
    expect(screen.getByText('Alex Starter transfers automatically if you don’t respond.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open claim' }).getAttribute('href')).toBe('#pirate-claim-loss')
    expect(screen.getByText('1 more claim needs your attention.')).toBeTruthy()
  })

  it('shows a verified lineup option to the manager and keeps the review queue commissioner-only', async () => {
    const base = deck()
    const data = { ...base, preLockAdvice: { week: 9, scoringDay: null, deadlineAt: base.lockAt,
      issues: ['QB: Alex Starter is OUT'], moves: [{ playerName: 'Blake Bench', slot: 'QB' }] },
    claims: [{ id: 'expired', week: 8, winnerRosterId: 'mine', loserRosterId: 'rival', status: 'selection_expired' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }))
    const view = render(<PirateHome leagueId="league" isCommissioner={false} />)
    expect(await screen.findByRole('heading', { name: 'Fix your starting lineup' })).toBeTruthy()
    expect(screen.getByText('Start Blake Bench at QB.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open your lineup' }).getAttribute('href')).toBe('/league/league?view=roster')
    expect(screen.queryByRole('heading', { name: /Needs attention/ })).toBeNull()
    view.rerender(<PirateHome leagueId="league" isCommissioner />)
    expect(screen.getByRole('heading', { name: 'Needs attention · 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Review claim' }).getAttribute('href')).toBe('#pirate-claim-expired')
  })

  it('keeps saved protections visible and blocks stale editing after the first game locks', async () => {
    const data = deck()
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => data })
    vi.stubGlobal('fetch', fetcher)
    render(<PirateHome leagueId="league" isCommissioner={false} />)
    const row = await screen.findByRole<HTMLButtonElement>('button', { name: 'Alex Starter' })
    fireEvent.click(screen.getByRole('button', { name: 'Casey Reserve' }))
    expect(screen.getByText('Lock unsaved')).toBeTruthy()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(data.lockAt))
    act(() => window.dispatchEvent(new Event('focus')))
    expect(row.disabled).toBe(true)
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Casey Reserve' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(/unsaved changes didn’t apply/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save protection locks' })).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([null, 'Bench Player', 'joint'])('shows commissioner recovery and the exact verified pickup option (drop: %s)', async (dropPlayerName) => {
    const joint = dropPlayerName === 'joint'
    const dashboard = {
      league: { id: 'league', name: 'Sea Wolves', sport: 'NFL', rosterLimit: 1 },
      rules: { protectionLimit: 3, claimHours: 24, playoffClaims: false },
      season: { playoffStartWeek: 15 },
      week: 9,
      lockAt: '2026-10-29T16:00:00.000Z',
      canEditProtections: false,
      myRosterId: 'winner',
      rosters: [
        { id: 'winner', ownerId: 'commissioner', ownerName: 'Captain', teamName: 'Sea Wolves', players: [
          { id: 'a', playerId: 'a', playerName: 'First Player', position: 'WR', team: 'A', slotType: 'BENCH' },
          { id: 'b', playerId: 'b', playerName: 'Second Player', position: 'RB', team: 'B', slotType: 'BENCH' },
        ] },
        { id: 'loser', ownerId: 'other', ownerName: 'Rival', teamName: 'The Rivals', players: [
          { id: 'c', playerId: 'c', playerName: 'Claimable Player', position: 'QB', team: 'C', slotType: 'BENCH' },
        ] },
      ],
      protections: [],
      lineupRulings: [{ claimId: 'claim', source: 'automatic', decision: 'forfeit', reason: 'A legal lineup was available from a verified pickup.' }],
      lineupEvidence: { claim: { decision: 'forfeit', reason: 'One verified pickup could complete the lineup.', issues: ['QB: 1 empty'],
        eventAt: '2026-10-26T00:20:00Z', snapshotCount: 2, snapshot: { capturedAt: '2026-10-26T00:22:00Z',
          injurySyncAt: '2026-10-26T00:15:00Z', lineupCertified: true, waiverWitnessCount: 1,
          scoringDay: joint ? '2026-10-25' : null,
          movePlans: joint ? [{ checkedAt: '2026-10-26T00:18:00Z', steps: [
            { kind: 'pickup', playerName: 'Verified Free QB', fromSlot: null, dropPlayerName: 'Bench Player' },
            { kind: 'activate', playerName: 'Reserve Player', fromSlot: 'TAXI', dropPlayerName: null },
          ] }] : [], players: [
            { playerId: 'free-qb', playerName: 'Verified Free QB', slotType: 'WAIVER', injuryStatus: null,
              kickoffAt: '2026-10-26T00:20:00Z', availabilityKnown: true, waiverVerified: true, dropPlayerName, jointPlanOnly: joint },
          ] } } },
      claims: [{ id: 'claim', week: 8, winnerRosterId: 'winner', loserRosterId: 'loser', playerId: null,
        offeredPlayerId: null, counterPlayerId: null, status: 'awaiting_selection', deadlineAt: null,
        transferredAt: null, resolutionNote: null }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => dashboard }))
    render(<PirateHome leagueId="league" isCommissioner />)
    await waitFor(() => expect(screen.getByText(/free 1 spot before another acquisition/i)).toBeTruthy())
    expect(screen.getByText('Commissioner review')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start response window' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Void claim' })).toBeTruthy()
    expect(screen.getByText(/Automatic lineup ruling/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Captured lineup evidence/))
    expect(screen.getByText('Verified Free QB')).toBeTruthy()
    expect(screen.getByText(joint ? /Available only as part of the verified move plan/ : dropPlayerName ? /add this player and drop Bench Player/ : /Verified immediate pickup before this lock/)).toBeTruthy()
    expect(screen.getByText(/Evidence collection does not move players/)).toBeTruthy()
    if (joint) {
      expect(screen.getByText(/Daily lineup: 2026-10-25/)).toBeTruthy()
      expect(screen.getByText(/Activate Reserve Player from TAXI/)).toBeTruthy()
      expect(screen.getByText(/Add Verified Free QB and drop Bench Player/)).toBeTruthy()
    }
  })
})
