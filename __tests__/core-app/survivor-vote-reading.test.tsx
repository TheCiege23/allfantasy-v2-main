import { act, cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SurvivorScrollRevealStep, SurvivorSummary } from '@/components/survivor/types'
import { READING_POLL_MS, SurvivorIslandBanner } from '@/components/core-app/survivor/SurvivorIslandBanner'
import { SurvivorVoteReading } from '@/components/core-app/survivor/SurvivorVoteReading'
import { readingTally, shouldPollReading, voteReadingView } from '@/lib/core-app/survivorVoteReading'

/** The Tribal Council vote reading on a Survivor league's Camp banner. */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type Council = NonNullable<SurvivorSummary['council']>

function summary(over: Partial<SurvivorSummary> = {}): SurvivorSummary {
  return {
    leagueName: 'The Outcast Isles',
    config: {} as SurvivorSummary['config'],
    seasonCalendar: { firstWeek: 1, lastWeek: 17, sport: 'NFL', sportsSupported: ['NFL'] },
    currentWeek: 7,
    tribes: [
      { id: 'tA', name: 'Vela', colorHex: '#3f9fc4', slotIndex: 0, members: [{ rosterId: 'r1', isLeader: false }, { rosterId: 'r2', isLeader: false }] },
      { id: 'tB', name: 'Koro', colorHex: null, slotIndex: 1, members: [{ rosterId: 'r3', isLeader: false }, { rosterId: 'r4', isLeader: false }, { rosterId: 'r5', isLeader: false }] },
    ],
    council: null,
    challenges: [],
    jury: [],
    exileLeagueId: null,
    exileTokens: [],
    votedOutHistory: [],
    merged: false,
    myRosterId: 'r1',
    myTribeId: 'tA',
    myIdols: [],
    rosterDisplayNames: { r1: 'Coach T', r2: 'Dana', r3: 'Andre', r4: 'Sofia', r5: 'Ray' },
    ...over,
  }
}

const step = (order: number, targetName: string | null, status: SurvivorScrollRevealStep['status'] = 'counts', isExtraVote = false): SurvivorScrollRevealStep =>
  ({ order, targetName, status, isExtraVote })

/** The full read the server will release, one ballot at a time. Voters are never part of it. */
const FULL: SurvivorScrollRevealStep[] = [
  step(1, 'Andre'),
  step(2, 'Sofia'),
  step(3, 'Andre', 'blocked_by_idol'),
  step(4, 'Sofia', 'counts', true),
  step(5, 'Ray', 'late_does_not_count'),
]

/** A council as the summary returns it after `released` of the ballots are out. */
function reading(released: number, over: Partial<Council> = {}): Council {
  const done = released >= FULL.length
  return {
    id: 'c1', week: 7, phase: 'revealing', attendingTribeId: 'tB', voteDeadlineAt: '2026-11-03T15:00:00Z', closedAt: null, eliminatedRosterId: null,
    isRevealed: true,
    revealSequence: FULL.slice(0, released),
    revealTotalSteps: FULL.length,
    revealComplete: done,
    revealNextStepAt: done ? null : '2026-11-03T15:00:10Z',
    // The gate withholds the verdict until the last ballot is out.
    eliminatedName: done ? 'Sofia' : null,
    isTie: false,
    ...over,
  }
}

describe('readingTally', () => {
  it('counts only ballots that count, keeps cancelled names at 0 in reading order, and marks the leaders', () => {
    expect(readingTally(FULL)).toEqual([
      { name: 'Andre', count: 1, leading: false },
      { name: 'Sofia', count: 2, leading: true },
      { name: 'Ray', count: 0, leading: false },
    ])
    expect(readingTally(FULL.slice(0, 2)).map((r) => r.leading)).toEqual([true, true])
    expect(readingTally([step(1, 'Ray', 'target_safe')])).toEqual([{ name: 'Ray', count: 0, leading: false }])
    expect(readingTally([step(1, null)])).toEqual([])
  })
})

