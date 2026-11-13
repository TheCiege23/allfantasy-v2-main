import { prisma } from "@/lib/prisma"
import { isAllFantasyTestEmail } from "@/lib/auth/admin"

type AppUserReader = {
  appUser: {
    findUnique(args: {
      where: { id: string }
      select: { email: true; emailVerified: true }
    }): Promise<{ email: string | null; emailVerified: Date | null } | null>
  }
}

/**
 * The email to hand to an email-keyed privilege check (`isSubscriptionEntitlementBypassUserId`,
 * the token-spend bypass), or `null` when it must not count.
 *
 * 🛑 AN ALLOWLISTED ADDRESS IS A CREDENTIAL ONLY ONCE THE ACCOUNT HAS PROVEN IT. The session
 * path already enforces that (lib/auth.ts `withholdUnprovenPrivilegedEmail`), but the
 * entitlement and token services are also called with emails read straight off AppUser rows,
 * and a row can hold an address nobody verified. Without this, registering an allowlisted
 * address that had no account yet bought unlimited plans and tokens on every such path.
 *
 * Ordinary emails pass through untouched and cost nothing; only a privileged address is
 * checked, against the row for THIS user id (an address someone else holds proves nothing).
 * A failed read answers "not proven" — fail closed.
 */
export async function provenPrivilegedEmail(
  userId: string | null | undefined,
  email: string | null | undefined,
  db: AppUserReader = prisma as unknown as AppUserReader,
): Promise<string | null> {
  const wanted = String(email ?? "").trim().toLowerCase()
  if (!wanted) return null
  if (!isAllFantasyTestEmail(wanted)) return email ?? null
  const id = String(userId ?? "").trim()
  if (!id) return null
  try {
    const row = await db.appUser.findUnique({ where: { id }, select: { email: true, emailVerified: true } })
    const proven = Boolean(row?.emailVerified) && String(row?.email ?? "").trim().toLowerCase() === wanted
    return proven ? (email ?? null) : null
  } catch {
    return null
  }
}
