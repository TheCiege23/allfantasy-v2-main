/**
 * Haptics (live-career plan, phase 6) — one call, three outcomes:
 *
 *   iOS app   → Capacitor's Haptics plugin, through the bridge Capacitor injects (the website does
 *               not bundle @capacitor/core — same route as lib/platform/iosAppLinks.ts). Only when
 *               the installed build has the plugin compiled in: a binary from before this shipped
 *               simply gets no haptic, never an error.
 *   Android   → `navigator.vibrate`, which Chrome (and so the Play app's Trusted Web Activity)
 *               honours on a device with a motor.
 *   elsewhere → nothing. Desktop Chrome exposes `vibrate` with no motor behind it; that is a no-op.
 *
 * ⚠ A CELEBRATION, NOT A NOTIFICATION. Haptics fire only in direct response to something on the
 * screen the person is looking at — a result they are reading, a button they pressed — never from
 * a background event. And `prefers-reduced-motion` turns them off: people who asked the OS for less
 * motion did not ask to be buzzed instead.
 */

import { isInIosAppClient } from './iosApp'

export type HapticKind = 'success' | 'light'

const HAPTICS_PLUGIN = 'Haptics'

type CapacitorBridge = {
  nativePromise?: (plugin: string, method: string, options?: Record<string, unknown>) => Promise<unknown>
  isPluginAvailable?: (name: string) => boolean
  PluginHeaders?: Array<{ name?: string }>
}

/** Android vibration patterns, in ms. Short on purpose: a tap, and a two-beat "nice". */
export const VIBRATE_PATTERN: Record<HapticKind, number | number[]> = {
  light: 12,
  success: [18, 60, 28],
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function iosBridge(): CapacitorBridge | null {
  if (!isInIosAppClient()) return null
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor
  if (!cap || typeof cap.nativePromise !== 'function') return null
  const compiledIn =
    (Array.isArray(cap.PluginHeaders) && cap.PluginHeaders.some((h) => h?.name === HAPTICS_PLUGIN)) ||
    cap.isPluginAvailable?.(HAPTICS_PLUGIN) === true
  return compiledIn ? cap : null
}

/**
 * Fire one haptic. Returns which channel was used, for tests and for callers that want to know
 * whether anything happened. Never throws.
 */
export function haptic(kind: HapticKind): 'ios' | 'vibrate' | 'none' {
  if (typeof window === 'undefined' || prefersReducedMotion()) return 'none'
  try {
    const cap = iosBridge()
    if (cap?.nativePromise) {
      const call =
        kind === 'success'
          ? cap.nativePromise(HAPTICS_PLUGIN, 'notification', { type: 'SUCCESS' })
          : cap.nativePromise(HAPTICS_PLUGIN, 'impact', { style: 'LIGHT' })
      void call.catch(() => undefined)
      return 'ios'
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      return navigator.vibrate(VIBRATE_PATTERN[kind]) ? 'vibrate' : 'none'
    }
  } catch {
    /* a haptic is never worth an error */
  }
  return 'none'
}

/**
 * Fire a haptic at most once per `key` per browser session — for a celebration tied to something
 * the page shows on load, which a refresh or a back-navigation would otherwise repeat.
 */
export function hapticOnce(key: string, kind: HapticKind): boolean {
  if (typeof window === 'undefined') return false
  const storeKey = `af-haptic:${key}`
  try {
    if (window.sessionStorage.getItem(storeKey)) return false
    window.sessionStorage.setItem(storeKey, '1')
  } catch {
    return false
  }
  return haptic(kind) !== 'none'
}
