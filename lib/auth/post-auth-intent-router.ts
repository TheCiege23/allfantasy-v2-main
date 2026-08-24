/**
 * Post-auth intent routing: suggested destinations per entry point.
 * Use with safeRedirectPath so URL is always safe.
 */
import { resolvePostAuthIntentDestination } from "./PostAuthIntentRouter"

/** Default destination when user comes from main landing (no product chosen). */
export const DEFAULT_LANDING_AFTER_AUTH = "/core"

/** When user explicitly chose Sports App (e.g. sign up from sports-app intent). */
export const SPORTS_APP_AFTER_AUTH = "/core"

/** When user explicitly chose Bracket (e.g. sign up from /bracket). */
export const BRACKET_AFTER_AUTH = "/brackets"

/** When user explicitly chose Legacy. */
export const LEGACY_AFTER_AUTH = "/af-legacy"

/** When user is admin and was heading to admin. */
export const ADMIN_AFTER_AUTH = "/admin"

/**
 * Resolve a post-auth destination from the given intent path.
 * Returns a safe path (no open redirect).
 */
export function resolvePostAuthDestination(intentPath: string | null | undefined): string {
  return resolvePostAuthIntentDestination({
    callbackUrl: intentPath,
  })
}
