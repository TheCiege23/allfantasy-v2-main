import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatComposer,
  INLINE_PICKER_MIN_ROOM,
  floatingPickerBox,
} from '@/app/dashboard/components/chat/ChatComposer'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

/*
 * The draft room's chat dock is ~240px tall on a laptop. A GIF / emoji / poll picker opened
 * upward from its box ran out of the top of the panel and was clipped (measured at 1280x900:
 * picker top 642 against a panel top of 679). With `pickerPlacement="auto"` the composer
 * measures the room above the box and, when it is short, floats the picker over the page.
 */

const VIEWPORT = { width: 1280, height: 900 }

describe('floatingPickerBox — where a picker goes when it cannot fit inline', () => {
  it('stays inline when the conversation above the box has room', () => {
    expect(floatingPickerBox({ top: 830, left: 842, width: 407, height: 90 }, INLINE_PICKER_MIN_ROOM, VIEWPORT)).toBeNull()
  })

  it('floats ABOVE a box at the bottom of a short dock, capped to the space above it', () => {
    const box = floatingPickerBox({ top: 812, left: 842, width: 407, height: 90 }, 130, VIEWPORT)
    expect(box).toEqual({ left: 842, width: 407, bottom: 900 - 812 + 6, maxHeight: 430 })
  })

  it('is never narrower than a usable picker, and never leaves the viewport', () => {
    const box = floatingPickerBox({ top: 812, left: 1100, width: 200, height: 90 }, 0, VIEWPORT)!
    expect(box.width).toBe(320)
    expect(box.left + box.width).toBeLessThanOrEqual(VIEWPORT.width - 8)
    const phone = floatingPickerBox({ top: 700, left: 4, width: 380, height: 90 }, 0, { width: 390, height: 844 })!
    expect(phone.left).toBe(8)
    expect(phone.width).toBe(390 - 16)
  })

  it('opens BELOW a box that sits near the top of the screen', () => {
    const box = floatingPickerBox({ top: 60, left: 20, width: 400, height: 100 }, 0, VIEWPORT)!
    expect(box.bottom).toBeUndefined()
    expect(box.top).toBe(166)
    expect(box.maxHeight).toBe(430)
  })
})

function openEmoji() {
  fireEvent.click(screen.getByRole('button', { name: 'Emoji' }))
}

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/chat/emojis')) {
      return {
        ok: true,
        json: async () => ({ emojis: [{ id: 'e0', char: '🔥', name: 'fire', category: 'symbols', keywords: [] }], categories: [], fantasy: [] }),
      } as Response
    }
    return { ok: true, json: async () => [] } as Response
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatComposer pickerPlacement', () => {
  it('default (inline): the picker opens inside the composer, nothing is portalled', () => {
    render(<ChatComposer leagueId="L1" onSend={async () => {}} />)
    openEmoji()
    const composer = screen.getByTestId('league-chat-composer')
    expect(composer.querySelector('.af-chat-picker')).toBeTruthy()
    expect(screen.queryByTestId('chat-composer-floating-picker')).toBeNull()
  })

  it('auto, in a short dock: the picker floats over the page, outside the composer and its panel', () => {
    // jsdom lays nothing out: every rect is 0, so there is no room above the box.
    render(
      <div className="af-cm af-cm-embed" data-testid="panel">
        <ChatComposer leagueId="L1" onSend={async () => {}} pickerPlacement="auto" />
      </div>,
    )
    openEmoji()
    const floating = screen.getByTestId('chat-composer-floating-picker')
    expect(floating.parentElement).toBe(document.body)
    expect(screen.getByTestId('panel').contains(floating)).toBe(false)
    expect(floating.querySelector('.af-chat-picker')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search emojis...')).toBeTruthy()
    // Nothing is left inline behind it.
    expect(screen.getByTestId('league-chat-composer').querySelector('.af-chat-picker')).toBeNull()
  })

  it('auto: a floating picker closes on Escape and on a click outside, but not on a click inside', () => {
    render(<ChatComposer leagueId="L1" onSend={async () => {}} pickerPlacement="auto" />)
    openEmoji()
    const floating = screen.getByTestId('chat-composer-floating-picker')
    fireEvent.mouseDown(screen.getByPlaceholderText('Search emojis...'))
    expect(screen.getByTestId('chat-composer-floating-picker')).toBe(floating)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('chat-composer-floating-picker')).toBeNull()

    openEmoji()
    expect(screen.getByTestId('chat-composer-floating-picker')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('chat-composer-floating-picker')).toBeNull()
  })

  it('auto, with room above the box: the picker opens inline like the drawer', () => {
    const rect = (top: number) =>
      ({ top, bottom: top + 90, left: 0, right: 400, width: 400, height: 90, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('af-cm')) return rect(0)
      if (this.querySelector('[data-testid="league-chat-textarea"]')) return rect(INLINE_PICKER_MIN_ROOM + 200)
      return rect(0)
    })
    render(
      <div className="af-cm af-cm-embed">
        <ChatComposer leagueId="L1" onSend={async () => {}} pickerPlacement="auto" />
      </div>,
    )
    openEmoji()
    expect(screen.queryByTestId('chat-composer-floating-picker')).toBeNull()
    expect(screen.getByTestId('league-chat-composer').querySelector('.af-chat-picker')).toBeTruthy()
  })

  it('auto: the poll composer floats too', () => {
    render(<ChatComposer leagueId="L1" onSend={async () => {}} pickerPlacement="auto" />)
    fireEvent.click(screen.getByRole('button', { name: 'Poll' }))
    const floating = screen.getByTestId('chat-composer-floating-picker')
    expect(floating.querySelector('input[placeholder="Ask the league a question..."]')).toBeTruthy()
  })
})