describe('voteReadingView', () => {
  it('shows nothing before the council is published, or once the league has moved to a later week', () => {
    expect(voteReadingView(null)).toBeNull()
    expect(voteReadingView(summary())).toBeNull()
    expect(voteReadingView(summary({ council: reading(0, { isRevealed: false, revealSequence: null }) }))).toBeNull()
    expect(voteReadingView(summary({ currentWeek: 8, council: reading(5) }))).toBeNull()
  })

  it('reads the latest released ballot and its status, and never a verdict mid-read', () => {
    const v = voteReadingView(summary({ council: reading(3) }))!
    expect(v).toMatchObject({ week: 7, tribeName: 'Koro', total: 5, released: 3, complete: false, verdict: null })
    expect(v.latest).toEqual({ position: 3, targetName: 'Andre', status: 'blocked_by_idol', counts: false, isExtraVote: false })
    expect(v.tally.map((r) => [r.name, r.count])).toEqual([['Andre', 1], ['Sofia', 1]])
  })

  it('names the voted-out castaway with the margin once every ballot is out', () => {
    const v = voteReadingView(summary({ council: reading(5) }))!
    expect(v.complete).toBe(true)
    expect(v.verdict).toEqual({ kind: 'out', name: 'Sofia', votes: 2, nextBest: 1 })
    expect(voteReadingView(summary({ council: reading(5, { eliminatedName: null, isTie: true }) }))!.verdict).toEqual({ kind: 'tie' })
    expect(voteReadingView(summary({ council: reading(5, { eliminatedName: null }) }))!.verdict).toEqual({ kind: 'none' })
  })

  it('withholds the verdict when the payload says complete but ballots are still missing', () => {
    // Defence in depth: a verdict must never run ahead of the ballots actually in hand.
    const v = voteReadingView(summary({ council: reading(3, { revealComplete: true, eliminatedName: 'Sofia' }) }))!
    expect(v.complete).toBe(false)
    expect(v.verdict).toBeNull()
  })

  it('waits for the first ballot without inventing one', () => {
    const v = voteReadingView(summary({ council: reading(0) }))!
    expect(v).toMatchObject({ released: 0, total: 5, latest: null, tally: [], verdict: null })
  })
})

describe('shouldPollReading', () => {
  it('polls only while a published read is in progress this week', () => {
    expect(shouldPollReading(summary({ council: reading(2) }))).toBe(true)
    expect(shouldPollReading(summary({ council: reading(5) }))).toBe(false)
    expect(shouldPollReading(summary({ council: reading(2, { isRevealed: false }) }))).toBe(false)
    expect(shouldPollReading(summary({ council: reading(2, { revealComplete: undefined }) }))).toBe(false)
    expect(shouldPollReading(summary({ currentWeek: 8, council: reading(2) }))).toBe(false)
    expect(shouldPollReading(summary())).toBe(false)
  })
})

