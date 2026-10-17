/**
 * Push notifications inside the iOS app (ios-app/, Capacitor), reached through the native
 * bridge Capacitor injects into the WebView — the website does not bundle @capacitor/core.
 *
 * ⚠ THE PLUGIN IS NOT IN EVERY INSTALLED BINARY. The website updates the moment it deploys;
 * the app binary only when a new build ships through the App Store. So a build without the
 * push plugin will load this code, and `nativePromise('PushNotifications', …)` there rejects
 * with "not implemented". `iosAppPushBridge()` returns null unless the plugin was compiled in
 * (each native plugin injects a `PluginHeaders` entry at document start), so no button is
 * ever offered that the installed app cannot honour.
 *
 * Server half: /api/push/ios and lib/push-notifications/apns.ts.
 */

import { isInIosAppClient } from "@/lib/platform/iosApp"

export const IOS_PUSH_PLUGIN = "PushNotifications"

/** What iOS reports. `prompt` = never asked; `denied` can only be undone in iOS Settings. */
export type IosPushPermission = "prompt" | "granted" | "denied"

type ListenerHandle = { remove: () => unknown }

type CapacitorBridge = {
  nativePromise?: (plugin: string, method: string, options?: Record<string, unknown>) => Promise<unknown>
  addListener?: (plugin: string, event: string, callback: (data: unknown) => void) => ListenerHandle
  isPluginAvailable?: (name: string) => boolean
  PluginHeaders?: Array<{ name?: string }>
}

export type IosPushBridge = {
  checkPermissions: () => Promise<IosPushPermission>
  requestPermissions: () => Promise<IosPushPermission>
  register: () => Promise<void>
  on: (event: string, callback: (data: unknown) => void) => ListenerHandle
}

function readPermission(result: unknown): IosPushPermission {
  const receive = (result as { receive?: unknown } | null)?.receive
  if (receive === "granted" || receive === "denied") return receive
  return "prompt"
}

/** The push bridge, or null when this is not the iOS app or the installed build lacks the plugin. */
export function iosAppPushBridge(): IosPushBridge | null {
  if (typeof window === "undefined" || !isInIosAppClient()) return null
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor
  if (!cap || typeof cap.nativePromise !== "function" || typeof cap.addListener !== "function") return null
  const compiledIn =
    (Array.isArray(cap.PluginHeaders) && cap.PluginHeaders.some((h) => h?.name === IOS_PUSH_PLUGIN)) ||
    cap.isPluginAvailable?.(IOS_PUSH_PLUGIN) === true
  if (!compiledIn) return null

  const call = cap.nativePromise.bind(cap)
  const listen = cap.addListener.bind(cap)
  return {
    checkPermissions: async () => readPermission(await call(IOS_PUSH_PLUGIN, "checkPermissions")),
    requestPermissions: async () => readPermission(await call(IOS_PUSH_PLUGIN, "requestPermissions")),
    register: async () => {
      await call(IOS_PUSH_PLUGIN, "register")
    },
    on: (event, callback) => listen(IOS_PUSH_PLUGIN, event, callback),
  }
}

/** Whether this server can send to Apple at all (APNS_* set). Never prompt when it cannot. */
export async function iosPushConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/push/ios", { cache: "no-store" })
    if (!res.ok) return false
    const data = (await res.json()) as { configured?: unknown }
    return data.configured === true
  } catch {
    return false
  }
}

const REGISTER_TIMEOUT_MS = 15_000

/**
 * Ask iOS for this phone's device token and store it for the signed-in user.
 *
 * `register()` resolves as soon as the request is QUEUED; the token arrives later as a
 * `registration` event (via AppDelegate), or a `registrationError` — which is what a build
 * without the aps-environment entitlement produces. The listeners are attached BEFORE
 * registering so a fast answer cannot be missed, and removed once one arrives.
 *
 * The shell's registrar and a card on the same screen both call this; they share one
 * in-flight attempt, and a success stands for the rest of the page load.
 */
let inflight: Promise<boolean> | null = null
let registeredThisLoad = false

export function registerIosDevice(bridge: IosPushBridge): Promise<boolean> {
  if (registeredThisLoad) return Promise.resolve(true)
  if (inflight) return inflight
  inflight = attemptRegistration(bridge).then((ok) => {
    inflight = null
    if (ok) registeredThisLoad = true
    return ok
  })
  return inflight
}

/** Test seam: forget the page-load cache. */
export function resetIosRegistrationForTests(): void {
  inflight = null
  registeredThisLoad = false
}

function attemptRegistration(bridge: IosPushBridge): Promise<boolean> {
  return new Promise((resolve) => {
    const handles: ListenerHandle[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      for (const h of handles) {
        try {
          void h.remove()
        } catch {
          // A listener that cannot be removed is harmless; it just never fires again usefully.
        }
      }
      resolve(ok)
    }

    handles.push(
      bridge.on("registration", (data) => {
        const token = (data as { value?: unknown } | null)?.value
        if (typeof token !== "string" || !token) return finish(false)
        void fetch("/api/push/ios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })
          .then((res) => finish(res.ok))
          .catch(() => finish(false))
      }),
    )
    handles.push(bridge.on("registrationError", () => finish(false)))
    timer = setTimeout(() => finish(false), REGISTER_TIMEOUT_MS)
    bridge.register().catch(() => finish(false))
  })
}

/**
 * Where a tapped notification should open. Only a same-origin PATH is honoured — the payload
 * is ours, but a notification is not the place to start trusting absolute URLs.
 */
export function notificationTapHref(event: unknown): string | null {
  const data = (event as { notification?: { data?: { href?: unknown } } } | null)?.notification?.data
  const href = data?.href
  if (typeof href !== "string") return null
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return null
  return href
}
