/**
 * Accept a provider's image field only when it is actually a URL.
 *
 * 🛑 WHY THIS EXISTS: Rolling Insights answers a missing headshot with the
 * literal string `contact_support` (a Material icon name), not with null.
 * Measured on production 2026-09-25: 9,555 NFL `SportsPlayer` rows from
 * `rolling_insights` carried `imageUrl = 'contact_support'`. Rendered as an
 * `<img src>`, a bare word is a RELATIVE URL — every one became a 404 request
 * to `/contact_support` and a broken image, and the /core home preloaded it.
 *
 * Absolute http(s), protocol-relative and root-relative paths pass; anything
 * else (icon names, UUID file stems, "null", "N/A") is treated as absent so the
 * caller falls through to its next headshot source.
 */
export function toImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  if (v.startsWith('//')) return v
  if (v.startsWith('/') && !v.startsWith('//')) return v
  if (/^data:image\//i.test(v)) return v
  return null
}
