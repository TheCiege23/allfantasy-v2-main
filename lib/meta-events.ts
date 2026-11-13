const META_EVENT_NAMES = [
  "PageView",
  "ViewContent",
  "CompleteRegistration",
  "InitiateCheckout",
  "Purchase",
  "Lead",
  "early_access_click",
  "find_league_click",
] as const

export type MetaEventName = (typeof META_EVENT_NAMES)[number]

export const DEFAULT_META_PIXEL_ID = "1607977376870461"

const META_STANDARD_PIXEL_EVENTS = [
  "PageView",
  "ViewContent",
  "CompleteRegistration",
  "InitiateCheckout",
  "Purchase",
  "Lead",
] as const

export type MetaCustomData = {
  value?: number
  currency?: string
  content_name?: string
  content_category?: string
  content_ids?: string[]
  content_type?: string
  contents?: Array<Record<string, unknown>>
  num_items?: number
  order_id?: string
  status?: string
  [key: string]: unknown
}

export type MetaEventPayload = {
  eventName: MetaEventName | string
  eventId: string
  customData: MetaCustomData
}

const DEFAULT_CURRENCY = "USD"

function sanitizeEventIdPart(input: string): string {
  return input
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96)
}

function randomIdPart(): string {
  const g = globalThis as typeof globalThis & {
    crypto?: Crypto & { randomUUID?: () => string }
  }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

function finiteNumberOrDefault(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : fallback
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export function normalizeMetaCustomData(
  input: MetaCustomData | null | undefined,
  fallback?: {
    eventName?: string
    contentName?: string
    contentCategory?: string
    value?: number
    currency?: string
  }
): MetaCustomData {
  const source = input ?? {}
  const contentName =
    nonEmptyString(source.content_name) ??
    fallback?.contentName ??
    fallback?.eventName ??
    "AllFantasy"
  const contentCategory =
    nonEmptyString(source.content_category) ??
    fallback?.contentCategory ??
    "AllFantasy"
  const currency =
    (nonEmptyString(source.currency) ?? fallback?.currency ?? DEFAULT_CURRENCY).toUpperCase()
  const value = finiteNumberOrDefault(source.value, fallback?.value ?? 0)

  return {
    ...source,
    value,
    currency,
    content_name: contentName,
    content_category: contentCategory,
  }
}

function createMetaEventId(eventName: string, sourceId?: string | null): string {
  const eventPart = sanitizeEventIdPart(eventName) || "event"
  const sourcePart = sourceId ? sanitizeEventIdPart(sourceId) : ""
  const randomPart = sanitizeEventIdPart(randomIdPart())
  return ["af", eventPart, sourcePart, Date.now().toString(36), randomPart]
    .filter(Boolean)
    .join("_")
    .slice(0, 180)
}

export function createDeterministicMetaEventId(eventName: string, sourceId: string): string {
  const eventPart = sanitizeEventIdPart(eventName) || "event"
  const sourcePart = sanitizeEventIdPart(sourceId) || "source"
  return ["af", eventPart, sourcePart].join("_").slice(0, 180)
}

export function buildMetaEventPayload(
  eventName: MetaEventName | string,
  customData?: MetaCustomData | null,
  options?: {
    eventId?: string
    sourceId?: string | null
    deterministic?: boolean
    contentName?: string
    contentCategory?: string
    value?: number
    currency?: string
  }
): MetaEventPayload {
  const sourceId = options?.sourceId ?? null
  const eventId =
    options?.eventId ??
    (options?.deterministic && sourceId
      ? createDeterministicMetaEventId(eventName, sourceId)
      : createMetaEventId(eventName, sourceId))
  return {
    eventName,
    eventId,
    customData: normalizeMetaCustomData(customData, {
      eventName,
      contentName: options?.contentName,
      contentCategory: options?.contentCategory,
      value: options?.value,
      currency: options?.currency,
    }),
  }
}

export function isKnownMetaEventName(value: string): value is MetaEventName {
  return META_EVENT_NAMES.includes(value as MetaEventName)
}

export function isMetaStandardPixelEvent(value: string): boolean {
  return META_STANDARD_PIXEL_EVENTS.includes(value as (typeof META_STANDARD_PIXEL_EVENTS)[number])
}
