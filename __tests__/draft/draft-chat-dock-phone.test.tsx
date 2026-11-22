/**
 * Phone Chat tab (2026-10-29). Measured at Pixel 7 size before: a fixed 70dvh panel inside a 325px
 * half tray put the composer 506px down — off screen — under ~148px of headers (a CHAT collapse
 * bar, the title row, a two-line explainer). After: the panel fills the tray, the tray opens full,
 * the headers are 65px, and the message list gets 377px with the composer on screen.
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftChatDock } from '@/components/app/draft-room/DraftChatDock'

vi.mock('@/components/app/draft-room/DraftChatPanel', () => ({ DraftChatPanel: () => <div data-testid="chat-panel-stub" /> }))

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

async function dock() {
  await act(async () => {
    render(<DraftChatDock messages={[]} onSend={async () => {}} />)
  })
}

describe('DraftChatDock on a phone', () => {
  it('hides the CHAT collapse bar below md — the phone tab already says Chat', async () => {
    await dock()
    expect(classes(screen.getByTestId('draft-chat-dock-toggle'))).toContain('max-md:hidden')
  })

  it('still shows the conversation on a phone when a laptop collapsed it', async () => {
    window.localStorage.setItem('af-draft-chat-expanded', '0')
    window.localStorage.setItem('draftChatExpanded', '0')
    await dock()
    const toggle = screen.getByTestId('draft-chat-dock-toggle')
    if (toggle.getAttribute('aria-expanded') === 'true') toggle.click()
    await act(async () => {})
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Collapsed: hidden at md+, but rendered and shown below md.
    const content = screen.getByTestId('chat-panel-stub').parentElement!
    expect(classes(content)).toEqual(expect.arrayContaining(['hidden', 'max-md:block']))
    expect(classes(content.parentElement)).toEqual(expect.arrayContaining(['h-12', 'max-md:h-full', 'max-md:flex-1']))
  })
})
