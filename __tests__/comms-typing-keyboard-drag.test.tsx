import React, { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { REANNOUNCE_MS, typingUrl, useTypingSignal } from '@/components/core-app/comms/useTypingSignal'
import { computeKeyboardViewport, KEYBOARD_MIN_INSET } from '@/app/chimmy/hooks/useVisibleViewportHeight'
import { useDraggableLauncher } from '@/components/core-app/comms/useDraggableLauncher'
import { launcherStorageKey } from '@/components/core-app/comms/launcherPosition'

/* ── Typing: the drawer now SENDS it, throttled ── */

describe('useTypingSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'))
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const bodies = () =>
    vi.mocked(fetch).mock.calls.map(([u, init]) => [String(u), JSON.parse(String((init as RequestInit).body))])

  it('announces once per window, not per keystroke', () => {
    const { result } = renderHook(() => useTypingSignal('t1'))
    result.current(true)
    result.current(true)
    result.current(true)
    expect(bodies()).toEqual([[typingUrl('t1'), { isTyping: true }]])
    vi.advanceTimersByTime(REANNOUNCE_MS + 1)
    result.current(true)
    expect(bodies()).toHaveLength(2)
  })

  it('says it stopped — once — and only if it had said it started', () => {
    const { result } = renderHook(() => useTypingSignal('t1'))
    result.current(false)
    expect(bodies()).toHaveLength(0)
    result.current(true)
    result.current(false)
    result.current(false)
    expect(bodies().map(([, b]) => b)).toEqual([{ isTyping: true }, { isTyping: false }])
  })

  it('tells the old room it stopped when the conversation changes', () => {
    const { result, rerender } = renderHook(({ id }) => useTypingSignal(id), { initialProps: { id: 't1' } })
    result.current(true)
    rerender({ id: 't2' })
    expect(bodies()).toEqual([
      [typingUrl('t1'), { isTyping: true }],
      [typingUrl('t1'), { isTyping: false }],
    ])
  })

  it('sends nothing with no conversation open', () => {
    const { result } = renderHook(() => useTypingSignal(null))
    result.current(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('addresses a league room by its virtual id', () => {
    expect(typingUrl('league:abc')).toBe('/api/shared/chat/threads/league%3Aabc/typing')
  })
})

/* ── The keyboard: the drawer pins to the visible region ── */

describe('computeKeyboardViewport', () => {
  const base = { visualHeight: 844, visualOffsetTop: 0, innerHeight: 844 }

  it('leaves the stylesheet alone without a keyboard', () => {
    expect(computeKeyboardViewport(base)).toBeNull()
    expect(computeKeyboardViewport({ ...base, visualHeight: 844 - (KEYBOARD_MIN_INSET - 1) })).toBeNull()
  })

  it('returns the visible region while a keyboard covers the screen', () => {
    expect(computeKeyboardViewport({ ...base, visualHeight: 508 })).toEqual({ top: 0, height: 508 })
  })

  it('follows iOS scrolling the visual viewport to reveal the field', () => {
    expect(computeKeyboardViewport({ ...base, visualHeight: 508, visualOffsetTop: 120 })).toEqual({ top: 120, height: 508 })
  })

  it('is not fooled by a pinch zoom, which also shrinks the visual viewport', () => {
    expect(computeKeyboardViewport({ ...base, visualHeight: 400, scale: 2 })).toBeNull()
  })
})

/* ── Dragging the bubble: a tap still opens it ── */

function Launcher({ onOpen }: { onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const drag = useDraggableLauncher(ref, true)
  const [n, setN] = useState(0)
  return (
    <button
      ref={ref}
      type="button"
      style={drag.style}
      data-dragging={drag.dragging || undefined}
      {...drag.handlers}
      onClick={() => {
        if (drag.consumeDragClick()) return
        setN(n + 1)
        onOpen()
      }}
    >
      chat
    </button>
  )
}

describe('useDraggableLauncher', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
  })

  it('a tap (no travel) opens the chat', () => {
    const onOpen = vi.fn()
    render(<Launcher onOpen={onOpen} />)
    const b = screen.getByRole('button')
    fireEvent.pointerDown(b, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 700 })
    fireEvent.pointerMove(b, { pointerId: 1, pointerType: 'touch', clientX: 302, clientY: 701 })
    fireEvent.pointerUp(b, { pointerId: 1, pointerType: 'touch', clientX: 302, clientY: 701 })
    fireEvent.click(b)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('a drag moves it, snaps to an edge, remembers it — and does NOT open the chat', () => {
    const onOpen = vi.fn()
    render(<Launcher onOpen={onOpen} />)
    const b = screen.getByRole('button')
    fireEvent.pointerDown(b, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 700 })
    fireEvent.pointerMove(b, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 500 })
    expect(b.getAttribute('data-dragging')).toBe('true')
    fireEvent.pointerMove(b, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 400 })
    fireEvent.pointerUp(b, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 400 })
    fireEvent.click(b)
    expect(onOpen).not.toHaveBeenCalled()
    expect(b.style.left).not.toBe('')
    expect(b.style.right).toBe('auto')
    const stored = JSON.parse(window.localStorage.getItem(launcherStorageKey('phone')) ?? 'null')
    expect(stored?.side).toBe('left')
  })

  it('keyboard activation is untouched', () => {
    const onOpen = vi.fn()
    render(<Launcher onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const onOpen = vi.fn()
    render(<Launcher onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
