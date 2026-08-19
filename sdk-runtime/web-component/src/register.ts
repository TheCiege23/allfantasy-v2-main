/**
 * Decision OS — Phase 7.16 Web Component Adapter registration.
 *
 * Explicit, idempotent registration — never a module-load side effect.
 * Importing this module does NOT register anything; callers (a real host
 * page, or a test) call `defineAllFantasyWidgetElement()` themselves.
 */

import { AllFantasyWidgetElement } from './AllFantasyWidgetElement'

export const DEFAULT_TAG_NAME = 'allfantasy-widget'

/**
 * Registers the custom element. Safe to call more than once with the same
 * tag name (no-ops if already registered) — `customElements.define` itself
 * throws `NotSupportedError` on a duplicate tag, so this guards that.
 */
export function defineAllFantasyWidgetElement(tagName: string = DEFAULT_TAG_NAME): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(tagName)) return
  customElements.define(tagName, AllFantasyWidgetElement)
}
