export type AllFantasyEntitlementUser = {
  email?: string | null
  username?: string | null
  name?: string | null
}

const STATIC_ALL_ACCESS_EMAILS = ["cjabar.henson@gmail.com"]

/*
 * 🛑 THERE IS NO STATIC USERNAME ALLOWLIST, AND ADDING ONE BACK IS A VULNERABILITY.
 *
 * This repo is PUBLIC, so any handle written here is a published credential: the only
 * thing standing between a stranger and site admin becomes their ability to acquire that
 * string. It has been acquirable twice. Once through `user.name` (an OAuth display name
 * the user edits in their own Google account — see the comment on hasAllFantasyTestAccess
 * below), and once through next-auth's session-update trigger, which handed the username
 * field straight from a request body into the token without writing a row at all.
 *
 * An email is a different kind of claim: it is verified by the identity provider, and the
 * user cannot mint one on demand. That is why STATIC_ALL_ACCESS_EMAILS survives and this
 * did not. The founder's account is covered by it — verified against production before
 * this line was removed, so nobody lost access.
 *
 * ALL_ACCESS_USERNAMES (env) still works for temporary grants. Env vars are not published.
 */


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
  return parseUsernameList(process.env.ALL_ACCESS_USERNAMES).includes(normalized)
}

export function hasAllFantasyTestAccess(user: AllFantasyEntitlementUser | null | undefined): boolean {
  // SECURITY: `user.name` is deliberately NOT accepted as a credential.
  //
  // It is a *display* name, not an identity. AppUser has no `name` column at all —
  // session.user.name is populated from token.name (lib/auth.ts), which is set from
  // the OAuth provider's profile name. That value is freely editable by the end user
  // in their own Google/social account, so checking a guessable handle against
  // user.name meant anyone could rename their Google account to it, sign in, and
  // receive full site-admin: /admin access (lib/adminAuth.ts
  // getAppSessionAdminAccessState), token-spend bypass
  // (lib/tokens/TokenSpendService.ts) and entitlement bypass
  // (lib/subscription/entitlement-middleware.ts).
  //
  // ⚠ THE ORIGINAL FIX HERE WAS HALF A FIX, AND THE OTHER HALF SHIPPED FOR MONTHS.
  //
  // It concluded that `username` was safe to trust because, unlike `name`, it is the
  // app-owned unique column. That is true of the column and was never true of the
  // FIELD: lib/auth.ts's jwt callback let next-auth's session-update trigger write
  // `session.user.username` from a request body without touching the database, so the
  // same rename attack worked against the field this function actually reads. Both
  // halves are now closed — the update trigger re-reads from the database, and the
  // published static handle is gone (see the note at the top of this file).
  //
  // The rule that survives: a credential must be something the user cannot mint on
  // demand. Provider-verified email qualifies. A self-chosen handle does not, which is
  // why the remaining username path is env-configured and deliberately not published.
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
