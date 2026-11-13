/**
 * Phase 1 — shared display-name resolver.
 *
 * Order of preference:
 *   1. `displayName` (UserProfile.displayName)
 *   2. `username`    (AppUser.username)
 *   3. `sessionName` (session.user.name) — only if it is NOT an email
 *   4. fallback string (default: 'Manager')
 *
 * NEVER falls back to `email.split('@')[0]` — that leaks PII into headers,
 * greetings, and chat surfaces.
 */
type ResolveDisplayNameInput = {
  displayName?: string | null
  username?: string | null
  sessionName?: string | null
  email?: string | null
  fallback?: string
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed
}

function looksLikeEmail(value: string): boolean {
  return value.includes('@') && value.includes('.')
}

export function resolveDisplayName(input: ResolveDisplayNameInput): string {
  const fallback = input.fallback?.trim() || 'Manager'

  const displayName = clean(input.displayName)
  if (displayName) return displayName

  const username = clean(input.username)
  if (username) return username

  const sessionName = clean(input.sessionName)
  if (sessionName && !looksLikeEmail(sessionName)) return sessionName

  return fallback
}
