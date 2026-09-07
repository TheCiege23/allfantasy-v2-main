import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { League } from '@prisma/client'
import { ACTIVE_LEAGUE_COOKIE_KEY } from './activeLeague/constants'

export interface ActiveLeagueOption {
  id: string
  name: string
}

function isActiveStatus(league: League | null): league is League {
  if (!league) return false
  const status = String(league.status ?? '').trim().toUpperCase()
  return !status || !['ARCHIVED', 'COMPLETE', 'COMPLETED', 'CLOSED'].includes(status)
}

/**
 * The active (non-archived) leagues this user is COMMISSIONER of.
 *
 * 🛑 THIS USED TO RESOLVE LEAGUES THE USER HAD A ROSTER IN, WHICH IS A DIFFERENT QUESTION AND
 * ANSWERED IT WRONG IN BOTH DIRECTIONS. Commissioner OS is a commissioner's tool: every module in
 * it — manager retention risk, per-manager engagement scores, who is about to quit — is
 * commissioner-grade intelligence about other people in the league. Resolving by roster meant an
 * ordinary league member opened it and saw all of that about their leaguemates, while a
 * commissioner who does not hold a team in their own league saw nothing at all.
 *
 * Measured on prod 2026-09-07 against the 79 real accounts: 3 users resolved a league they do not
 * commission (the exposure), and **6 commissioners resolved nothing in a league they own** (locked
 * out of their own tool). Both are this one query.
 *
 * ⚠ COMMISSIONER = `League.userId`, AND THIS IS DELIBERATELY NOT A NEW DEFINITION. It is the one
 * `lib/commissioner/permissions.ts` exports and that the 64 `/api/commissioner/*` routes already
 * use at 69 call sites. This route tree's own comment warned that the app computes "isCommissioner"
 * four-plus disagreeing ways and that picking one needs a decision; the decision here is to reuse
 * the existing majority authority rather than add a fifth.
 *
 * ⚠ AND `league_teams.isCommissioner` IS NOT USABLE FOR THIS, THOUGH IT LOOKS LIKE IT SHOULD BE.
 * Its `platformUserId` is a PROVIDER id, not an AllFantasy user id — 3,169 of 3,339 claimed rows
 * hold a numeric Sleeper id against `League.userId`'s UUID. Comparing them appears to show the two
 * signals agreeing on only 13 of 242 leagues; that 13 is just the count of rows that happen to
 * hold a UUID, not evidence about commissioners. The same id-space split is why the old roster
 * query matched so little: only 351 of 3,418 `rosters.platformUserId` values are AF user ids.
 */
async function getActiveLeaguesForSessionUser(): Promise<League[]> {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return []

  const owned = await prisma.league.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })

  return owned.filter((league): league is League => isActiveStatus(league))
}

/** The current commissioner's own active leagues, for the header's league selector to list. */
export async function listActiveLeaguesForUser(): Promise<ActiveLeagueOption[]> {
  const leagues = await getActiveLeaguesForSessionUser()
  return leagues.map((l) => ({ id: String(l.id), name: l.name ?? 'Untitled league' }))
}

/**
 * The selector's cookie, or null when there is no request scope to read one from.
 *
 * 🛑 THE `catch` IS NARROW ON PURPOSE, AND WIDENING IT WOULD BE A PRODUCTION BUG.
 * `cookies()` throws two very different things, and only one of them is safe to
 * swallow:
 *
 *   - Outside a request scope it throws a PLAIN `Error` ("`cookies` was called
 *     outside a request scope"), carrying no `digest`. That is every vitest run —
 *     a unit test has no request — and it is not an error condition for this
 *     function: with no request there is no user cookie, so there is no override
 *     and the caller should fall back to the "most recently created owned league" default.
 *   - During prerendering it throws Next's `DynamicServerError`, carrying
 *     `digest: 'DYNAMIC_SERVER_USAGE'`. That one is a SIGNAL, not a failure: it is
 *     how Next learns the route is dynamic. Swallowing it would let a page that
 *     reads a per-user cookie be statically cached, serving one commissioner's
 *     league to everyone.
 *
 * So the discriminator is the `digest`, not the message: rethrow anything that
 * carries one, swallow only the digest-less wrong-context error. That also keeps
 * `NEXT_REDIRECT` and `NEXT_NOT_FOUND` — Next's other digest-carrying control-flow
 * signals — propagating, which a bare `catch {}` would have eaten too.
 *
 * Production behaviour is unchanged: every caller of `resolveActiveLeagueId` is an
 * App Router server component (`app/commissioner-os/**` pages and layout), where a
 * request scope is guaranteed and this helper simply reads the cookie.
 */
async function readActiveLeagueCookie(): Promise<string | null> {
  try {
    const store = await cookies()
    return store.get(ACTIVE_LEAGUE_COOKIE_KEY)?.value ?? null
  } catch (error) {
    if (typeof (error as { digest?: unknown } | null)?.digest === 'string') throw error
    return null
  }
}

/**
 * The league every Commissioner OS module reads: the most recently created league this user
 * commissions, unless the header's selector cookie names another one they also commission.
 *
 * ⚠ RETURNING NULL IS THE SECOND HALF OF THE GATE, NOT A CONVENIENCE. The layout refuses to render
 * for a non-commissioner, but in the App Router a page's own data fetching can run alongside the
 * layout's — so the display being closed does not by itself close the data access. Every one of
 * the five league-scoped live clients short-circuits on `if (!leagueId)`, so a non-commissioner
 * resolving `null` here means no intelligence is fetched even if a page body runs.
 *
 * The cookie is never trusted blindly: it is matched against this same owned set, so a tampered or
 * stale value can only ever select a league the session already commissions.
 */
export async function resolveActiveLeagueId(): Promise<string | null> {
  const leagues = await getActiveLeaguesForSessionUser()
  if (leagues.length === 0) return null

  const requested = await readActiveLeagueCookie()
  if (requested) {
    const match = leagues.find((l) => String(l.id) === requested)
    if (match) return String(match.id)
  }

  return String(leagues[0].id)
}
