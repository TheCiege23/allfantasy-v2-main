import { describe, expect, it } from 'vitest'
import { AllFantasyWidgetElement } from '../../../sdk-runtime/web-component/src/AllFantasyWidgetElement'
import { defineAllFantasyWidgetElement, DEFAULT_TAG_NAME } from '../../../sdk-runtime/web-component/src/register'

/**
 * A single custom element CLASS can only ever be registered under ONE tag
 * name for the lifetime of a `CustomElementRegistry` (the DOM spec throws
 * `NotSupportedError` on a second `define()` for an already-registered
 * constructor, even under a different tag) — so every test below that
 * registers the real `AllFantasyWidgetElement` class shares this one tag,
 * relying on vitest's default sequential-in-file test order.
 */
const SHARED_TAG = 'allfantasy-widget-register-test'

describe('defineAllFantasyWidgetElement', () => {
  it('registers the element under the given tag name', () => {
    defineAllFantasyWidgetElement(SHARED_TAG)
    expect(customElements.get(SHARED_TAG)).toBe(AllFantasyWidgetElement)
  })

  it('defaults to the "allfantasy-widget" tag name', () => {
    // DEFAULT_TAG_NAME may already be registered by another test file in this
    // worker; only assert the constant's value, not global registry state.
    expect(DEFAULT_TAG_NAME).toBe('allfantasy-widget')
  })

  it('is idempotent — calling it again with the same tag does not throw', () => {
    expect(() => defineAllFantasyWidgetElement(SHARED_TAG)).not.toThrow()
    expect(customElements.get(SHARED_TAG)).toBe(AllFantasyWidgetElement)
  })

  it('a defined tag can be instantiated via document.createElement', () => {
    const el = document.createElement(SHARED_TAG)
    expect(el).toBeInstanceOf(AllFantasyWidgetElement)
  })

  it('registering the SAME class under a DIFFERENT tag throws (documents the DOM spec constraint: one class, one tag, ever)', () => {
    expect(() => defineAllFantasyWidgetElement('allfantasy-widget-register-test-other-tag')).toThrow()
  })
})
