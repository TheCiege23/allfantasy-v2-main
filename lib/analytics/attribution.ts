/**
 * Governed social/campaign attribution.
 *
 * ONE module owns how a campaign touch is parsed, normalized, and represented.
 * Before this existed, UTM handling was ad-hoc `urlParams.get('utm_source')` inside
 * individual page components (app/af-legacy/page.tsx, app/components/EarlyAccessUpsell.tsx),
 * which meant attribution existed only on the pages someone remembered to wire, was
 * client-supplied (therefore forgeable), and was lost across OAuth redirects.
 *
 * Everything here is pure and dependency-free so the SAME logic runs in edge middleware,
 * in Node route handlers, and in unit tests. No Prisma, no next/headers, no node:crypto.
 *
 * THREAT MODEL — deliberately stated rather than overclaimed:
 * touches are captured server-side in middleware and stored in httpOnly cookies, so
 * page scripts and request bodies cannot set them. A determined user can still craft
 * their own cookie jar or simply visit a tracked link; attribution is business
 * analytics, not an authorization input, and nothing may gate access on it.
 */

/** Canonical platforms. `direct` = no campaign/referrer signal; `other` = a real but unmapped source. */
export const ATTRIBUTION_PLATFORMS = [
  "tiktok",
  "instagram",
  "facebook",
  "x",
  "youtube",
  "discord",
  "reddit",
  "email",
  "direct",
  "other",
] as const

export type AttributionPlatform = (typeof ATTRIBUTION_PLATFORMS)[number]

export type AttributionTouch = {
  platform: AttributionPlatform
  source: string | null
  medium: string | null
  campaign: string | null
  content: string | null
  term: string | null
  /** Opaque campaign id from `af_cid` — lets one campaign span several utm_content values. */
  campaignId: string | null
  /** Referral code (`ref`), when the link carries one. */
  referralCode: string | null
  /** Path the visitor landed on, query stripped. */
  landingPath: string
  /** Document referrer host only — never the full URL, which can carry PII in its query. */
  referrerHost: string | null
  /** ISO timestamp of this touch. */
  at: string
}

/** Query keys that constitute a campaign signal. A URL with none of these is not a touch. */
const CAMPAIGN_QUERY_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "af_cid",
  "ref",
] as const

/**
 * utm_source values (and referrer hosts) that map to each canonical platform.
 * Matching is exact on the normalized token, plus host-suffix matching for referrers,
 * so `m.tiktok.com` resolves but an unrelated `nottiktok.example` never does.
 */
const PLATFORM_ALIASES: Record<Exclude<AttributionPlatform, "direct" | "other">, string[]> = {
  tiktok: ["tiktok", "tik_tok", "tt"],
  instagram: ["instagram", "ig", "insta"],
  facebook: ["facebook", "fb", "meta"],
  x: ["x", "twitter", "tw"],
  youtube: ["youtube", "yt", "shorts"],
  discord: ["discord", "dc"],
  reddit: ["reddit"],
  email: ["email", "newsletter", "mail", "resend"],
}

const REFERRER_HOST_ALIASES: Record<Exclude<AttributionPlatform, "direct" | "other">, string[]> = {
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com", "l.instagram.com"],
  facebook: ["facebook.com", "l.facebook.com", "fb.me", "fb.com"],
  x: ["x.com", "twitter.com", "t.co"],
  youtube: ["youtube.com", "youtu.be", "m.youtube.com"],
  discord: ["discord.com", "discord.gg", "discordapp.com"],
  reddit: ["reddit.com", "old.reddit.com", "out.reddit.com"],
  email: [],
}

/** Cap every stored field so a hostile or accidental mega-query can't bloat the cookie or a DB row. */
const MAX_FIELD_LENGTH = 120

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_FIELD_LENGTH)
}