describe('SurvivorVoteReading', () => {
  it('renders the latest parchment ballot, the tally pips and the status in words — and no more than was released', () => {
    const { container } = render(<SurvivorVoteReading summary={summary({ council: reading(4) })} />)
    const ballot = screen.getByTestId('survivor-ballot')
    expect(ballot.textContent).toContain('Vote 4 of 5')
    expect(ballot.textContent).toContain('Sofia')
    expect(ballot.textContent).toContain('Extra vote')
    expect(screen.getByText('4 of 5 votes read')).toBeTruthy()
    const rows = [...container.querySelectorAll('.sv-tally li')]
    expect(rows.map((li) => [li.querySelector('.sv-tally-name')?.textContent, li.querySelectorAll('.sv-pips i').length])).toEqual([['Andre', 1], ['Sofia', 2]])
    // Ray's late ballot is the fifth and has not been released: his name must not appear anywhere.
    expect(container.textContent).not.toContain('Ray')
    expect(screen.queryByTestId('survivor-tribe-has-spoken')).toBeNull()
  })

  it('words a cancelled ballot clearly', () => {
    render(<SurvivorVoteReading summary={summary({ council: reading(3) })} />)
    expect(screen.getByTestId('survivor-ballot').getAttribute('data-void')).toBe('true')
    expect(screen.getByText('Blocked by an idol · this vote doesn’t count')).toBeTruthy()
  })

  it('says the tribe has spoken once the read is complete, or that the vote is tied', () => {
    render(<SurvivorVoteReading summary={summary({ council: reading(5) })} />)
    const spoken = screen.getByTestId('survivor-tribe-has-spoken')
    expect(spoken.textContent).toContain('The tribe has spoken')
    expect(spoken.textContent).toContain('Sofia has been voted out')
    expect(spoken.textContent).toContain('2 votes to 1')
    expect(screen.getByText('Cast late · this vote doesn’t count')).toBeTruthy()
    cleanup()
    render(<SurvivorVoteReading summary={summary({ council: reading(5, { eliminatedName: null, isTie: true }) })} />)
    expect(screen.getByTestId('survivor-tribe-has-spoken').textContent).toContain('The vote is tied')
  })

  it('renders nothing when there is no read to show', () => {
    const { container } = render(<SurvivorVoteReading summary={summary()} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('the Camp banner', () => {
  const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }) }

  it('shows the reading after the tribe board, refreshes it every 10s while it is in progress, and stops once complete', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const pages = [reading(2), reading(3), reading(5)]
    let call = 0
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(summary({ council: pages[Math.min(call++, pages.length - 1)] })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<SurvivorIslandBanner leagueId="L1" leagueName="Isles" />)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('survivor-ballot').textContent).toContain('Vote 2 of 5')
    // After the tribe board.
    const board = container.querySelector('.sv-tribes')!.closest('section')!
    expect(board.compareDocumentPosition(screen.getByTestId('survivor-vote-reading')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await act(async () => { vi.advanceTimersByTime(READING_POLL_MS) })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('survivor-ballot').textContent).toContain('Vote 3 of 5')

    await act(async () => { vi.advanceTimersByTime(READING_POLL_MS) })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('survivor-tribe-has-spoken').textContent).toContain('Sofia has been voted out')

    // Complete: no more polling.
    await act(async () => { vi.advanceTimersByTime(READING_POLL_MS * 3) })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not poll outside a reading, and keeps the read on screen if a refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const quiet = vi.fn(async () => new Response(JSON.stringify(summary()), { status: 200 }))
    vi.stubGlobal('fetch', quiet)
    render(<SurvivorIslandBanner leagueId="L1" leagueName="Isles" />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(READING_POLL_MS * 3) })
    await flush()
    expect(quiet).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('survivor-vote-reading')).toBeNull()
    cleanup()

    let call = 0
    const flaky = vi.fn(async () => (call++ === 0 ? new Response(JSON.stringify(summary({ council: reading(2) })), { status: 200 }) : new Response('{}', { status: 500 })))
    vi.stubGlobal('fetch', flaky)
    render(<SurvivorIslandBanner leagueId="L1" leagueName="Isles" />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(READING_POLL_MS) })
    await flush()
    expect(flaky).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('survivor-ballot').textContent).toContain('Vote 2 of 5')
  })

  it('does not render the reading on the compact banner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(summary({ council: reading(5) })), { status: 200 })))
    render(<SurvivorIslandBanner leagueId="L1" leagueName="Isles" variant="compact" />)
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    expect(screen.queryByTestId('survivor-vote-reading')).toBeNull()
  })
})

describe('styles', () => {
  const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-survivor-theme.css'), 'utf8')
  it('writes the ballot name in a handwritten font stack and turns the reveal animation off for reduced motion', () => {
    expect(css).toMatch(/\.sv-ballot-name \{[^}]*font-family: 'Caveat', 'Bradley Hand'[^}]*cursive/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.af-core \.sv-ballot, \.af-core \.sv-spoken \{ animation: none; \}/)
  })
})
