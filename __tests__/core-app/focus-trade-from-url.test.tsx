// @vitest-environment jsdom
/**
 * A trade email links to `/core/trades?league=…&trade=<id>`; the page must land ON that trade.
 * Before this, the link opened the Trades screen at the top with the trade three panels down.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFocusTradeFromUrl } from '@/components/core-app/useFocusTradeFromUrl'

function Rows({ ready = true }: { ready?: boolean }) {
  useFocusTradeFromUrl(ready)
  return (
    <ul>
      <li data-trade-id="T0">other</li>
      <li data-trade-id="T1">linked</li>
    </ul>
  )
}

const scrolled: string[] = []

beforeEach(() => {
  scrolled.length = 0
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push((this as HTMLElement).dataset.tradeId ?? '')
  })
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('useFocusTradeFromUrl', () => {
  it('scrolls to and marks the trade the link names', () => {
    window.history.replaceState(null, '', '/core/trades?league=af-B&trade=T1')
    const { getByText } = render(<Rows />)
    expect(getByText('linked').dataset.tradeFocused).toBe('true')
    expect(getByText('other').dataset.tradeFocused).toBeUndefined()
    expect(scrolled).toEqual(['T1'])
  })

  it('does nothing without a trade in the URL', () => {
    window.history.replaceState(null, '', '/core/trades?league=af-B')
    render(<Rows />)
    expect(scrolled).toEqual([])
  })

  it('waits until the list says its rows exist', () => {
    window.history.replaceState(null, '', '/core/trades?trade=T1')
    const { rerender, getByText } = render(<Rows ready={false} />)
    expect(scrolled).toEqual([])
    rerender(<Rows ready />)
    expect(getByText('linked').dataset.tradeFocused).toBe('true')
  })
})
