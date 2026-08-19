/**
 * Decision OS — Phase 7.11 Browser Iframe Adapter: window bridge.
 *
 * The ONE place a real `Window` object is translated into the framework's
 * own `WindowLike` interface (Phase 7.10). Everything above this layer —
 * `iframeHost.ts`, `iframeClient.ts`, `messageListener.ts` — stays exactly
 * as it was in Phase 7.10, unchanged, and continues to know nothing about
 * real DOM globals.
 *
 * `removeEventListener` requires passing the SAME underlying DOM listener
 * function that was registered by `addEventListener` — a `Map` tracks that
 * translation per `WindowMessageListener` so removal actually works.
 */

import type { MessageEventLike, WindowLike, WindowMessageListener } from '../windowLike'

/** The subset of the real DOM `Window` interface this bridge depends on. */
export type BrowserWindowSource = Pick<Window, 'postMessage' | 'addEventListener' | 'removeEventListener'>

export function createBrowserWindowBridge(target: BrowserWindowSource): WindowLike {
  const domListenerByOurs = new Map<WindowMessageListener, (event: MessageEvent) => void>()

  return {
    postMessage(message: unknown, targetOrigin: string): void {
      target.postMessage(message, targetOrigin)
    },

    addEventListener(_type: 'message', listener: WindowMessageListener): void {
      const domListener = (event: MessageEvent): void => {
        const eventLike: MessageEventLike = { data: event.data, origin: event.origin }
        listener(eventLike)
      }
      domListenerByOurs.set(listener, domListener)
      target.addEventListener('message', domListener)
    },

    removeEventListener(_type: 'message', listener: WindowMessageListener): void {
      const domListener = domListenerByOurs.get(listener)
      if (!domListener) return
      target.removeEventListener('message', domListener)
      domListenerByOurs.delete(listener)
    },
  }
}
