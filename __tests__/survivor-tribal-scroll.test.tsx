import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SurvivorVoteRevealScrolls, tallyMarks, voteOrdinal, type RevealScroll } from '@/components/league/survivor/SurvivorVoteRevealScrolls'

const read: RevealScroll[] = [
  { order: 1, targetName: 'Open Team 8', status: 'counts', isExtraVote: false },
  { order: 2, targetName: 'TheCiege26', status: 'counts', isExtraVote: false },
  { order: 3, targetName: 'Open Team 4', status: 'blocked_by_idol', isExtraVote: false },
  { order: 4, targetName: 'Open Team 8', status: 'counts', isExtraVote: true },
]
const slips = () => [...(screen.getByRole('list', { name: 'Votes read' }).querySelectorAll('li'))].map(li => li.textContent)

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('helpers', () => {
  it('names slips First vote … Last vote', () => {
    expect([0, 1, 2, 3].map(i => voteOrdinal(i, 4))).toEqual(['First vote', 'Second vote', 'Third vote', 'Last vote'])
    expect(voteOrdinal(0, 1)).toBe('Only vote')
    expect(voteOrdinal(21, 30)).toBe('Vote 22')
  })
  it('draws tally marks in groups of five', () => {
    expect(tallyMarks(0)).toBe('–')
    expect(tallyMarks(2)).toBe('||')
    expect(tallyMarks(7)).toBe('||||| ||')
  })
})

describe('Tribal Council scroll', () => {
  it('stays sealed with no vote on screen until the seal is broken', () => {
    render(<SurvivorVoteRevealScrolls scrolls={read} eliminatedName="Open Team 8" isTie={false} tiePhase={null} />)
    expect(screen.getByText('The votes are in')).toBeTruthy()
    expect(screen.queryByText(/Open Team|TheCiege26/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull()
  })

  it('reads one vote at a time, 2.5s apart, with a live tally, idol line, double vote and verdict', () => {
    render(<SurvivorVoteRevealScrolls scrolls={read} eliminatedName="Open Team 8" isTie={false} tiePhase={null} exileEnabled week={6} tribeName="Vela" />)
    fireEvent.click(screen.getByRole('button', { name: 'Break the seal' }))
    expect(screen.getByText('Week 6 · Tribe Vela')).toBeTruthy()
    expect(screen.getByText(/I.ll read the votes/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Read the first vote' })).toBeTruthy()

    act(() => { vi.advanceTimersByTime(1600) })
    expect(slips()).toEqual(['First voteOpen Team 8'])
    act(() => { vi.advanceTimersByTime(2499) })
    expect(slips()).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(1) })
    expect(slips()).toHaveLength(2)
    expect(screen.queryByText(/Immunity idol/)).toBeNull()

    // A tap reads the next one sooner.
    fireEvent.click(screen.getByRole('button', { name: 'Read the next vote' }))
    expect(slips()[2]).toBe('Third voteOpen Team 4Does not count')
    expect(screen.getByText('Immunity idol played by Open Team 4')).toBeTruthy()
    expect(screen.queryByText('Voted out')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Read the last vote' }))
    expect(slips()[3]).toBe('Last voteDouble voteOpen Team 8')
    expect(screen.getByText('Voted out')).toBeTruthy()
    expect(screen.getByText('2 votes to 1')).toBeTruthy()
    expect(screen.getByText('Heads to Exile Island with 0 tokens')).toBeTruthy()
    expect(screen.getByLabelText('0 votes').closest('div')?.textContent).toBe('Open Team 4–0')
    expect(screen.getByLabelText('2 votes').closest('div')?.textContent).toBe('Open Team 8||2')
    expect(document.body.textContent).not.toMatch(/voter/i)
  })

  it('all at once shows the full tally immediately', () => {
    render(<SurvivorVoteRevealScrolls revealMode="all_at_once" scrolls={read} eliminatedName="Open Team 8" isTie={false} tiePhase={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Break the seal' }))
    expect(slips()).toHaveLength(4)
    expect(screen.getByText('Voted out')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Read the/ })).toBeNull()
  })

  it('Replay rolls the scroll back up to the seal', () => {
    render(<SurvivorVoteRevealScrolls revealMode="all_at_once" scrolls={read} eliminatedName="Open Team 8" isTie={false} tiePhase={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Break the seal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(screen.queryByText(/Open Team/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Break the seal' })).toBeTruthy()
  })

  it('waits for the server instead of inventing votes it has not been sent', () => {
    const more = vi.fn()
    render(<SurvivorVoteRevealScrolls scrolls={read.slice(0, 1)} totalSteps={4} eliminatedName={null} isTie={false} tiePhase={null} onRequestMore={more} nextStepAt={new Date(Date.now() + 1000).toISOString()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Break the seal' }))
    act(() => { vi.advanceTimersByTime(1600) })
    expect(slips()).toHaveLength(1)
    const wait = screen.getByRole('button', { name: 'Waiting for the next vote…' }) as HTMLButtonElement
    expect(wait.disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(more).toHaveBeenCalled()
    expect(screen.queryByText('Voted out')).toBeNull()
  })

  it('shows a tie without naming anyone', () => {
    render(<SurvivorVoteRevealScrolls revealMode="all_at_once" scrolls={read.slice(0, 2)} eliminatedName={null} isTie tiePhase="revote_required" />)
    fireEvent.click(screen.getByRole('button', { name: 'Break the seal' }))
    expect(screen.getByText(/The vote is tied/)).toBeTruthy()
    expect(screen.queryByText('Voted out')).toBeNull()
  })
})
