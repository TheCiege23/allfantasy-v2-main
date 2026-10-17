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
 * Sent once per distinct snapshot per app session: re-sending identical data on every render
 * would wake WidgetKit for nothing.
 */

import { isInIosAppClient } from './iosApp'
import { snapshotFingerprint, type CareerWidgetSnapshot } from '@/lib/core-app/careerWidgetSnapshot'

const PLUGIN = 'CareerWidget'
const SENT_KEY = 'af-career-widget-sent'

type CapacitorBridge = {
  nativePromise?: (plugin: string, method: string, options?: Record<string, unknown>) => Promise<unknown>
}

export async function syncCareerWidget(snapshot: CareerWidgetSnapshot | null): Promise<'sent' | 'skipped' | 'unavailable'> {
  if (!snapshot || typeof window === 'undefined' || !isInIosAppClient()) return 'skipped'
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor
  if (!cap || typeof cap.nativePromise !== 'function') return 'unavailable'

  const fingerprint = snapshotFingerprint(snapshot)
  try {
    if (window.sessionStorage.getItem(SENT_KEY) === fingerprint) return 'skipped'
  } catch {
    /* storage blocked: send anyway */
  }
  try {
    await cap.nativePromise(PLUGIN, 'setSnapshot', { json: JSON.stringify(snapshot) })
  } catch {
    return 'unavailable'
  }
  try {
    window.sessionStorage.setItem(SENT_KEY, fingerprint)
  } catch {
    /* not remembered: the next render sends again, which is harmless */
  }
  return 'sent'
}
