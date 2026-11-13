/**
 * PostAuthIntentRouter — where to send the user after login/signup/verify.
 * Re-exports and extends auth-intent-resolver for cross-product routing.
 */

import {
  safeRedirectPath,
  getRedirectAfterLogin,
  getRedirectAfterSignup,
  loginUrlWithIntent,
  signupUrlWithIntent,
} from "@/lib/auth/auth-intent-resolver"

/** Re-export for routing layer. */
export {
  safeRedirectPath,
  getRedirectAfterLogin,
  getRedirectAfterSignup,
  loginUrlWithIntent,
  signupUrlWithIntent,
}