function normalizeToken(value: string | null): string | null {
  if (!value) return null
  return value.toLowerCase().replace(/[\s_-]+/g, "")
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

/**
 * Resolve the canonical platform. An explicit utm_source always wins over the referrer,
 * because that is what the founder controls when building the link.
 *
 * Returns `other` — never `direct` — when there IS a signal we simply don't recognize.
 * Collapsing an unmapped real source into `direct` would silently understate campaign
 * traffic and overstate organic, so the two are kept distinguishable.
 */
export function normalizePlatform(
  utmSource: string | null | undefined,
  referrerHost?: string | null,
): AttributionPlatform {
  const token = normalizeToken(clean(utmSource))
  if (token) {
    for (const [platform, aliases] of Object.entries(PLATFORM_ALIASES)) {
      if (aliases.includes(token)) return platform as AttributionPlatform
    }
    return "other"
  }

  const host = clean(referrerHost)?.toLowerCase().replace(/^www\./, "")
  if (host) {
    for (const [platform, hosts] of Object.entries(REFERRER_HOST_ALIASES)) {
      if (hosts.some((h) => hostMatches(host, h))) return platform as AttributionPlatform
    }
    return "other"
  }

  return "direct"
}

/** Referrer host only. Returns null for same-origin, empty, or unparseable referrers. */
export function extractReferrerHost(referrer: string | null | undefined, selfHost?: string | null): string | null {
  const raw = clean(referrer)
  if (!raw) return null
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "")
    if (!host) return null
    const self = clean(selfHost)?.toLowerCase().replace(/^www\./, "")
    if (self && host === self) return null
    return host.slice(0, MAX_FIELD_LENGTH)
  } catch {
    return null
  }
}

/**
 * Build a touch from a request URL. Returns null when there is no campaign signal AND no
 * external referrer — an ordinary internal navigation must not overwrite a real touch.
 */
export function parseAttributionTouch(input: {
  url: URL
  referrer?: string | null
  now: Date
}): AttributionTouch | null {
  const { url, referrer, now } = input
  const params = url.searchParams

  const hasCampaignSignal = CAMPAIGN_QUERY_KEYS.some((key) => clean(params.get(key)) !== null)
  const referrerHost = extractReferrerHost(referrer, url.hostname)

  if (!hasCampaignSignal && !referrerHost) return null

  const source = clean(params.get("utm_source"))

  return {
    platform: normalizePlatform(source, referrerHost),
    source,
    medium: clean(params.get("utm_medium")),
    campaign: clean(params.get("utm_campaign")),
    content: clean(params.get("utm_content")),
    term: clean(params.get("utm_term")),
    campaignId: clean(params.get("af_cid")),
    referralCode: clean(params.get("ref")),
    landingPath: url.pathname.slice(0, MAX_FIELD_LENGTH) || "/",
    referrerHost,
    at: now.toISOString(),
  }
}

/**
 * Compact wire form. Short keys keep the cookie well under the 4KB limit even with
 * every field populated, which matters because first-touch and latest-touch are two
 * separate cookies carried on every request.
 */
type EncodedTouch = {
  p: string
  s?: string
  m?: string
  c?: string
  ct?: string
  t?: string
  ci?: string
  rc?: string
  lp?: string
  rh?: string
  at?: string
}

export function encodeTouch(touch: AttributionTouch): string {
  const encoded: EncodedTouch = { p: touch.platform }
  if (touch.source) encoded.s = touch.source
  if (touch.medium) encoded.m = touch.medium
  if (touch.campaign) encoded.c = touch.campaign
  if (touch.content) encoded.ct = touch.content
  if (touch.term) encoded.t = touch.term
  if (touch.campaignId) encoded.ci = touch.campaignId
  if (touch.referralCode) encoded.rc = touch.referralCode
  if (touch.landingPath) encoded.lp = touch.landingPath
  if (touch.referrerHost) encoded.rh = touch.referrerHost
  encoded.at = touch.at
  return encodeURIComponent(JSON.stringify(encoded))
}

