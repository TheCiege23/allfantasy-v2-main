import {
  clearRememberedAuthIntent,
  readRememberedAuthIntent,
  rememberAuthIntent,
  resolvePostAuthIntentDestination,
} from "@/lib/auth/PostAuthIntentRouter"

export interface UnifiedAuthOrchestratorInput {
  callbackUrl?: string | null
  next?: string | null
  returnTo?: string | null
  intent?: string | null
  isAdmin?: boolean
  fallback?: string
}

export function resolveUnifiedAuthDestination(
  input: UnifiedAuthOrchestratorInput
): string {
  return resolvePostAuthIntentDestination({
    ...input,
    rememberedIntent: readRememberedAuthIntent(),
  })
}

/** Post-signup: default `/core`, preserve invite/join/verify and product intents; never `/login`. */
export function resolveUnifiedAuthDestinationForSignup(
  input: UnifiedAuthOrchestratorInput
): string {
  return resolvePostAuthIntentDestination({
    ...input,
    rememberedIntent: readRememberedAuthIntent(),
    forSignup: true,
  })
}

export function rememberUnifiedAuthDestination(path: string): void {
  rememberAuthIntent(path)
}

export function clearUnifiedAuthDestination(): void {
  clearRememberedAuthIntent()
}
