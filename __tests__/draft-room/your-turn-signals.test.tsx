import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useYourTurnSignals, yourTurnTitle } from '@/components/app/draft-room/useYourTurnSignals'

const tones: number[] = []

class FakeAudio {
  currentTime = 0
  destination = {}
  createOscillator() {
    const o = { type: '', frequency: { value: 0 }, connect: () => {}, start: () => tones.push(o.frequency.value), stop: () => {} }
    return o
  }
  createGain() {
    return { connect: () => {}, gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }
  }
  close() {}
}

function Probe(props: Parameters<typeof useYourTurnSignals>[0]) {
  useYourTurnSignals(props)
  return null
}

beforeEach(() => {
  tones.length = 0
  document.title = 'Draft room · AllFantasy'
  window.localStorage.clear()
  ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudio
})
afterEach(() => cleanup())

describe('yourTurnTitle', () => {
  it('on the clock, the three picks before, and otherwise the page’s own title', () => {
    expect(yourTurnTitle('Room', true, 0)).toBe("⏰ YOU'RE ON THE CLOCK · Room")
    expect(yourTurnTitle('Room', false, 2)).toBe('(Up in 2) Room')
    expect(yourTurnTitle('Room', false, 4)).toBe('Room')
    expect(yourTurnTitle('Room', false, null)).toBe('Room')
  })
})

describe('useYourTurnSignals', () => {
  it('changes the tab title as the turn approaches, chimes once on the clock, and restores the title', () => {
    const p = { active: true, onClock: false, picksUntil: 2, pickLabel: '3.04' }
    const { rerender, unmount } = render(<Probe {...p} />)
    expect(document.title).toBe('(Up in 2) Draft room · AllFantasy')
    expect(tones).toHaveLength(0)

    rerender(<Probe {...p} onClock picksUntil={0} />)
    expect(document.title).toBe("⏰ YOU'RE ON THE CLOCK · Draft room · AllFantasy")
    expect(tones).toHaveLength(2) // one two-note chime
    rerender(<Probe {...p} onClock picksUntil={0} />)
    expect(tones).toHaveLength(2) // not again for the same pick
    // A paused-and-resumed clock on the same pick is the same turn: no second chime.
    rerender(<Probe {...p} active={false} onClock picksUntil={0} />)
    rerender(<Probe {...p} onClock picksUntil={0} />)
    expect(tones).toHaveLength(2)

    rerender(<Probe {...p} onClock={false} picksUntil={11} pickLabel="4.09" />)
    expect(document.title).toBe('Draft room · AllFantasy')
    rerender(<Probe {...p} onClock picksUntil={0} pickLabel="4.09" />)
    expect(tones).toHaveLength(4) // the next turn chimes again

    unmount()
    expect(document.title).toBe('Draft room · AllFantasy')
  })

  it('when the page rewrites its own title, ours goes back on top of the new one', async () => {
    render(<Probe active onClock picksUntil={0} pickLabel="2.04" />)
    expect(document.title.startsWith('⏰')).toBe(true)
    // What Next does as metadata streams in: replace the <title> text without document.title.
    let t = document.head.querySelector('title')
    if (!t) {
      t = document.createElement('title')
      document.head.appendChild(t)
    }
    t.textContent = 'Sample Snake League · Draft'
    await new Promise((r) => setTimeout(r, 0))
    expect(document.title).toBe("⏰ YOU'RE ON THE CLOCK · Sample Snake League · Draft")
  })

  it('the room’s mute switch silences the chime, not the title', () => {
    window.localStorage.setItem('af:draft-timer-mute', '1')
    render(<Probe active onClock picksUntil={0} pickLabel="1.01" />)
    expect(tones).toHaveLength(0)
    expect(document.title.startsWith('⏰')).toBe(true)
  })

  it('auto-drafting or not seated: nothing changes', () => {
    render(<Probe active={false} onClock picksUntil={0} pickLabel="1.01" />)
    expect(document.title).toBe('Draft room · AllFantasy')
    expect(tones).toHaveLength(0)
  })
})
