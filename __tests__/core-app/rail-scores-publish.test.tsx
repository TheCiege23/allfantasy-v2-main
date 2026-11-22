// @vitest-environment jsdom
/**
 * The rail's matchup scores reach the shell after it paints (components/core-app/railScores.tsx, 2026-11-22).
 * The shell renders with no scores; the page's RailScoresSlot publishes them once the rail's read lands.
 */
import { useState, type ReactNode } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PublishRailScores, RailScoresContext, withRailScores, type RailScores } from '@/components/core-app/railScores'

const scores = (week: number): RailScores => ({
  byLeague: { L1: { leagueId: 'L1' } as never },
  weekLabel: `Week ${week}`,
})

function Host({ children, onScores }: { children: ReactNode; onScores: (s: RailScores | null) => void }) {
  const [current, setCurrent] = useState<RailScores | null>(null)
  onScores(current)
  return <RailScoresContext.Provider value={setCurrent}>{children}</RailScoresContext.Provider>
}

describe('rail scores, published after the shell paints', () => {
  it('lays published scores over the shell props, and leaves them alone before anything is published', () => {
    const props = { railMatchups: undefined, railWeekLabel: null, other: 1 }
    expect(withRailScores(props, null)).toBe(props)
    expect(withRailScores(props, scores(12))).toEqual({ railMatchups: scores(12).byLeague, railWeekLabel: 'Week 12', other: 1 })
  })

  it('publishes once mounted, and keeps the last scores when the publisher unmounts (no blank rail on a tab click)', () => {
    let seen: RailScores | null = null
    const view = render(
      <Host onScores={(s) => { seen = s }}>
        <PublishRailScores {...scores(12)} />
      </Host>,
    )
    expect(seen).toEqual(scores(12))
    act(() => {
      view.rerender(<Host onScores={(s) => { seen = s }}>{null}</Host>)
    })
    expect(seen).toEqual(scores(12))
    act(() => {
      view.rerender(
        <Host onScores={(s) => { seen = s }}>
          <PublishRailScores {...scores(13)} />
        </Host>,
      )
    })
    expect(seen).toEqual(scores(13))
  })

  it('renders nothing and does not throw outside a shell', () => {
    const { container } = render(<PublishRailScores {...scores(12)} />)
    expect(container.innerHTML).toBe('')
  })
})
