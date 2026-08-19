/**
 * Decision OS — Phase 7.14 Widget Iframe Child Facade: URL-based init.
 *
 * Additive convenience over `createAllFantasyWidgetIframeClient` (Phase
 * 7.13, unchanged) — parses widgetId/nonce/parentOrigin out of the iframe's
 * own URL (the query string the host facade built via
 * `buildIframeWidgetUrl`, Phase 7.14) instead of requiring the caller to
 * already know them. The 7.13 API remains fully usable on its own for
 * callers that obtain these three values some other way.
 */

import { parseIframeWidgetUrlParams } from '../urlHandshake'
import { createAllFantasyWidgetIframeClient } from './widgetIframeClient'
import type {
  AllFantasyWidgetIframeClient,
  AllFantasyWidgetIframeClientCallbacks,
} from './iframeClientTypes'
import type { BrowserWindowSource } from '../browser/windowBridge'

export interface AllFantasyWidgetIframeClientFromUrlConfig extends AllFantasyWidgetIframeClientCallbacks {
  /** The raw query string to parse (with or without a leading '?'). Defaults to the real `window.location.search`. */
  locationSearch?: string
  ownWindow?: BrowserWindowSource
  parentWindow?: BrowserWindowSource
  generateTimestamp?: () => string
}

/**
 * Parses the handshake params from the iframe's own URL and constructs a
 * client from them. Throws immediately if any required param is missing or
 * malformed — matching `createAllFantasyWidgetHost`'s fail-fast-on-invalid-
 * config posture.
 */
export function createAllFantasyWidgetIframeClientFromUrl(
  config: AllFantasyWidgetIframeClientFromUrlConfig = {},
): AllFantasyWidgetIframeClient {
  const locationSearch = config.locationSearch ?? window.location.search
  const result = parseIframeWidgetUrlParams(locationSearch)

  if (!result.ok) {
    throw new Error(`Invalid AllFantasyWidgetIframeClient URL params: ${result.errors.join('; ')}`)
  }

  return createAllFantasyWidgetIframeClient({
    widgetId: result.params.widgetId,
    nonce: result.params.nonce,
    parentOrigin: result.params.parentOrigin,
    onInit: config.onInit,
    onRefreshRequest: config.onRefreshRequest,
    onVisibilityChange: config.onVisibilityChange,
    onThemeUpdate: config.onThemeUpdate,
    onDisposed: config.onDisposed,
    onProtocolRejection: config.onProtocolRejection,
    ownWindow: config.ownWindow,
    parentWindow: config.parentWindow,
    generateTimestamp: config.generateTimestamp,
  })
}
