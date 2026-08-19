/**
 * GIFIntegrationResolver — Klipy primary, Giphy/Tenor fallback.
 * Graceful fallback when API keys are not set.
 */

function getKlipyKey(): string {
  if (typeof process === "undefined") return ""
  return process.env.VITE_KLIPY_API_KEY ?? process.env.KLIPY_API_KEY ?? ""
}
function getTenorKey(): string {
  if (typeof process === "undefined") return ""
  return process.env.TENOR_API_KEY ?? process.env.NEXT_PUBLIC_TENOR_API_KEY ?? ""
}
function getGiphyKey(): string {
  if (typeof process === "undefined") return ""
  return process.env.GIPHY_API_KEY ?? process.env.NEXT_PUBLIC_GIPHY_API_KEY ?? ""
}

export function isGifSearchConfigured(): boolean {
  return Boolean(getKlipyKey() || getTenorKey() || getGiphyKey())
}

export function getGifProviderName(): "klipy" | "tenor" | "giphy" | null {
  if (getKlipyKey()) return "klipy"
  if (getTenorKey()) return "tenor"
  if (getGiphyKey()) return "giphy"
  return null
}

/** Base URL for Tenor search. Use through server-side proxy routes only. */
export function getTenorSearchUrl(query: string, limit = 12): string {
  const key = getTenorKey()
  if (!key) return ""
  const params = new URLSearchParams({ q: query, key, limit: String(limit), media_filter: "gif", contentfilter: "medium" })
  return `https://tenor.googleapis.com/v2/search?${params.toString()}`
}

/** Base URL for Giphy search. Use through server-side proxy routes only. */
export function getGiphySearchUrl(query: string, limit = 12): string {
  const key = getGiphyKey()
  if (!key) return ""
  const params = new URLSearchParams({ q: query, api_key: key, limit: String(limit), rating: "g" })
  return `https://api.giphy.com/v1/gifs/search?${params.toString()}`
}

/** Validate that a string looks like a GIF/image URL for paste-URL flow. */
export function isValidGifOrImageUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const u = new URL(trimmed)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}

export type GifSearchResult = {
  id: string
  url: string
  previewUrl?: string
  title?: string
  provider: "klipy" | "tenor" | "giphy"
}

function readNestedMediaUrl(layer: unknown, kind: "gif" | "webp" | "jpg"): string {
  if (!layer || typeof layer !== "object") return ""
  const bucket = (layer as Record<string, unknown>)[kind]
  if (!bucket || typeof bucket !== "object") return ""
  const u = (bucket as Record<string, unknown>).url
  return typeof u === "string" ? u : ""
}

function readLegacyUrl(legacy: Record<string, unknown>, key: string): string {
  const bucket = legacy[key]
  if (!bucket || typeof bucket !== "object") return ""
  const u = (bucket as Record<string, unknown>).url
  return typeof u === "string" ? u : ""
}

