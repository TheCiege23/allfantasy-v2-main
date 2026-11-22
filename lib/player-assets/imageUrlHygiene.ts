/**
 * Image-URL normalisation with no dependencies — safe to import from anywhere,
 * including modules that may reach a client bundle. The byte-level placeholder
 * check lives in `apiSportsPlaceholder.ts`, which needs `node:crypto`.
 *
 * TheSportsDB image hosts are not fully synchronized. Its contract
 * (`contracts/thesportsdb/ENDPOINTS.yaml` → `cdn_hosts`) already said both `r2.`
 * and `www.` appear in the same response and to "normalize at ingestion";
 * nothing did. Measured 2026-10-01: 106 of 106 sampled stored `www.` image URLs
 * returned 404, and the same path on `r2.` returned the image.
 * Measured 2026-10-29: five newer NBA/NFL cutouts showed the reverse.
 * Keep r2 as the ingestion default and try the identical path on the other
 * known image host after a browser load error.
 */

const SPORTSDB_WWW_IMAGE = /^https?:\/\/www\.thesportsdb\.com\/images\//i

/**
 * Rewrite a TheSportsDB `www.` image URL onto the live `r2.` host. Anything
 * else — including `www.` pages that are not images — is returned unchanged
 * apart from trimming.
 */
export function normalizeTheSportsDbImageUrl(url: string): string
export function normalizeTheSportsDbImageUrl(url: string | null | undefined): string | null
export function normalizeTheSportsDbImageUrl(url: string | null | undefined): string | null {
  if (url == null) return null
  return url.trim().replace(SPORTSDB_WWW_IMAGE, 'https://r2.thesportsdb.com/images/')
}

export function isApiSportsImageUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /^https?:\/\/media\.api-sports\.io\//i.test(url.trim())
}

/** The vendor's image hosts can lag each other. Never change the asset path. */
export function alternateTheSportsDbImageUrl(url: string): string | null {
  const match = /^https:\/\/(r2|www)\.thesportsdb\.com(\/images\/[^?#]*)([?#].*)?$/i.exec(url.trim())
  if (!match) return null
  const host = match[1].toLowerCase() === 'r2' ? 'www' : 'r2'
  return `https://${host}.thesportsdb.com${match[2]}${match[3] ?? ''}`
}
