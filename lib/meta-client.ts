import {
  buildMetaEventPayload,
  isMetaStandardPixelEvent,
  normalizeMetaCustomData,
  type MetaCustomData,
  type MetaEventName,
  type MetaEventPayload,
} from "@/lib/meta-events"
import { isInIosAppClient } from "@/lib/platform/iosApp"

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    _fbq?: (...args: unknown[]) => void
    __afMetaPixelId?: string
    __afMetaPixelIds?: Set<string>
    __afMetaBasePageViewEventId?: string
    __afMetaBasePageViewFired?: boolean
    __afMetaBasePageViewMirrorKey?: string
  }
}

type MetaResponseCarrier = {
  metaEvent?: MetaEventPayload | null
  metaEvents?: MetaEventPayload[] | Record<string, MetaEventPayload | null | undefined> | null
}

const META_PIXEL_SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js"
const PUBLIC_META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || ""

function getCookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined
  const prefix = `${name}=`
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
}

function isMetaDebugEnabled(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("af_debug_meta") === "1"
}

function debugMeta(message: string, value?: unknown): void {
  if (!isMetaDebugEnabled()) return
  if (value === undefined) {
    console.info(`[AF Meta] ${message}`)
  } else {
    console.info(`[AF Meta] ${message}`, value)
  }
}

function resolveClientMetaPixelId(pixelId?: string | null): string {
  return (
    pixelId?.trim() ||
    (typeof window !== "undefined" ? window.__afMetaPixelId?.trim() : "") ||
    PUBLIC_META_PIXEL_ID
  )
}

function ensureMetaPixelScript(): void {
  if (typeof document === "undefined") return

  const alreadyLoaded = Array.from(document.getElementsByTagName("script")).some(
    (script) => script.src === META_PIXEL_SCRIPT_SRC
  )
  if (alreadyLoaded) return

  const script = document.createElement("script")
  script.id = "af-meta-pixel-script"
  script.async = true
  script.src = META_PIXEL_SCRIPT_SRC

  const firstScript = document.getElementsByTagName("script")[0]
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript)
    return
  }

  const parent = document.head || document.body || document.documentElement
  parent.appendChild(script)
}

function installFbqShim(): void {
  if (typeof window === "undefined" || typeof window.fbq === "function") return

  const fbq = function fbqShim(...args: unknown[]) {
    const q = fbqShim as typeof fbqShim & {
      callMethod?: (...callArgs: unknown[]) => void
      queue?: unknown[][]
      push?: typeof fbqShim
      loaded?: boolean
      version?: string
    }
    if (q.callMethod) {
      q.callMethod(...args)
    } else {
      q.queue = q.queue ?? []
      q.queue.push(args)
    }
  } as typeof window.fbq & {
    queue?: unknown[][]
    push?: unknown
    loaded?: boolean
    version?: string
  }

  fbq.push = fbq
  fbq.loaded = true
  fbq.version = "2.0"
  fbq.queue = []
  window.fbq = fbq
  window._fbq = fbq
}

export function ensureMetaPixel(pixelId?: string | null): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false
  // No ad tracking inside the iOS app: App Tracking Transparency (lib/platform/iosApp).
  if (isInIosAppClient()) return false
  const id = resolveClientMetaPixelId(pixelId)
  if (!id) return false

  window.__afMetaPixelId = id
  installFbqShim()
  ensureMetaPixelScript()

  window.__afMetaPixelIds = window.__afMetaPixelIds instanceof Set
    ? window.__afMetaPixelIds
    : new Set<string>()
  if (!window.__afMetaPixelIds.has(id)) {
    window.fbq?.("init", id)
    window.__afMetaPixelIds.add(id)
  }

  debugMeta("metaPixelId", id)
  debugMeta("typeof window.fbq", typeof window.fbq)
  return typeof window.fbq === "function"
}

export function trackMetaBrowserEvent(event: MetaEventPayload | null | undefined): boolean {
  if (!event?.eventName || !event.eventId) return false
  if (typeof window === "undefined" || !ensureMetaPixel()) return false
  const command = isMetaStandardPixelEvent(event.eventName) ? "track" : "trackCustom"
  window.fbq(
    command,
    event.eventName,
    normalizeMetaCustomData(event.customData, { eventName: event.eventName }),
    { eventID: event.eventId }
  )
  if (event.eventName === "PageView") {
    debugMeta("PageView fired", {
      eventId: event.eventId,
      typeofFbq: typeof window.fbq,
      contentName: event.customData?.content_name,
      contentCategory: event.customData?.content_category,
    })
  }
  return true
}

export async function mirrorMetaEventServerSide(
  event: MetaEventPayload,
  options?: { sourceUrl?: string }
): Promise<void> {
  if (typeof window === "undefined") return
  try {
    await fetch("/api/meta/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        event_name: event.eventName,
        event_id: event.eventId,
        custom_data: event.customData,
        source_url: options?.sourceUrl ?? window.location.href,
        fbp: getCookieValue("_fbp"),
        fbc: getCookieValue("_fbc"),
      }),
    })
  } catch {
    // Best-effort mirror only; browser Pixel still carries the event.
  }
}

export function trackMetaEventAndMirror(
  eventName: MetaEventName | string,
  customData?: MetaCustomData | null,
  options?: {
    eventId?: string
    sourceId?: string | null
    deterministic?: boolean
    sourceUrl?: string
    contentName?: string
    contentCategory?: string
  }
): MetaEventPayload {
  const event = buildMetaEventPayload(eventName, customData, options)
  trackMetaBrowserEvent(event)
  void mirrorMetaEventServerSide(event, { sourceUrl: options?.sourceUrl })
  return event
}

export function collectMetaEventsFromResponse(payload: unknown): MetaEventPayload[] {
  const carrier = payload as MetaResponseCarrier | null | undefined
  if (!carrier || typeof carrier !== "object") return []

  const events: MetaEventPayload[] = []
  if (carrier.metaEvent) events.push(carrier.metaEvent)
  if (Array.isArray(carrier.metaEvents)) {
    events.push(...carrier.metaEvents.filter(Boolean))
  } else if (carrier.metaEvents && typeof carrier.metaEvents === "object") {
    events.push(...Object.values(carrier.metaEvents).filter(Boolean) as MetaEventPayload[])
  }
  return events.filter((event) => Boolean(event?.eventName && event?.eventId))
}

export function trackMetaEventsFromResponse(payload: unknown): void {
  for (const event of collectMetaEventsFromResponse(payload)) {
    trackMetaBrowserEvent(event)
  }
}