function normalizeKlipyResults(payload: unknown): GifSearchResult[] {
  const wrapper = payload as { result?: boolean; data?: { data?: unknown[] } }
  const list = Array.isArray(wrapper?.data?.data) ? wrapper.data!.data! : []
    const normalized: GifSearchResult[] = []
    for (const entry of list) {
      const obj = entry as Record<string, unknown>
      const id = String(obj.id ?? "")
      const modern = (obj.file ?? {}) as Record<string, unknown>
      const hd = (modern.hd ?? {}) as Record<string, unknown>
      const md = (modern.md ?? {}) as Record<string, unknown>
      const sm = (modern.sm ?? {}) as Record<string, unknown>
      const xs = (modern.xs ?? {}) as Record<string, unknown>
      const legacy = (obj.files ?? {}) as Record<string, unknown>

      const url =
        readNestedMediaUrl(hd, "gif") ||
        readNestedMediaUrl(md, "gif") ||
        readNestedMediaUrl(sm, "gif") ||
        readNestedMediaUrl(xs, "gif") ||
        readNestedMediaUrl(hd, "webp") ||
        readNestedMediaUrl(md, "webp") ||
        readNestedMediaUrl(sm, "webp") ||
        readNestedMediaUrl(xs, "webp") ||
        readNestedMediaUrl(sm, "jpg") ||
        readNestedMediaUrl(xs, "jpg") ||
        readLegacyUrl(legacy, "gif") ||
        readLegacyUrl(legacy, "webp") ||
        readLegacyUrl(legacy, "mp4") ||
        ""

      if (!id || !url) continue
      const preview =
        readNestedMediaUrl(sm, "webp") ||
        readNestedMediaUrl(sm, "gif") ||
        readNestedMediaUrl(xs, "webp") ||
        readNestedMediaUrl(xs, "gif") ||
        readNestedMediaUrl(sm, "jpg") ||
        readNestedMediaUrl(xs, "jpg") ||
        readLegacyUrl(legacy, "gif_small") ||
        readLegacyUrl(legacy, "webp") ||
        url

      const title = typeof obj.title === "string" ? obj.title : ""
      normalized.push({ id, url, previewUrl: preview, title, provider: "klipy" })
  }
  return normalized
}

function normalizeTenorResults(payload: unknown): GifSearchResult[] {
  const list = Array.isArray((payload as { results?: unknown[] })?.results)
    ? ((payload as { results: unknown[] }).results)
    : []
  const normalized: GifSearchResult[] = []
  for (const entry of list) {
    const obj = entry as Record<string, unknown>
    const id = typeof obj.id === "string" ? obj.id : ""
    const mediaFormats = (obj.media_formats || {}) as Record<string, Record<string, unknown>>
    const gif = mediaFormats.gif
    const tiny = mediaFormats.tinygif
    const url = typeof gif?.url === "string" ? gif.url : ""
    const previewUrl = typeof tiny?.url === "string" ? tiny.url : url
    if (!id || !url) continue
    const title = typeof obj.title === "string" ? obj.title : ""
    normalized.push({ id, url, previewUrl, title, provider: "tenor" })
  }
  return normalized
}

function normalizeGiphyResults(payload: unknown): GifSearchResult[] {
  const list = Array.isArray((payload as { data?: unknown[] })?.data)
    ? ((payload as { data: unknown[] }).data)
    : []
  const normalized: GifSearchResult[] = []
  for (const entry of list) {
    const obj = entry as Record<string, unknown>
    const id = typeof obj.id === "string" ? obj.id : ""
    const images = (obj.images || {}) as Record<string, Record<string, unknown>>
    const original = images.original
    const preview = images.preview_gif || images.fixed_width_small || original
    const url = typeof original?.url === "string" ? original.url : ""
    const previewUrl = typeof preview?.url === "string" ? preview.url : url
    if (!id || !url) continue
    const title = typeof obj.title === "string" ? obj.title : ""
    normalized.push({ id, url, previewUrl, title, provider: "giphy" })
  }
  return normalized
}

export async function searchGifs(query: string, limit = 12): Promise<GifSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const provider = getGifProviderName()
  if (!provider) return []

  if (provider === "klipy") {
    const key = getKlipyKey()
    const url = `https://api.klipy.com/api/v1/${key}/gifs/search?q=${encodeURIComponent(trimmed)}&per_page=${limit}&rating=g`
    try {
      const res = await fetch(url)
      if (!res.ok) return []
      const data = await res.json().catch(() => ({}))
      return normalizeKlipyResults(data)
    } catch {
      return []
    }
  }

  const url = provider === "tenor" ? getTenorSearchUrl(trimmed, limit) : getGiphySearchUrl(trimmed, limit)
  if (!url) return []

  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    return provider === "tenor" ? normalizeTenorResults(data) : normalizeGiphyResults(data)
  } catch {
    return []
  }
}
