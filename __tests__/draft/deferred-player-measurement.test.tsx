import React, { StrictMode, useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measurePlayerRow, useDeferredPlayerMeasurement } from '@/components/app/draft-room/useDeferredPlayerMeasurement'

let frames: Map<number, FrameRequestCallback>
let nextFrame: number
beforeEach(() => {
  frames = new Map()
  nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function flush() {
  const batch = [...frames.values()]
  frames.clear()
  act(() => { for (const cb of batch) cb(0) })
}
function Rows({ name, measure }: { name: string; measure: (node: Element | null) => void }) {
  const ref = useDeferredPlayerMeasurement(measure)
  return <div key={name} ref={ref}>{name}</div>
}
describe('mobile virtual player measurements', () => {
  it('does not synchronously update React while committing a row, even when measurement rerenders the list', () => {
    const measure = vi.fn()
    function List() {
      const [count, setCount] = useState(0)
      // The measurement callback changes on each render, like virtualizer adapter options.
      return <><span data-testid="count">{count}</span><Rows name="Jokic" measure={node => { measure(node); setCount(n => n + 1) }} /></>
    }
    render(<List />)
    expect(measure).not.toHaveBeenCalled()
    flush()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    flush()
    expect(measure).toHaveBeenCalledTimes(1)
  })
  it('measures the replacement player after filtering and skips the detached old row', () => {
    const measure = vi.fn()
    const view = render(<Rows name="Gordon" measure={measure} />)
    view.rerender(<Rows name="Jokic" measure={measure} />)
    flush()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measure.mock.calls[0][0]).toHaveTextContent('Jokic')
  })
  it('cancels pending work on unmount, including StrictMode cleanup', () => {
    const measure = vi.fn()
    const view = render(<StrictMode><Rows name="Jokic" measure={measure} /></StrictMode>)
    view.unmount()
    flush()
    expect(measure).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })
  it.each([71.49, 71.51, 95.75])('uses consistent CSS height at fractional zoom (%s)', height => {
    const node = document.createElement('div')
    Object.defineProperty(node, 'offsetHeight', { value: height + 2 })
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect)
    expect(measurePlayerRow(node)).toBe(Math.round(height))
  })
})
