/**
 * Image-URL normalisation with no dependencies — safe to import from anywhere,
 * including modules that may reach a client bundle. The byte-level placeholder
 * check lives in `apiSportsPlaceholder.ts`, which needs `node:crypto`.
 *
 * TheSportsDB's `www.` image host is dead. Its contract
 * (`contracts/thesportsdb/ENDPOINTS.yaml` → `cdn_hosts`) already said both `r2.`
 * and `www.` appear in the same response and to "normalize at ingestion";
 * nothing did. Measured 2026-10-01: 106 of 106 sampled stored `www.` image URLs
 * returned 404, and the same path on `r2.` returned the image.
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
