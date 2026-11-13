/**
 * The AllFantasy system account that OWNS a league no person has proven they run.
 *
 * Why it exists: `League.userId` is the league's AllFantasy owner, and ~150 places treat the owner
 * as its commissioner. A public ESPN league can be imported without cookies by anyone who picks
 * their team from the list — that proves nothing about who runs it, so the importer must not
 * become the owner. The system account owns it instead; every person reaches it through their
 * claimed team, and every owner-based commissioner check fails closed for all of them.
 *
 * A real commissioner gets commissioner rights the existing way: connect ESPN, the import proves
 * their team, and the team ESPN flags as the league manager (`LeagueTeam.isCommissioner`) is what
 * `lib/commissioner/permissions.ts` reads.
 *
 * 🛑 NEVER SIGN IN, NEVER EMAIL. The address is on the reserved `.invalid` TLD (RFC 2606), so no
 * mail can be delivered to it, and the account has no password or OAuth link.
 */
import { prisma } from '@/lib/prisma'

export const SYSTEM_LEAGUE_OWNER_ID = 'allfantasy-system-league-owner'
export const SYSTEM_LEAGUE_OWNER_EMAIL = 'league-owner@allfantasy.invalid'
/** `allfantasy` is in RESERVED_USERNAMES, so no person can be handed it. */
const USERNAMES = ['allfantasy', 'allfantasy_system_owner'] as const

export function isSystemLeagueOwner(userId: string | null | undefined): boolean {
  return userId === SYSTEM_LEAGUE_OWNER_ID
}

let ensured: Promise<string> | null = null

/** Creates the account on first use; afterwards one cached promise per process. */
export function ensureSystemLeagueOwner(): Promise<string> {
  if (!ensured) {
    ensured = createIfMissing().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

async function createIfMissing(): Promise<string> {
  const existing = await prisma.appUser.findUnique({
    where: { id: SYSTEM_LEAGUE_OWNER_ID },
    select: { id: true },
  })
  if (existing) return existing.id

  let lastError: unknown = null
  for (const username of USERNAMES) {
    try {
      const created = await prisma.appUser.create({
        data: { id: SYSTEM_LEAGUE_OWNER_ID, email: SYSTEM_LEAGUE_OWNER_EMAIL, username },
        select: { id: true },
      })
      return created.id
    } catch (err) {
      lastError = err
      // A concurrent first use created it, or the username is taken: re-read before retrying.
      const raced = await prisma.appUser.findUnique({
        where: { id: SYSTEM_LEAGUE_OWNER_ID },
        select: { id: true },
      })
      if (raced) return raced.id
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not create the system league owner.')
}

/** Test seam. */
export function resetSystemLeagueOwnerCacheForTests(): void {
  ensured = null
}
