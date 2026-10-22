// @vitest-environment jsdom
/**
 * The Survivor, Big Brother, IDP and Devy/C2C first-entry intros are full-screen modals over the
 * league page. On Android they could trap an invitee: the card did not scroll (its bottom button
 * sat below a phone screen), and the only other exit was the video's `ended` event, which never
 * fires when autoplay is blocked. Each must offer a pinned close button, close on Escape, and not
 * reappear on every visit when localStorage throws.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SurvivorFirstEntryModal } from '@/components/survivor/SurvivorFirstEntryModal'
import { BigBrotherFirstEntryModal } from '@/components/big-brother/BigBrotherFirstEntryModal'
import { IDPFirstEntryModal } from '@/components/idp/IDPFirstEntryModal'
import { DevyFirstEntryModal } from '@/components/devy/DevyFirstEntryModal'

type ModalCase = {
  name: string
  closeTestId: string
  render: (leagueId: string, onClose: () => void) => React.ReactElement
}

const CASES: ModalCase[] = [
  { name: 'Survivor', closeTestId: 'survivor-intro-close', render: (id, onClose) => <SurvivorFirstEntryModal leagueId={id} userId="u1" enabled onClose={onClose} /> },
  { name: 'Big Brother', closeTestId: 'bb-intro-close', render: (id, onClose) => <BigBrotherFirstEntryModal leagueId={id} userId="u1" enabled onClose={onClose} /> },
  { name: 'IDP', closeTestId: 'idp-intro-close', render: (id, onClose) => <IDPFirstEntryModal leagueId={id} userId="u1" enabled onClose={onClose} /> },
  { name: 'Devy', closeTestId: 'devy-intro-close', render: (id, onClose) => <DevyFirstEntryModal leagueId={id} userId="u1" enabled onClose={onClose} /> },
  { name: 'C2C', closeTestId: 'devy-intro-close', render: (id, onClose) => <DevyFirstEntryModal leagueId={id} userId="u1" enabled mode="c2c" onClose={onClose} /> },
]

describe.each(CASES)('$name first-entry intro on Android', (c) => {
  let n = 0
  const nextLeague = () => `L-${c.name}-${++n}`

  beforeEach(() => window.localStorage.clear())
  afterEach(() => cleanup())

  it('scrolls, so the bottom button is reachable on a short screen', () => {
    render(c.render(nextLeague(), vi.fn()))
    expect(screen.getByRole('dialog').className).toContain('overflow-y-auto')
  })

  it('has a pinned close button that dismisses and marks the intro seen', () => {
    const id = nextLeague()
    const onClose = vi.fn()
    const first = render(c.render(id, onClose))
    fireEvent.click(screen.getByTestId(c.closeTestId))
    expect(onClose).toHaveBeenCalledTimes(1)
    first.unmount()
    render(c.render(id, onClose))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(c.render(nextLeague(), onClose))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not reappear on every visit when localStorage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    try {
      const id = nextLeague()
      const first = render(c.render(id, vi.fn()))
      fireEvent.click(screen.getByTestId(c.closeTestId))
      first.unmount()
      render(c.render(id, vi.fn()))
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
