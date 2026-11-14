/**
 * PostAuthIntentRouter — where to send the user after login/signup/verify.
 * Re-exports and extends auth-intent-resolver for cross-product routing.
 */

import { safeRedirectPath } from "@/lib/auth/auth-intent-resolver"

/** Re-export for routing layer. */
export {
  safeRedirectPath,
}

