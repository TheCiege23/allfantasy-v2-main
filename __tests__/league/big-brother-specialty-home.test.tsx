// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))

import {
  bbPhaseStep,
  bigBrotherFeed,
  nextBigBrotherDecision,
  publicEvictionResult,
} from '@/lib/league-specialty/bigBrotherHome'
import {
  BigBrotherEvictionMoment,
  BigBrotherSpecialtyHome,
  NominationPicker,
  revealCounts,
  revealTicks,
} from '@/components/big-brother/BigBrotherSpecialtyHome'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('big brother home model', () => {
  it('maps every engine phase onto the six-step tracker', () => {
    expect(bbPhaseStep('HOH_OPEN')).toBe(0)
    expect(bbPhaseStep('NOMINATION_LOCKED')).toBe(1)
    expect(bbPhaseStep('VETO_CHALLENGE_OPEN')).toBe(2)
    expect(bbPhaseStep('REPLACEMENT_NOMINATION_OPEN')).toBe(3)
    expect(bbPhaseStep('VOTING_OPEN')).toBe(4)
    expect(bbPhaseStep('EVICTION_RESOLVED')).toBe(5)
    expect(bbPhaseStep(null)).toBe(-1)
  })

  it('next decision is the current phase deadline; during voting the vote close', () => {
    const cycle = { createdAt: '2026-10-11T12:00:00Z', voteDeadlineAt: '2026-10-16T00:00:00Z', voteOpenedAt: null, phase: 'VOTING_OPEN' }
    expect(nextBigBrotherDecision({}, cycle, new Date('2026-10-12T00:00:00Z'))).toEqual({
      label: 'Voting closes / eviction',
      at: '2026-10-16T00:00:00.000Z',
    })
    expect(nextBigBrotherDecision({}, cycle, new Date('2026-10-17T00:00:00Z'))).toBeNull()
  })

  it('🛑 the public eviction result carries no voter, and counts only when the league shows exact totals', () => {
    const meta = {
      cycleId: 'c1',
      week: 6,
      evictedRosterId: 'r9',
      voteCount: { r9: 5, r4: 3 },
      tied: false,
      juryEnrolled: true,
      releasedPlayerCount: 15,
      // Anything else on the row must not survive the copy.
      ballots: [{ voterRosterId: 'r1', targetRosterId: 'r9' }],
      voterRosterId: 'r1',
    }
    const exact = publicEvictionResult(meta, 'exact', { nomineeRosterIds: ['r4', 'r9'], nominatedByRosterId: 'r7' })!
    expect(exact).toEqual({
      week: 6,
      evictedRosterId: 'r9',
      nomineeRosterIds: ['r9', 'r4'],
      votesByNominee: { r9: 5, r4: 3 },
      tied: false,
      nominatedByRosterId: 'r7',
      juryEnrolled: true,
      releasedPlayerCount: 15,
    })
    expect(JSON.stringify(exact)).not.toContain('r1')
    const hidden = publicEvictionResult(meta, 'evicted_only')!
    expect(hidden.votesByNominee).toBeNull()
    expect(JSON.stringify(hidden)).not.toContain('r1')
    expect(publicEvictionResult({ week: 2 }, 'exact')).toBeNull()
  })

  it('feed reads cycles newest first', () => {
    const feed = bigBrotherFeed([
      { week: 5, hohRosterId: 'a', vetoWinnerRosterId: 'b', evictedRosterId: 'c' },
      { week: 6, hohRosterId: 'd', vetoWinnerRosterId: null, evictedRosterId: null },
    ])
    expect(feed.map((f) => f.id)).toEqual(['hoh-6', 'evict-5', 'veto-5', 'hoh-5'])
  })

  it('reveal runs up one vote at a time to the final count', () => {
    expect(revealTicks([5, 3])).toBe(5)
    expect(revealCounts([5, 3], 0)).toEqual([0, 0])
    expect(revealCounts([5, 3], 2)).toEqual([2, 1])
    expect(revealCounts([5, 3], 5)).toEqual([5, 3])
  })
})

const names: Record<string, string> = { r9: 'Open Team 9', r4: 'Open Team 4', r7: 'Open Team 7', r2: 'Open Team 2', me: 'TheCiege26' }
const nameOf = (id: string) => names[id] ?? id

