export type AllFantasyEntitlementUser = {
  email?: string | null
  username?: string | null
  name?: string | null
}

const STATIC_ALL_ACCESS_EMAILS = ["cjabar.henson@gmail.com"]
const STATIC_ALL_ACCESS_USERNAMES = ["theciege26"]

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(/[\n\r,;]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

function parseUsernameList(value: string | undefined): string[] {
  return (value || '')
    .split(/[\n\r,;]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

export function normalizeAdminEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase()
}

export function isAllFantasyTestEmail(email: string | null | undefined): boolean {
  const normalized = normalizeAdminEmail(email)
  if (!normalized) return false
  if (STATIC_ALL_ACCESS_EMAILS.includes(normalized)) return true
  return [
    ...parseList(process.env.ALL_ACCESS_EMAILS),
    ...parseList(process.env.ADMIN_EMAILS),
  ].includes(normalized)
}

export function isAllFantasyTestUsername(username: string | null | undefined): boolean {
  const normalized = String(username ?? "").trim().toLowerCase()
  if (!normalized) return false
  if (STATIC_ALL_ACCESS_USERNAMES.includes(normalized)) return true
  return parseUsernameList(process.env.ALL_ACCESS_USERNAMES).includes(normalized)
}

export function hasAllFantasyTestAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  // SECURITY: `user.name` is deliberately NOT accepted as a credential.
  //
  // It is a *display* name, not an identity. AppUser has no `name` column at all —
  // session.user.name is populated from token.name (lib/auth.ts), which is set from
  // the OAuth provider's profile name. That value is freely editable by the end user
  // in their own Google/social account. Because STATIC_ALL_ACCESS_USERNAMES is a
  // guessable literal, checking it against user.name meant anyone could rename their
  // Google account to that handle, sign in, and receive full site-admin: /admin
  // access (lib/adminAuth.ts getAppSessionAdminAccessState), token-spend bypass
  // (lib/tokens/TokenSpendService.ts) and entitlement bypass
  // (lib/subscription/entitlement-middleware.ts).
  //
  // Only provider-verified email and the app-owned unique `username` may confer
  // access. Both legitimate paths are preserved: the founder matches on email via
  // STATIC_ALL_ACCESS_EMAILS, and "theciege26" still matches as a real username.
  return isAllFantasyTestEmail(user?.email) ||
    isAllFantasyTestUsername(user?.username)
}

export function resolveAdminEmail(email: string | null | undefined): boolean {
  return isAllFantasyTestEmail(email)
}

export function isSiteAdmin(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}

export function isAfCommissioner(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}

export function hasAiAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}

export function hasPoolAdminAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}

export function hasChatAdminAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  return hasAllFantasyTestAccess(user)
}
