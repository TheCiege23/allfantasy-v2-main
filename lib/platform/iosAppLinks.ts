/**
 * Links that open the iOS app (universal links) — sending the app to the page the link names.
 *
 * iOS hands a tapped link that matches the app's associated domain to the app, not to Safari
 * (lib/platform/appSiteAssociation.ts says which links). Capacitor's App plugin then reports it:
 * `getLaunchUrl` when the link launched the app, the `appUrlOpen` event when it was already running.
 * The website does not bundle @capacitor/core, so this goes through the bridge Capacitor injects,
 * the same way lib/push-notifications/iosAppPushBridge.ts does, and does nothing unless the
 * installed build has the App plugin compiled in.
 */

import { isInIosAppClient } from '@/lib/platform/iosApp'

const APP_PLUGIN = 'App'
const OUR_HOSTS = new Set(['www.allfantasy.ai', 'allfantasy.ai'])
export const LAUNCH_HANDLED_KEY = 'af-ios-launch-link-followed'

type ListenerHandle = { remove: () => unknown }
type CapacitorBridge = {
  nativePromise?: (plugin: string, method: string, options?: Record<string, unknown>) => Promise<unknown>
  addListener?: (plugin: string, event: string, callback: (data: unknown) => void) => ListenerHandle
  isPluginAvailable?: (name: string) => boolean
  PluginHeaders?: Array<{ name?: string }>
}

/** The in-app path a link should open, or null when it is not a link to this site. PURE. */
export function inAppPathForLink(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || !OUR_HOSTS.has(u.hostname.toLowerCase())) return null
  return `${u.pathname}${u.search}${u.hash}` || '/'
}

function urlOf(data: unknown): unknown {
  return (data as { url?: unknown } | null)?.url
}

/**
 * Start listening. Returns a stop function. A no-op outside the iOS app, or in a build without the
 * App plugin. `go` is injected for tests; it defaults to a full navigation.
 */
export function installIosAppLinkHandler(
  go: (path: string) => void = (path) => window.location.assign(path),
): () => void {
  if (typeof window === 'undefined' || !isInIosAppClient()) return () => {}
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor
  if (!cap || typeof cap.nativePromise !== 'function' || typeof cap.addListener !== 'function') return () => {}
  const compiledIn =
    (Array.isArray(cap.PluginHeaders) && cap.PluginHeaders.some((h) => h?.name === APP_PLUGIN)) ||
    cap.isPluginAvailable?.(APP_PLUGIN) === true
  if (!compiledIn) return () => {}

  const open = (url: unknown) => {
    const path = inAppPathForLink(url)
    if (!path) return
    const here = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (path !== here) go(path)
  }

  /*
   * A link that LAUNCHED the app: it loads its start page first, then this sends it on.
   *
   * 🛑 ONCE PER APP SESSION. `getLaunchUrl` keeps answering the same link for as long as the app
   * runs, and every full page load re-runs this. Following it again after the verify link has
   * redirected on (verify → /import) would send the app back to a spent link, then do it again on
   * the next page — a loop. The first follow is remembered in sessionStorage, which survives
   * navigations inside the app and is cleared when it is closed.
   */
  cap.nativePromise(APP_PLUGIN, 'getLaunchUrl').then(
    (r) => {
      const url = urlOf(r)
      if (typeof url !== 'string' || !url) return
      try {
        if (window.sessionStorage.getItem(LAUNCH_HANDLED_KEY) === url) return
        window.sessionStorage.setItem(LAUNCH_HANDLED_KEY, url)
      } catch {
        /* storage unavailable: follow it anyway, once is the common case */
      }
      open(url)
    },
    () => {},
  )
  // A link tapped while the app is running.
  const handle = cap.addListener(APP_PLUGIN, 'appUrlOpen', (data) => open(urlOf(data)))
  return () => {
    try {
      handle.remove()
    } catch {
      /* the bridge is gone with the page */
    }
  }
}
