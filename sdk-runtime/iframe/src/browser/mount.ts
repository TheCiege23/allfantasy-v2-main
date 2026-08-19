/**
 * Decision OS — Phase 7.11 Browser Iframe Adapter: mount helper.
 *
 * Creates a real `<iframe>` element wired to an `IframeHostBootstrap`
 * (Phase 7.10, unchanged) via the window bridges in this same layer. Does
 * NOT send `init` itself — the caller sends it once it observes a `ready`
 * message from the child (the standard handshake pattern; sending `init`
 * blindly on mount risks the child not having registered its listener yet).
 *
 * `document`/`parentWindow` are injectable so this stays testable without a
 * full browser — production callers simply omit them and get the real
 * globals.
 */

import { IframeHostBootstrap } from '../iframeHost'
import type { IframeHostDeps } from '../iframeHost'
import { IFRAME_SANDBOX_ATTRIBUTE } from '../security'
import { createBrowserWindowBridge } from './windowBridge'
import type { BrowserWindowSource } from './windowBridge'
import { createIframeContentWindowBridge } from './iframeElementAdapter'
import { teardownIframeWidget } from './teardown'

export interface DocumentSource {
  createElement(tagName: 'iframe'): HTMLIFrameElement
}

export interface MountIframeWidgetOptions {
  /** The DOM node the iframe element is appended to. */
  container: Pick<HTMLElement, 'appendChild'>
  /** The iframe's src URL — its origin must exactly equal `childOrigin`. */
  src: string
  childOrigin: string
  widgetId: string
  nonce: string
  document?: DocumentSource
  parentWindow?: BrowserWindowSource
  generateTimestamp?: () => string
  onRejected?: IframeHostDeps['onRejected']
}

export interface MountedIframeWidget {
  iframeElement: HTMLIFrameElement
  host: IframeHostBootstrap
  unmount: () => void
}

export function mountIframeWidget(options: MountIframeWidgetOptions): MountedIframeWidget {
  const srcOrigin = new URL(options.src).origin
  if (srcOrigin !== options.childOrigin) {
    throw new Error(
      `iframe src origin '${srcOrigin}' does not match expected childOrigin '${options.childOrigin}' — refusing to mount.`,
    )
  }

  // Explicit annotation: without it, TS infers `DocumentSource | Document`
  // and resolves `.createElement('iframe')` against the widest common
  // overload (generic `HTMLElement`) instead of the tag-specific
  // `HTMLIFrameElement` overload either type alone would resolve correctly.
  const doc: DocumentSource = options.document ?? document
  const parentWindowSource: BrowserWindowSource = options.parentWindow ?? window

  const iframeElement = doc.createElement('iframe')
  iframeElement.src = options.src
  iframeElement.setAttribute('sandbox', IFRAME_SANDBOX_ATTRIBUTE)
  options.container.appendChild(iframeElement)

  const childWindowBridge = createIframeContentWindowBridge(iframeElement)
  const parentWindowBridge = createBrowserWindowBridge(parentWindowSource)

  const host = new IframeHostBootstrap({
    parentWindow: parentWindowBridge,
    childWindow: childWindowBridge,
    childOrigin: options.childOrigin,
    widgetId: options.widgetId,
    nonce: options.nonce,
    generateTimestamp: options.generateTimestamp,
    onRejected: options.onRejected,
  })

  return {
    iframeElement,
    host,
    unmount: () => teardownIframeWidget(host, iframeElement),
  }
}
