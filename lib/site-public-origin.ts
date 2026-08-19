/**
 * Single public HTTPS origin for SEO metadata, emails, and canonical host redirects.
 * Prefer NEXT_PUBLIC_SITE_URL / PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL / NEXTAUTH_URL in production; default www.
 */

export const DEFAULT_PUBLIC_SITE_ORIGIN = "https://www.allfantasy.ai"

export function normalizeBaseUrl(value?: string | null): string {
  const raw = String(value ?? "").trim()

  if (!raw || raw === "https://" || raw === "http://") {
    return DEFAULT_PUBLIC_SITE_ORIGIN
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  try {
    const parsed = new URL(candidate)
    if (!parsed.hostname || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      return DEFAULT_PUBLIC_SITE_ORIGIN
    }
    return parsed.origin
  } catch {
    return DEFAULT_PUBLIC_SITE_ORIGIN
  }
}

/**
 * Returns origin only, e.g. `https://www.allfantasy.ai` (no trailing slash).
 */
export function getPublicSiteOrigin(): string {
  const raw =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        process.env.PUBLIC_SITE_URL?.trim() ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        process.env.NEXT_PUBLIC_APP_DOMAIN?.trim() ||
        process.env.NEXTAUTH_URL?.trim() ||
        process.env.APP_URL?.trim() ||
        process.env.SITE_URL?.trim() ||
        process.env.RAILWAY_PUBLIC_DOMAIN?.trim() ||
        process.env.VERCEL_URL?.trim() ||
        ""
      : ""
  return normalizeBaseUrl(raw)
}

export function getPublicSiteHostname(): string {
  try {
    return new URL(getPublicSiteOrigin()).hostname.toLowerCase()
  } catch {
    return "www.allfantasy.ai"
  }
}

/**
 * Absolute origin for building links that must return to THIS deployment — e.g. the admin
 * magic link. A PREVIEW deployment uses its own Vercel-assigned host so a preview-issued
 * link returns to the preview (not production); PRODUCTION keeps the configured canonical
 * origin exactly as before.
 *
 * SECURITY: derived ONLY from Vercel-set environment variables (VERCEL_ENV / VERCEL_BRANCH_URL
 * / VERCEL_URL) and the configured site URL — NEVER from the request Host / X-Forwarded-Host
 * header. An attacker cannot point an emailed admin link at their own host by spoofing Host.
 */
export function getDeploymentLinkOrigin(env: NodeJS.ProcessEnv = process.env): string {
  // Preview: the deployment's own Vercel host. Prefer the stable branch alias
  // (VERCEL_BRANCH_URL) over the per-deploy URL (VERCEL_URL); both are Vercel-set.
  if (env.VERCEL_ENV === "preview") {
    const previewHost = env.VERCEL_BRANCH_URL?.trim() || env.VERCEL_URL?.trim()
    if (previewHost) return normalizeBaseUrl(previewHost)
  }

  // Production / everything else: the configured canonical origin — unchanged behavior.
  const configured = env.PUBLIC_SITE_URL?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim() || ""
  if (configured) return normalizeBaseUrl(configured)

  // Last resort (e.g. a non-preview Vercel build with nothing configured): the deploy host.
  if (env.VERCEL_URL?.trim()) return normalizeBaseUrl(env.VERCEL_URL)

  // Local/dev with nothing set: empty → caller falls back to a relative link.
  return ""
}
