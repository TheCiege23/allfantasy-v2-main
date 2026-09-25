import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * The floating light/dark pill stays off /chimmy/chat. That page is the chat drawer's Chimmy tab at
 * full screen and, like the drawer, always dark — so the pill changed nothing there, and on a phone
 * it floated over the conversation just above the composer (and over the old page's shortcut popup).
 * Elsewhere outside /core (which has its own rule) it still renders.
 */

const pathname = vi.hoisted(() => ({ current: '/core' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }))
vi.mock('@/components/theme/ModeToggle', () => ({
  ModeToggle: () => <button type="button">Theme</button>,
}))

import { GlobalModeToggle } from '@/components/theme/GlobalModeToggle'

afterEach(() => cleanup())

describe('GlobalModeToggle on the full-page Chimmy', () => {
  it('is absent on /chimmy/chat', () => {
    pathname.current = '/chimmy/chat'
    render(<GlobalModeToggle />)
    expect(screen.queryByRole('button', { name: 'Theme' })).toBeNull()
  })

  // (/core hides it too, by its own rule — it carries the switch in its top bar.)
  it('still renders on the /chimmy landing and other pages', () => {
    for (const p of ['/chimmy', '/pricing', '/chimmy-chat-lookalike']) {
      pathname.current = p
      const { unmount } = render(<GlobalModeToggle />)
      expect(screen.getByRole('button', { name: 'Theme' }), p).toBeInTheDocument()
      unmount()
    }
  })
})
