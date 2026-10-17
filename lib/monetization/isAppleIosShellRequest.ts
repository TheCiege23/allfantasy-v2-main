import { isIosAppUserAgent } from "@/lib/platform/iosApp"

/**
 * A defense in depth gate for the Stripe checkout routes: a request from the iOS
 * app (ios-app/, any build) must buy through Apple, never Stripe. Middleware
 * already refuses /api/monetization/checkout for the app's User-Agent; this keeps
 * the routes safe if that prefix list ever drifts.
 */
export function isAppleIosShellRequest(request: Request): boolean {
  return isIosAppUserAgent(request.headers.get("user-agent"))
}
