import { resolvePostAuthIntentDestination } from "@/lib/auth/PostAuthIntentRouter"
import { canonicalizeProductRoute } from "@/lib/routing/canonicalizeProductRoute"

interface SignupQueryShape {
  next?: string | null
  callbackUrl?: string | null
  returnTo?: string | null
  intent?: string | null
}

export function resolveSignupRedirectPath(input: SignupQueryShape): string {
  return resolvePostAuthIntentDestination({
    callbackUrl: input.callbackUrl,
    next: input.next,
    returnTo: input.returnTo,
    intent: input.intent,
    forSignup: true,
  })
}

export function resolvePostSignupCallbackUrl(input: {
  redirectAfterSignup: string
  verificationMethod?: 'EMAIL' | 'PHONE' | string | null
}): string {
  if (input.verificationMethod === 'PHONE') {
    const returnTo = canonicalizeProductRoute(input.redirectAfterSignup)
    return `/verify?method=phone&error=VERIFICATION_REQUIRED&returnTo=${encodeURIComponent(returnTo)}`
  }
  return input.redirectAfterSignup
}
