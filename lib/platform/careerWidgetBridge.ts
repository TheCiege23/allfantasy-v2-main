/**
 * Hands the iOS "Your career" widget its data (live-career plan, phase 6).
 *
 * Inside the iOS app only, through the bridge Capacitor injects (the website does not bundle
 * @capacitor/core — same route as lib/platform/iosAppLinks.ts) to the app's own `CareerWidget`
 * plugin (ios-app/ios/App/App/CareerWidgetPlugin.swift), which stores it in the App Group the
 * widget reads.
 *
 * ⚠ NO PLUGIN-HEADER CHECK. The plugin is registered in the app's `capacitorDidLoad`, which can
 * run after Capacitor has injected its plugin list into the page, so `isPluginAvailable` may say
 * no for a plugin that answers fine. The call is simply made, and an older binary without the
 * plugin rejects it — caught and ignored.
 *
 * Sent once per distinct snapshot per RESEND_AFTER_MS: re-sending identical data on every render
 * would wake WidgetKit for nothing, but never re-sending it froze the widget's "Updated … ago" line
 * at the first send, so an unchanged career read hours later still looked hours old.
 */

import { isInIosAppClient } from './iosApp'
import { snapshotFingerprint, type CareerWidgetSnapshot } from '@/lib/core-app/careerWidgetSnapshot'

const PLUGIN = 'CareerWidget'
const SENT_KEY = 'af-career-widget-sent'
/** Identical data is re-sent after this long, to move the widget's "Updated … ago" line forward. */
export const RESEND_AFTER_MS = 10 * 60 * 1000

type CapacitorBridge = {
  nativePromise?: (plugin: string, method: string, options?: Record<string, unknown>) => Promise<unknown>
}

function sentRecently(raw: string | null, fingerprint: string, now: number): boolean {
  if (!raw) return false
  try {
    const held = JSON.parse(raw) as { fp?: unknown; at?: unknown }
    return held.fp === fingerprint && typeof held.at === 'number' && now - held.at < RESEND_AFTER_MS
  } catch {
    return false
  }
}

export async function syncCareerWidget(snapshot: CareerWidgetSnapshot | null): Promise<'sent' | 'skipped' | 'unavailable'> {
  if (!snapshot || typeof window === 'undefined' || !isInIosAppClient()) return 'skipped'
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor
  if (!cap || typeof cap.nativePromise !== 'function') return 'unavailable'

  const fingerprint = snapshotFingerprint(snapshot)
  const now = Date.now()
  try {
    if (sentRecently(window.sessionStorage.getItem(SENT_KEY), fingerprint, now)) return 'skipped'
  } catch {
    /* storage blocked: send anyway */
  }
  try {
    await cap.nativePromise(PLUGIN, 'setSnapshot', { json: JSON.stringify(snapshot) })
  } catch {
    return 'unavailable'
  }
  try {
    window.sessionStorage.setItem(SENT_KEY, JSON.stringify({ fp: fingerprint, at: now }))
  } catch {
    /* not remembered: the next render sends again, which is harmless */
  }
  return 'sent'
}

/**
 * Fetch the signed-in career from the server and hand it to the widget. Inside the iOS app only;
 * signed out (401), no career yet (204) or any failure leaves the widget showing what it had.
 */
export async function refreshCareerWidget(): Promise<'sent' | 'skipped' | 'unavailable'> {
  if (typeof window === 'undefined' || !isInIosAppClient()) return 'skipped'
  try {
    const res = await fetch('/api/core/career/widget-snapshot', { cache: 'no-store', credentials: 'same-origin' })
    if (res.status !== 200) return 'skipped'
    const body = (await res.json()) as { snapshot?: CareerWidgetSnapshot | null }
    return await syncCareerWidget(body.snapshot ?? null)
  } catch {
    return 'unavailable'
  }
}
