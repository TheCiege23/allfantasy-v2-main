export type AllFantasyEntitlementUser = {
  email?: string | null
  username?: string | null
  name?: string | null
}

const STATIC_ALL_ACCESS_EMAILS = ["cjabar.henson@gmail.com"]

/*
 * ⚠ A PUBLISHED HANDLE IS A WEAK CREDENTIAL — BUT IT IS NOT WHAT MADE THE ESCALATION
 * POSSIBLE, AND REMOVING IT LOCKS THE FOUNDER OUT OF A REAL SIGN-IN PATH.
 *
 * This was deleted on 2026-08-28 as defence-in-depth after the session-update
 * escalation, and RESTORED the same day because the suite showed the reasoning was
 * wrong. `admin-access-state.test.ts` covers the founder signing in with
 * `email: "theciege@example.com"` — an address deliberately NOT on
 * STATIC_ALL_ACCESS_EMAILS — where this handle is the only thing that grants access.
 * The production row happens to carry the allowlisted email, which is what the removal
 * was justified on; that says nothing about a second sign-in provider.
 *
 * What actually closed the hole is upstream of this file and unchanged: lib/auth.ts no
 * longer takes `username` from the session-update payload (it re-reads from the
 * database), and /api/auth/complete-profile now probes case-insensitively before
 * writing one. The handle can no longer be self-assigned, so matching on it is safe.
 *
 * ✅ THE CLEAN END STATE IS TO MOVE THIS HANDLE INTO `ALL_ACCESS_USERNAMES` (env) AND
 * DELETE THE LITERAL — same capability, not published in a public repo. That needs an
 * env var set in Vercel, so it is the operator's action, not a code change.
 */
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
  // same rename attack worked against the field this function actually reads.
  //
  // Closed on 2026-08-28, and note WHERE: lib/auth.ts now re-reads the username from
  // the database on that trigger, and /api/auth/complete-profile probes
  // case-insensitively before writing one. Both fixes are upstream of this file.
  //
  // The rule that survives: a credential must be something the user cannot MINT ON
  // DEMAND. Provider-verified email qualifies. A self-chosen handle qualifies only for
  // as long as the write paths above stay gated — which is why deleting either of those
  // fixes silently re-opens this, and why the handle belongs in env rather than here.
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
