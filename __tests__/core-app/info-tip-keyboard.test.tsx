import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
import { InfoTip } from '@/components/core-app/InfoTip'
const showDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover')
const hideDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover')
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  for (const [key, descriptor] of [['showPopover', showDescriptor], ['hidePopover', hideDescriptor]] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
})
describe('help keyboard dismissal', () => {
  it('Escape from popover content restores trigger focus without reopening its preview', () => {
    const opened = new WeakSet<HTMLElement>(), previousFocus = new WeakMap<HTMLElement, HTMLElement>()
    const originalMatches = HTMLElement.prototype.matches
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function(this: HTMLElement, selector: string) {
      return selector === ':popover-open' ? opened.has(this) : originalMatches.call(this, selector)
    })
    Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: function(this: HTMLElement) {
      if (opened.has(this)) return
      opened.add(this)
      previousFocus.set(this, document.activeElement as HTMLElement)
    } })
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value: function(this: HTMLElement) {
      if (!opened.has(this)) return
      opened.delete(this)
      previousFocus.get(this)?.focus()
      const event = new Event('toggle')
      Object.defineProperty(event, 'newState', { value: 'closed' })
      this.dispatchEvent(event)
    } })
    render(<InfoTip label="About ADP" title="ADP">Average draft position</InfoTip>)
    const trigger = screen.getByRole('button', { name: 'About ADP' })
    act(() => trigger.focus())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    // JSDOM's UA stylesheet still hides native popovers despite the API polyfill.
    const close = document.querySelector<HTMLButtonElement>('.af-info-close')!
    const popover = document.querySelector<HTMLElement>('.af-info-pop')!
    act(() => close.focus())
    const defaultAllowed = fireEvent.keyDown(close, { key: 'Escape', cancelable: true })
    // Simulate the native default action when the component did not consume Escape.
    if (defaultAllowed) act(() => (popover as HTMLElement & { hidePopover(): void }).hidePopover())
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(opened.has(popover)).toBe(false)
    // A reopened tip closes when its anchor scrolls away from the original position.
    fireEvent.click(trigger)
    expect(opened.has(popover)).toBe(true)
    act(() => close.focus())
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({top: 100, left: 0} as DOMRect)
    fireEvent.scroll(window)
    expect(opened.has(popover)).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})
