import crypto from "crypto"
import { recordAnalyticsEvent } from "@/lib/analytics/recordAnalyticsEvent"
import {
  DEFAULT_META_PIXEL_ID,
  normalizeMetaCustomData,
  type MetaCustomData,
  type MetaEventName,
} from "@/lib/meta-events"

// Meta pixel IDs are always numeric. Guard against placeholder/misconfigured values
// (e.g. a literal "your-meta-pixel-id" left in an env file) so we don't repeatedly
// call the Graph API with an ID that can never resolve.
function resolveConfiguredPixelId(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && /^\d+$/.test(trimmed) ? trimmed : null
}

const PIXEL_ID =
  resolveConfiguredPixelId(process.env.META_PIXEL_ID) ||
  resolveConfiguredPixelId(process.env.NEXT_PUBLIC_META_PIXEL_ID) ||
  DEFAULT_META_PIXEL_ID

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function normEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normPhone(phone: string): string {
  return phone.replace(/[^\d]/g, "")
}

function getHeaderClientIp(request?: Request | null): string | undefined {
  if (!request) return undefined
  return (
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    ""
  )
    .split(",")[0]
    .trim() || undefined
}

function getCookieFromRequest(request: Request | null | undefined, name: string): string | undefined {
  const raw = request?.headers.get("cookie")
  if (!raw) return undefined
  const prefix = `${name}=`
  return raw
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
}

function resolveEventSourceUrl(request?: Request | null, explicit?: string | null): string {
  if (explicit?.trim()) return explicit.trim()
  const referer = request?.headers.get("referer")?.trim()
  if (referer) return referer
  try {
    if (request?.url) {
      const url = new URL(request.url)
      return `${url.origin}/`
    }
  } catch {
    // fall through
  }
  return "https://allfantasy.ai/"
}

function pathFromSourceUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null
  try {
    const url = new URL(sourceUrl)
    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

export interface CAPIEventParams {
  eventName: MetaEventName | string
  eventId: string
  email?: string | null
  phone?: string | null
  userId?: string | null
  clientIp?: string
  clientUserAgent?: string
  eventSourceUrl?: string | null
  fbp?: string
  fbc?: string
  customData?: MetaCustomData | null
  actionSource?: "website" | "email" | "phone_call" | "chat" | "physical_store" | "system_generated" | "business_messaging" | "other"
  testEventCode?: string | null
  request?: Request | null
}

export type MetaCapiResult = { success: boolean; error?: string; meta?: unknown }

export async function sendMetaCAPIEvent(params: CAPIEventParams): Promise<MetaCapiResult> {
  const accessToken = process.env.META_CONVERSIONS_API_TOKEN

  if (!accessToken) {
    console.warn("META_CONVERSIONS_API_TOKEN not set, skipping CAPI event")
    return { success: false, error: "No access token configured" }
  }

  const eventTime = Math.floor(Date.now() / 1000)
  const request = params.request ?? null
  const eventSourceUrl = resolveEventSourceUrl(request, params.eventSourceUrl)

  const userData: Record<string, unknown> = {}

  if (params.email) userData.em = [sha256(normEmail(params.email))]
  if (params.phone) userData.ph = [sha256(normPhone(params.phone))]
  if (params.userId) userData.external_id = [sha256(params.userId)]
  const fbp = params.fbp ?? getCookieFromRequest(request, "_fbp")
  const fbc = params.fbc ?? getCookieFromRequest(request, "_fbc")
  if (fbp) userData.fbp = fbp
  if (fbc) userData.fbc = fbc

  const clientIp = params.clientIp ?? getHeaderClientIp(request)
  const clientUserAgent = params.clientUserAgent ?? request?.headers.get("user-agent") ?? undefined
  if (clientIp) userData.client_ip_address = clientIp
  if (clientUserAgent) userData.client_user_agent = clientUserAgent

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: params.eventName,
        event_time: eventTime,
        event_id: params.eventId,
        action_source: params.actionSource ?? "website",
        event_source_url: eventSourceUrl,
        user_data: userData,
        custom_data: normalizeMetaCustomData(params.customData, {
          eventName: params.eventName,
        }),
      },
    ],
  }

  const testEventCode = params.testEventCode ?? process.env.META_TEST_EVENT_CODE
  if (testEventCode) {
    payload.test_event_code = testEventCode
  }

  const url = `https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${accessToken}`

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json().catch(() => null)

    if (!response.ok) {
      console.error("Meta CAPI error:", result)
      return {
        success: false,
        error:
          (result as { error?: { message?: string } } | null)?.error?.message ||
          "CAPI request failed",
        meta: result,
      }
    }

    console.log("Meta CAPI event sent:", params.eventName, params.eventId)
    return { success: true, meta: result }
  } catch (error) {
    console.error("Meta CAPI fetch error:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    }
  }
}

export async function trackMetaServerEvent(
  params: CAPIEventParams & { source?: string | null }
): Promise<{
  eventName: MetaEventName | string
  eventId: string
  customData: MetaCustomData
  capi: MetaCapiResult
}> {
  const customData = normalizeMetaCustomData(params.customData, {
    eventName: params.eventName,
  })
  const sourceUrl = resolveEventSourceUrl(params.request ?? null, params.eventSourceUrl)
  const capi = await sendMetaCAPIEvent({
    ...params,
    customData,
    eventSourceUrl: sourceUrl,
  })

  await recordAnalyticsEvent({
    event: `meta.${params.eventName}`,
    toolKey: "meta_capi",
    userId: params.userId ?? null,
    path: pathFromSourceUrl(sourceUrl),
    referrer: params.request?.headers.get("referer") ?? null,
    userAgent:
      params.clientUserAgent ??
      params.request?.headers.get("user-agent") ??
      null,
    meta: {
      eventName: params.eventName,
      eventId: params.eventId,
      customData,
      pixelId: PIXEL_ID,
      source: params.source ?? null,
      capiSuccess: capi.success,
      capiError: capi.error ?? null,
      capiMeta: capi.meta ?? null,
      hasFbp: Boolean(params.fbp ?? getCookieFromRequest(params.request ?? null, "_fbp")),
      hasFbc: Boolean(params.fbc ?? getCookieFromRequest(params.request ?? null, "_fbc")),
    },
  })

  return {
    eventName: params.eventName,
    eventId: params.eventId,
    customData,
    capi,
  }
}
