import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressiveDraftPlayerList } from '@/components/app/draft-room/ProgressiveDraftPlayerList'
afterEach(cleanup)
const items = Array.from({ length: 562 }, (_, id) => ({ id, name: `Player ${id}` }))
function list(pool = items) {
  return <ProgressiveDraftPlayerList items={pool} itemKey={p => p.id} renderItem={p => <button data-testid="player">{p.name}</button>} />
}
describe('progressive draft card results', () => {
  it('bounds the initial full NBA pool without measuring row heights', () => {
    render(list())
    expect(screen.getAllByTestId('player')).toHaveLength(50)
    expect(screen.getByTestId('draft-player-load-more')).toHaveTextContent('50 of 562')
  })
  it('keeps every result reachable and removes the more button at the end', () => {
    render(list())
    for (let n = 0; n < 11; n++) fireEvent.click(screen.getByTestId('draft-player-load-more'))
    expect(screen.getAllByTestId('player')).toHaveLength(562)
    expect(screen.getByText('Player 561')).toBeVisible()
    expect(screen.queryByTestId('draft-player-load-more')).not.toBeInTheDocument()
  })
  it('resets expanded results when filtering, sorting or clearing a search', () => {
    const view = render(list())
    fireEvent.click(screen.getByTestId('draft-player-load-more'))
    expect(screen.getAllByTestId('player')).toHaveLength(100)
    view.rerender(list([items[561]]))
    expect(screen.getAllByTestId('player')).toHaveLength(1)
    expect(screen.getByText('Player 561')).toBeVisible()
    view.rerender(list(items))
    expect(screen.getAllByTestId('player')).toHaveLength(50)
    view.rerender(list([...items].reverse()))
    expect(screen.getAllByTestId('player')[0]).toHaveTextContent('Player 561')
  })
  it('preserves the expanded result count on an unrelated rerender', () => {
    const view = render(list())
    fireEvent.click(screen.getByTestId('draft-player-load-more'))
    view.rerender(list())
    expect(screen.getAllByTestId('player')).toHaveLength(100)
  })
})