/** Bounded — enough for the observed double-encoding plus one margin; never unbounded. */
const MAX_DECODE_PASSES = 3

/**
 * Parse a stored touch, tolerating however many percent-encoding layers the transport
 * applied.
 *
 * This is not defensive padding — it is load-bearing. `encodeTouch` percent-encodes, and
 * `NextResponse.cookies.set()` encodes AGAIN, so the wire value is double-encoded. Readers
 * then see different layer counts depending on how they access the cookie:
 *   - `request.cookies.get()` / `next/headers` cookies() decode once → one layer left
 *   - parsing the raw `Cookie` header decodes nothing        → two layers left
 * A fixed single decode works for the first and silently fails for the second, which made
 * /api/analytics/track record every event with no campaign fields — indistinguishable from
 * genuine direct traffic. Decoding until it parses makes every reader agree.
 */
export function decodeTouch(raw: string | null | undefined): AttributionTouch | null {
  if (!raw) return null
  try {
    let candidate = raw
    let parsed: EncodedTouch | null = null

    for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
      try {
        parsed = JSON.parse(candidate) as EncodedTouch
        break
      } catch {
        const next = decodeURIComponent(candidate)
        // No progress means further passes cannot help; stop rather than spin.
        if (next === candidate) return null
        candidate = next
      }
    }

    if (!parsed || typeof parsed !== "object") return null

    const platform = ATTRIBUTION_PLATFORMS.includes(parsed.p as AttributionPlatform)
      ? (parsed.p as AttributionPlatform)
      : "other"

    return {
      platform,
      source: clean(parsed.s),
      medium: clean(parsed.m),
      campaign: clean(parsed.c),
      content: clean(parsed.ct),
      term: clean(parsed.t),
      campaignId: clean(parsed.ci),
      referralCode: clean(parsed.rc),
      landingPath: clean(parsed.lp) ?? "/",
      referrerHost: clean(parsed.rh),
      at: clean(parsed.at) ?? new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Should a newly parsed touch replace the stored latest-touch?
 *
 * A bare external referrer (platform resolved purely from the referrer, no UTM at all)
 * does NOT displace a real tracked campaign — otherwise a visitor who arrives via a
 * tracked TikTok link, then returns from a Google search, loses the campaign that
 * actually earned them. An explicit campaign signal always wins.
 */
export function shouldReplaceLatestTouch(
  existing: AttributionTouch | null,
  incoming: AttributionTouch,
): boolean {
  if (!existing) return true
  const incomingHasCampaign = Boolean(incoming.source || incoming.campaign || incoming.campaignId)
  const existingHasCampaign = Boolean(existing.source || existing.campaign || existing.campaignId)
  if (incomingHasCampaign) return true
  if (existingHasCampaign) return false
  return true
}

/** Flat, DB/analytics-friendly projection. `prefix` distinguishes first vs latest touch. */
export function touchToMeta(touch: AttributionTouch, prefix: "first" | "latest"): Record<string, string> {
  const meta: Record<string, string> = {
    [`${prefix}_platform`]: touch.platform,
    [`${prefix}_at`]: touch.at,
  }
  if (touch.source) meta[`${prefix}_source`] = touch.source
  if (touch.medium) meta[`${prefix}_medium`] = touch.medium
  if (touch.campaign) meta[`${prefix}_campaign`] = touch.campaign
  if (touch.content) meta[`${prefix}_content`] = touch.content
  if (touch.term) meta[`${prefix}_term`] = touch.term
  if (touch.campaignId) meta[`${prefix}_campaign_id`] = touch.campaignId
  if (touch.referralCode) meta[`${prefix}_referral_code`] = touch.referralCode
  if (touch.landingPath) meta[`${prefix}_landing_path`] = touch.landingPath
  if (touch.referrerHost) meta[`${prefix}_referrer_host`] = touch.referrerHost
  return meta
}