describe('eviction night', () => {
  const eviction = {
    week: 6,
    evictedRosterId: 'r9',
    nomineeRosterIds: ['r9', 'r4'],
    votesByNominee: { r9: 5, r4: 3 },
    tied: false,
    nominatedByRosterId: 'r7',
    juryEnrolled: true,
    releasedPlayerCount: 15,
  }

  it('stays sealed until revealed, counts up 0.65s apart, then evicts', () => {
    vi.useFakeTimers()
    render(<BigBrotherEvictionMoment eviction={eviction} nameOf={nameOf} avatarOf={() => null} />)
    const moment = screen.getByTestId('bb-eviction-moment')
    expect(moment.getAttribute('data-state')).toBe('sealed')
    expect(screen.queryByText('EVICTED')).toBeNull()
    fireEvent.click(screen.getByTestId('bb-reveal-vote'))
    expect(moment.getAttribute('data-state')).toBe('counting')
    act(() => vi.advanceTimersByTime(650 * 2))
    expect(screen.getByTestId('bb-nominee-r9').textContent).toContain('2')
    act(() => vi.advanceTimersByTime(650 * 3))
    expect(moment.getAttribute('data-state')).toBe('revealed')
    expect(screen.getByText('EVICTED')).toBeTruthy()
    expect(screen.getByText('Open Team 9 is evicted, 5 votes to 3. Open Team 4 stays in the house.')).toBeTruthy()
    expect(screen.getByText(/joins the jury\. Their team stops scoring and all 15 players go to waivers\./)).toBeTruthy()
    fireEvent.click(screen.getByTestId('specialty-replay'))
    expect(moment.getAttribute('data-state')).toBe('sealed')
  })

  it('a league with private totals reveals the result only', () => {
    render(<BigBrotherEvictionMoment eviction={{ ...eviction, votesByNominee: null }} nameOf={nameOf} avatarOf={() => null} />)
    fireEvent.click(screen.getByTestId('bb-reveal-vote'))
    expect(screen.getByText('Open Team 9 is evicted. Open Team 4 stays in the house.')).toBeTruthy()
    expect(screen.queryByText('Votes to evict')).toBeNull()
    expect(screen.getByText(/keeps vote totals private/)).toBeTruthy()
  })
})

describe('HOH nominations (phone)', () => {
  it('needs exactly two, then locks them in through the existing route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const onLocked = vi.fn()
    render(<NominationPicker leagueId="L1" cycleId="c6" candidates={['r9', 'r4', 'r2']} nameOf={nameOf} avatarOf={() => null} onLocked={onLocked} />)
    const lock = screen.getByTestId('bb-lock-nominations') as HTMLButtonElement
    expect(lock.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Open Team 9/ }))
    fireEvent.click(screen.getByRole('button', { name: /Open Team 4/ }))
    // A third pick is refused while two are chosen.
    expect((screen.getByRole('button', { name: /Open Team 2/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(lock.textContent).toBe('Lock in Open Team 9 and Open Team 4')
    fireEvent.click(lock)
    await waitFor(() => expect(onLocked).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/L1/big-brother/nominations', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ cycleId: 'c6', nominee1RosterId: 'r9', nominee2RosterId: 'r4' })
  })
})

describe('BigBrotherSpecialtyHome', () => {
  it('wires hero, tracker, spotlight and houseguest tags to the summary', () => {
    render(
      <BigBrotherSpecialtyHome
        leagueId="L1"
        summary={{
          totalRosterCount: 5,
          remainingCount: 4,
          config: { sport: 'NFL', finaleFormat: 'final_2', juryStartMode: 'after_eliminations' },
          cycle: {
            id: 'c6', week: 6, phase: 'VETO_DECISION_OPEN', hohRosterId: 'r7', nominee1RosterId: 'r9', nominee2RosterId: 'r4',
            vetoWinnerRosterId: 'r2', vetoParticipantRosterIds: null, vetoUsed: false, vetoSavedRosterId: null,
            replacementNomineeRosterId: null, evictedRosterId: null, voteDeadlineAt: null, voteOpenedAt: null, closedAt: null,
          },
          finalNomineeRosterIds: ['r9', 'r4'],
          eligibility: null,
          jury: [],
          finalists: [],
          ballot: null,
          myRosterId: 'me',
          myStatus: 'SAFE',
          rosterDisplayNames: names,
          memoryWall: [
            { rosterId: 'r7', displayName: 'Open Team 7', avatarUrl: null, status: 'HOH' },
            { rosterId: 'me', displayName: 'TheCiege26', avatarUrl: null, status: 'SAFE' },
            { rosterId: 'r3', displayName: 'Open Team 3', avatarUrl: null, status: 'ELIMINATED' },
          ],
          home: { leagueName: 'Blah House', season: 2026, phaseStep: 3, nextDecision: null, lastEviction: null, feed: [] },
        }}
      />,
    )
    expect(screen.getAllByText('Blah House').length).toBeGreaterThan(0)
    expect(screen.getByText('5 houseguests · 4 in the house')).toBeTruthy()
    expect(screen.getByTestId('specialty-headline').textContent).toBe('Week 6 · Veto meeting')
    expect(screen.getByTestId('bb-phase-tracker').querySelector('[aria-current="step"]')?.textContent).toContain('Veto meeting')
    expect(screen.getByTestId('bb-spot-hoh').textContent).toContain('Open Team 7')
    expect(screen.getByTestId('bb-spot-veto').textContent).toContain('Open Team 2')
    const grid = screen.getByTestId('bb-houseguests')
    expect(grid.querySelector('[data-status="ELIMINATED"]')?.textContent).toContain('Evicted')
    expect(grid.textContent).toContain('You')
    expect(screen.queryByTestId('bb-eviction-moment')).toBeNull()
  })
})
