/**
 * Decision OS — Phase 7.9 Iframe Adapter: sandbox/CSP recommendations.
 *
 * Contract constants only — a future runtime applies these to a real
 * `<iframe sandbox="...">` attribute and a real `Content-Security-Policy`
 * response header. No DOM access here.
 *
 * PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md §2 (iframe):
 *   - `sandbox="allow-scripts allow-popups"` only. `allow-same-origin` is
 *     NEVER combined with `allow-scripts` — that combination lets sandboxed
 *     content remove its own sandbox restrictions, defeating isolation.
 *   - `Content-Security-Policy: frame-ancestors <allowlisted origins>` on
 *     the AllFantasy-hosted iframe content page.
 */

export const IFRAME_SANDBOX_TOKENS = ['allow-scripts', 'allow-popups'] as const

export const IFRAME_SANDBOX_ATTRIBUTE = IFRAME_SANDBOX_TOKENS.join(' ')

/** Combining these two tokens lets sandboxed content escape its own sandbox — never permitted. */
export const IFRAME_FORBIDDEN_SANDBOX_PAIR = ['allow-scripts', 'allow-same-origin'] as const

export function containsForbiddenSandboxCombination(tokens: readonly string[]): boolean {
  return IFRAME_FORBIDDEN_SANDBOX_PAIR.every((forbidden) => tokens.includes(forbidden))
}

export interface SandboxValidationResult {
  valid: boolean
  errors: string[]
}

export function validateSandboxTokens(tokens: readonly string[]): SandboxValidationResult {
  const errors: string[] = []
  if (containsForbiddenSandboxCombination(tokens)) {
    errors.push(
      `sandbox tokens must never combine '${IFRAME_FORBIDDEN_SANDBOX_PAIR[0]}' with '${IFRAME_FORBIDDEN_SANDBOX_PAIR[1]}' — this lets sandboxed content remove its own sandbox`,
    )
  }
  return { valid: errors.length === 0, errors }
}

/** Builds a `Content-Security-Policy: frame-ancestors ...` directive value from an allowlist. */
export function buildCspFrameAncestors(allowedOrigins: readonly string[]): string {
  return `frame-ancestors ${allowedOrigins.join(' ')}`
}
