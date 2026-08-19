/**
 * Decision OS — Phase 7.17 JS Embed Adapter: `AllFantasy` global namespace.
 *
 * `attachAllFantasyGlobal` is explicit and opt-in — never a module-load
 * side effect (mirrors `defineAllFantasyWidgetElement` from Phase 7.16's
 * register.ts). It sets exactly ONE property (`AllFantasy`) on the target;
 * nothing else is ever attached to `globalThis`/`window` by this package.
 */

import { createAllFantasyWidget } from './createWidget'

export const SDK_JS_EMBED_VERSION = '7.17.0' as const

export interface AllFantasyGlobalNamespace {
  createWidget: typeof createAllFantasyWidget
  VERSION: typeof SDK_JS_EMBED_VERSION
}

export const AllFantasy: AllFantasyGlobalNamespace = {
  createWidget: createAllFantasyWidget,
  VERSION: SDK_JS_EMBED_VERSION,
}

/**
 * Attaches the `AllFantasy` namespace object to `target` (defaults to
 * `globalThis`). Safe to call more than once — always assigns the SAME
 * namespace object reference, so re-attachment is a no-op in effect.
 */
export function attachAllFantasyGlobal(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  target.AllFantasy = AllFantasy
}
