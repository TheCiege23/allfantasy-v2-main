import { isInIosAppClient, isInIosAppWithIapClient } from "@/lib/platform/iosApp"
import { isTrustedWebActivity } from "@/lib/platform/isTrustedWebActivity"

/**
 * Where this page is running, for analytics: the App Store app, the Google Play
 * app, or the plain website. Both apps ARE the website (a WKWebView shell and a
 * Trusted Web Activity), so without this label every app user reads as "web" in
 * PostHog and app usage cannot be split from browser usage.
 *
 * Read-only labelling. Never gate or grant anything on it — the iOS marker is a
 * User-Agent substring and can be forged (see lib/platform/iosApp.ts).
 */
export type AppPlatform = "ios_app" | "android_app" | "web"

export function detectAppPlatform(): AppPlatform {
  if (isInIosAppClient()) return "ios_app"
  if (isTrustedWebActivity()) return "android_app"
  return "web"
}

/**
 * PostHog super properties, attached to every event this page sends.
 *
 * ⚠ Registered on EVERY load, never only once: the Android app runs inside Chrome
 * and shares its cookies, so a value persisted by the app would otherwise follow
 * the same person into an ordinary Chrome tab and label web visits as app visits.
 * Re-registering on load overwrites it with what this page actually is.
 */
export function appPlatformProperties(): { app_platform: AppPlatform; ios_iap_build?: boolean } {
  const app_platform = detectAppPlatform()
  if (app_platform === "ios_app") return { app_platform, ios_iap_build: isInIosAppWithIapClient() }
  return { app_platform }
}
