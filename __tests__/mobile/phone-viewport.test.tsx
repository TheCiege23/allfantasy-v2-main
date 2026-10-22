import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileViewport } from '@/components/mobile/MobileViewport'

let viewport: EventTarget & { height: number; offsetTop: number; scale: number }
beforeEach(() => {
  viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: true }))
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.unstubAllGlobals() })
function resize(height: number) { act(() => { viewport.height = height; viewport.dispatchEvent(new Event('resize')) }) }
function focusInput() { const input = document.createElement('input'); document.body.append(input); act(() => input.focus()); return input }

it('hides navigation only when an editable field and a keyboard-sized viewport reduction coincide', () => {
  render(<MobileViewport />)
  resize(480)
  expect(document.documentElement.hasAttribute('data-phone-keyboard')).toBe(false)
  focusInput()
  expect(document.documentElement.hasAttribute('data-phone-keyboard')).toBe(true)
  expect(document.documentElement.style.getPropertyValue('--phone-visible-height')).toBe('480px')
  resize(800)
  expect(document.documentElement.hasAttribute('data-phone-keyboard')).toBe(false)
})
it('does not mistake browser toolbar movement for a keyboard', () => {
  render(<MobileViewport />); focusInput(); resize(730)
  expect(document.documentElement.hasAttribute('data-phone-keyboard')).toBe(false)
})
it('preserves pinch zoom instead of constraining dialogs to the magnified viewport', () => {
  render(<MobileViewport />); focusInput(); viewport.scale = 2; resize(400)
  expect(document.documentElement.hasAttribute('data-phone-keyboard')).toBe(false)
  expect(document.documentElement.style.getPropertyValue('--phone-visible-height')).toBe('')
})
it('cleans up document flags and listeners on unmount', () => {
  const view = render(<MobileViewport />); focusInput(); resize(480); view.unmount()
  resize(450)
  expect(document.documentElement.hasAttribute('data-phone-keyboard')).toBe(false)
  expect(document.documentElement.style.getPropertyValue('--phone-visible-height')).toBe('')
})
it('works without the VisualViewport API', () => {
  vi.stubGlobal('visualViewport', undefined)
  expect(() => render(<MobileViewport />)).not.toThrow()
})
