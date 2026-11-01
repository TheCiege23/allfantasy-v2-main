import "server-only"
import { getServedOrigin } from "@/lib/http/served-origin"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

/** Compare against configured origins, never Railway's bind address or forwarded host headers. */
export function hasTrustedPlayOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return false
  const served = getServedOrigin(request), canonical = getPublicSiteOrigin()
  const trusted = new Set([served, canonical])
  if ([served, canonical].some(value => value === "https://allfantasy.ai" || value === "https://www.allfantasy.ai")) {
    trusted.add("https://allfantasy.ai"); trusted.add("https://www.allfantasy.ai")
  }
  return trusted.has(origin)
}
