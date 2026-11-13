import { type PostAuthIntentInput, resolvePostAuthIntentDestination, buildLoginHrefWithIntent } from "@/lib/auth/PostAuthIntentRouter"

interface AuthRedirectInput extends PostAuthIntentInput {}

export function resolveAuthRedirect(input: AuthRedirectInput): string {
  return resolvePostAuthIntentDestination(input)
}

export function resolveLoginHrefFromRequestedPath(requestedPath: string): string {
  return buildLoginHrefWithIntent(requestedPath)
}

