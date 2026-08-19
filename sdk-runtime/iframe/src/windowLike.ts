/**
 * Decision OS — Phase 7.10 Iframe Bootstrap: injected window-like contracts.
 *
 * No unguarded global `window` anywhere in this package — every function and
 * class that sends or listens for messages takes a `WindowLike` as an
 * explicit dependency. In a real browser, a caller supplies the actual
 * `window` (parent side) or `iframe.contentWindow`/`window.parent` (child
 * side); tests supply a fake. This keeps `sdk-runtime/iframe` free of the
 * "dom" TypeScript lib entirely (enforced by the scoped tsconfig.json) —
 * these are our own minimal interfaces, never the real DOM `Window`/
 * `MessageEvent` types.
 */

export interface MessageEventLike {
  data: unknown
  origin: string
}

export type WindowMessageListener = (event: MessageEventLike) => void

export interface WindowLike {
  postMessage(message: unknown, targetOrigin: string): void
  addEventListener(type: 'message', listener: WindowMessageListener): void
  removeEventListener(type: 'message', listener: WindowMessageListener): void
}
