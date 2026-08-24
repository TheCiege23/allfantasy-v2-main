import { resolveAuthRedirect } from "@/lib/auth/AuthRedirectResolver"

export interface AuthSessionRouteInput {
  callbackUrl?: string | null
  next?: string | null
  returnTo?: string | null
  intent?: string | null
  fallback?: string
}

export function resolveAuthSessionDestination(input: AuthSessionRouteInput): string {
  const route = resolveAuthRedirect({
    callbackUrl: input.callbackUrl ?? null,
    next: input.next ?? null,
    returnTo: input.returnTo ?? null,
    intent: input.intent ?? null,
    fallback: input.fallback,
  })
  if (route) return route
  return input.fallback ?? '/core'
}
