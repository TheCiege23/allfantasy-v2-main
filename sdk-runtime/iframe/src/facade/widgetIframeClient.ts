/**
 * Decision OS — Phase 7.13 Widget Iframe Child Facade: createAllFantasyWidgetIframeClient.
 *
 * The single entrypoint the code running INSIDE an embedded widget iframe
 * calls. Bridges real browser windows (Phase 7.11) into `IframeClientBootstrap`
 * (Phase 7.10, unchanged) and dispatches the 5 parent→child message types to
 * 5 typed callbacks — a widget implementer never touches the protocol
 * envelope directly.
 */

import { IframeClientBootstrap } from '../iframeClient'
import { createBrowserWindowBridge } from '../browser/windowBridge'
import type { ParentToChildMessage } from '../types'
import type {
  AllFantasyWidgetIframeClient,
  AllFantasyWidgetIframeClientConfig,
} from './iframeClientTypes'

export function createAllFantasyWidgetIframeClient(
  config: AllFantasyWidgetIframeClientConfig,
): AllFantasyWidgetIframeClient {
  const ownWindowSource = config.ownWindow ?? window
  const parentWindowSource = config.parentWindow ?? window.parent

  const client = new IframeClientBootstrap({
    ownWindow: createBrowserWindowBridge(ownWindowSource),
    parentWindow: createBrowserWindowBridge(parentWindowSource),
    parentOrigin: config.parentOrigin,
    widgetId: config.widgetId,
    nonce: config.nonce,
    generateTimestamp: config.generateTimestamp,
    onRejected: config.onProtocolRejection,
    onDisposed: config.onDisposed,
  })

  function dispatch(message: ParentToChildMessage): void {
    switch (message.type) {
      case 'init':
        config.onInit?.(message.payload)
        break
      case 'refresh_request':
        config.onRefreshRequest?.()
        break
      case 'visibility_change':
        config.onVisibilityChange?.(message.payload.visible)
        break
      case 'theme_update':
        config.onThemeUpdate?.(message.payload.theme)
        break
      case 'dispose':
        // IframeClientBootstrap already tears itself down and invokes
        // onDisposed (wired above) immediately after this dispatch — no
        // further action needed here.
        break
    }
  }

  client.onParentMessage(dispatch)

  return {
    get isDisposed(): boolean {
      return client.isDisposed
    },
    sendReady(sdkVersion: string): void {
      client.sendReady(sdkVersion)
    },
    sendResize(heightPx: number): void {
      client.sendResize(heightPx)
    },
    sendInteraction(target: string): void {
      client.sendInteraction(target)
    },
    sendError(error): void {
      client.sendError(error)
    },
    dispose(): void {
      client.dispose()
    },
  }
}
