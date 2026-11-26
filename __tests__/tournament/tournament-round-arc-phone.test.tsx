// @vitest-environment jsdom
/**
 * Tournament Home's round arc fits a phone (2026-11-24, left from the Tournament audit). The row carried
 * `min-w-[520px]` inside a panel ~358px wide at 390, so it scrolled sideways inside `overflow-x-auto` and the
 * last round and the trophy sat off-screen with no cue. The row now shrinks and a long round name wraps.
 * The browser measurement (no hidden width at 390/820/1440) is in the PR; jsdom has no layout.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RoundProgressBar } from '@/app/tournament/components/RoundProgressBar'

afterEach(cleanup)

const rounds = [
  { id: 'r1', roundNumber: 1, roundType: 'opening', roundLabel: 'Opening Round', weekStart: 1, weekEnd: 8, status: 'active' },
  { id: 'r2', roundNumber: 2, roundType: 'elite', roundLabel: 'Elite Eight', weekStart: 9, weekEnd: 13, status: 'upcoming' },
  { id: 'r3', roundNumber: 3, roundType: 'final', roundLabel: 'Championship', weekStart: 14, weekEnd: 17, status: 'upcoming' },
] as never

describe('Tournament round arc on a phone', () => {
  it('has no fixed minimum width and no sideways scroll to hide rounds in', () => {
    const { container } = render(<RoundProgressBar rounds={rounds} currentRoundNumber={1} remainingByRound={{ 1: 32 }} />)
    const panel = screen.getByTestId('tournament-round-arc')
    expect(panel.className.split(/\s+/)).not.toContain('overflow-x-auto')
    const fixed = [...container.querySelectorAll('*')].flatMap((e) => (e.getAttribute('class') ?? '').split(/\s+/)).filter((c) => /^min-w-\[/.test(c))
    expect(fixed).toEqual([])
  })
  it('every round and the trophy are drawn, and a round box can grow to two lines', () => {
    const { container } = render(<RoundProgressBar rounds={rounds} currentRoundNumber={1} remainingByRound={{ 1: 32 }} />)
    for (const label of ['Opening Round', 'Elite Eight', 'Championship']) expect(container.textContent).toContain(label)
    expect(container.textContent).toContain('🏆')
    const boxes = [...container.querySelectorAll('.rounded-lg')]
    const box = boxes.find((d) => (d.textContent ?? '').includes('Championship'))
    expect(box, 'the Championship box').toBeTruthy()
    expect(boxes.length).toBe(3)
    expect(box.className.split(/\s+/)).toContain('min-h-10')
    expect(box.className.split(/\s+/)).not.toContain('h-10')
  })
})
