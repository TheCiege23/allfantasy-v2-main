/**
 * Your Week board restyle (2026-11-05): the header progress bar and glance tiles count the week from
 * the loader's own `live` field — decided = both sides final, live = points but not final.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { YourWeekGlance, YourWeekProgressBar } from '@/components/core-app/YourWeekGlance'
import { yourWeekProgress } from '@/lib/core-app/yourWeekProgress'
import type { WeekMatchup } from '@/lib/core-app/weekBoard'

const game = (live: WeekMatchup['live']) => ({ live }) as WeekMatchup

describe('yourWeekProgress', () => {
  const data = {
    coinFlips: [game(null), game({ you: 50, them: 40, margin: 10, final: false })],
    leaning: [game({ you: 120, them: 90, margin: 30, final: true }), game(null)],
    unprojected: [game({ you: 80, them: 99, margin: -19, final: true })],
  }

  it('counts decided, live and not-started head-to-head games', () => {
    expect(yourWeekProgress(data)).toEqual({ headToHead: 5, decided: 2, live: 1, notStarted: 2, coinFlips: 2 })
  })

  it('draws "2 of 5 decided" and the four tiles', () => {
    const p = yourWeekProgress(data)
    render(<><YourWeekProgressBar progress={p} /><YourWeekGlance progress={p} /></>)
    expect(screen.getByTestId('your-week-progress').textContent).toContain('2 of 5 decided')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2')
    const tiles = [...screen.getByTestId('your-week-glance').querySelectorAll('.af-pg-stat-value')].map((n) => n.textContent)
    expect(tiles).toEqual(['2', '1', '2', '2'])
  })

  it('renders nothing with no head-to-head game rather than "0 of 0"', () => {
    const p = yourWeekProgress({ coinFlips: [], leaning: [], unprojected: [] })
    const { container } = render(<><YourWeekProgressBar progress={p} /><YourWeekGlance progress={p} /></>)
    expect(container.innerHTML).toBe('')
  })
})
