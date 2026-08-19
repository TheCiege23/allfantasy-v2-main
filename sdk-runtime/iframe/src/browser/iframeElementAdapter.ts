/**
 * Decision OS — Phase 7.11 Browser Iframe Adapter: iframe element bridge.
 *
 * Wraps a real `HTMLIFrameElement`'s `contentWindow` into a `WindowLike`
 * (via the same window bridge used for the parent side). `contentWindow` is
 * a real nested browsing context available synchronously once the element
 * exists — it does not require the `src` to have finished loading —
 * postMessage across a not-yet-loaded frame is valid and standard.
 */

import { createBrowserWindowBridge } from './windowBridge'
import type { BrowserWindowSource } from './windowBridge'
import type { WindowLike } from '../windowLike'

/** The subset of the real DOM `HTMLIFrameElement` interface this bridge depends on. */
export interface IframeElementSource {
  contentWindow: BrowserWindowSource | null
}

export function createIframeContentWindowBridge(iframeElement: IframeElementSource): WindowLike {
  if (!iframeElement.contentWindow) {
    throw new Error(
      'iframe.contentWindow is not available — ensure the iframe element is attached to the document before bridging.',
    )
  }
  return createBrowserWindowBridge(iframeElement.contentWindow)
}
