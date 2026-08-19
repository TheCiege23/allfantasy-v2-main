/**
 * Pure resolver for the audit identity of an authenticated admin action (e.g. the
 * `createdByAdmin` recorded on a beta invitation). Deliberately dependency-free so it can be
 * unit-tested and reused without pulling in the admin-auth/session machinery.
 *
 * The input is structurally compatible with `AdminUser` from `@/lib/adminAuth`.
 */
export type AdminAuditIdentityInput = {
  email?: string | null;
  id?: string | null;
  name?: string | null;
  /** How the session authenticated. "password" = shared-password login (no per-person identity). */
  authMethod?: string | null;
};

/**
 * Resolve a stable, honest audit identity. Resolution order, first non-empty wins:
 *   1. verified email
 *   2. authenticated user id
 *   3. explicit session name
 *   4. "password-admin" — the shared-password login METHOD (proves HOW the caller
 *      authenticated, never WHO they are, so it is a fixed label and never a real email)
 *   5. "unknown-admin" — only a genuinely identity-less / legacy session
 *
 * Deliberately never reads ADMIN_EMAILS: a shared password must not be attributed to a
 * specific named administrator.
 */
export function resolveAdminAuditIdentity(user?: AdminAuditIdentityInput | null): string {
  const email = user?.email?.trim();
  if (email) return email;
  const id = user?.id?.trim();
  if (id) return id;
  const name = user?.name?.trim();
  if (name) return name;
  if (user?.authMethod === "password") return "password-admin";
  return "unknown-admin";
}
