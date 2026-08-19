/**
 * Decision OS — Phase 7.12 Widget Host Facade: createAllFantasyWidgetHost.
 *
 * Ties together Phase 7.9 (protocol contracts), Phase 7.10 (host bootstrap),
 * and Phase 7.11 (browser bridging) into the one function a partner host
 * page calls. Owns the handshake a caller would otherwise have to
 * orchestrate by hand: on receiving 'ready' from the child, this facade
 * sends 'init' automatically — mountIframeWidget (7.11) deliberately leaves
 * that to its caller, and this facade IS that caller.
 */

import { validateIframeEmbedConfig } from '../config'
import { mountIframeWidget } from '../browser/mount'
import type { MountedIframeWidget } from '../browser/mount'
import { generateNonce } from '../browser/nonce'
import { buildInitPayloadFromSdkConfig } from '../protocol'
import { buildIframeWidgetUrl } from '../urlHandshake'
import type { ChildToParentMessage } from '../types'
import type { AllFantasyWidgetHost, AllFantasyWidgetHostConfig } from './types'

function deriveWidgetId(sdkConfig: AllFantasyWidgetHostConfig['sdkConfig']): string {
  return `widget_${sdkConfig.entityId}_${sdkConfig.widgetMode}`
}

export function createAllFantasyWidgetHost(config: AllFantasyWidgetHostConfig): AllFantasyWidgetHost {
  const validation = validateIframeEmbedConfig({
    sdkConfig: config.sdkConfig,
    iframeOrigin: config.iframeOrigin,
    allowedOrigins: config.allowedOrigins,
  })
  if (!validation.valid) {
    throw new Error(`Invalid AllFantasyWidgetHost config: ${validation.errors.join('; ')}`)
  }

  const widgetId = deriveWidgetId(config.sdkConfig)
  let mounted: MountedIframeWidget | null = null
  let unsubscribe: (() => void) | null = null

  function dispatch(message: ChildToParentMessage): void {
    switch (message.type) {
      case 'ready':
        // Complete the handshake before informing the caller — the host page
        // never has to know 'init' exists at all.
        mounted?.host.sendInit(buildInitPayloadFromSdkConfig(config.sdkConfig))
        config.onReady?.(message.payload)
        break
      case 'lifecycle_change':
        config.onLifecycleChange?.(message.payload.state)
        break
      case 'degraded':
        config.onDegraded?.(message.payload.completeness)
        break
      case 'error':
        config.onError?.(message.payload)
        break
      case 'interaction':
        config.onInteraction?.(message.payload.target)
        break
      case 'resize':
        config.onResize?.(message.payload.heightPx)
        break
    }
  }

  return {
    get isMounted(): boolean {
      return mounted !== null
    },

    mount(container: Pick<HTMLElement, 'appendChild'>): void {
      if (mounted) {
        throw new Error('AllFantasyWidgetHost is already mounted — call unmount() before mounting again.')
      }

      const nonce = generateNonce(config.randomSource)
      // Phase 7.14: the handshake params travel to the child via the
      // iframe's own src URL — the child facade parses them back out once
      // it starts running. Appending them here doesn't change the URL's
      // origin, so mountIframeWidget's own origin check still applies to
      // config.baseSrc's origin correctly.
      const finalSrc = buildIframeWidgetUrl({
        baseSrc: config.baseSrc,
        widgetId,
        nonce,
        parentOrigin: config.sdkConfig.hostOrigin,
      })
      mounted = mountIframeWidget({
        container,
        src: finalSrc,
        childOrigin: config.iframeOrigin,
        widgetId,
        nonce,
        document: config.document,
        parentWindow: config.parentWindow,
        generateTimestamp: config.generateTimestamp,
        onRejected: config.onProtocolRejection,
      })
      unsubscribe = mounted.host.onChildMessage(dispatch)
    },

    unmount(): void {
      if (!mounted) return
      unsubscribe?.()
      unsubscribe = null
      mounted.unmount()
      mounted = null
    },

    sendRefreshRequest(): void {
      mounted?.host.sendRefreshRequest()
    },

    sendVisibilityChange(visible: boolean): void {
      mounted?.host.sendVisibilityChange(visible)
    },

    sendThemeUpdate(theme): void {
      mounted?.host.sendThemeUpdate(theme)
    },
  }
}
