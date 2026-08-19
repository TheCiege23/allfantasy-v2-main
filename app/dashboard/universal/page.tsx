import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import type { Metadata } from 'next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDashboardLeagueListForUser, getLegacyLeagueBoardItems } from '@/lib/dashboard/get-dashboard-league-list'
import type { UserLeague } from '@/app/dashboard/types'
import { GUEST_SESSION_COOKIE_NAME, verifyGuestSessionToken } from '@/lib/guest-mode/guestSessionToken'
import { claimGuestTrialForUser } from '@/lib/legacy/claimGuestTrialForUser'
import { UniversalLeaguesBoard } from './UniversalLeaguesBoard'
import { UniversalDashboardShell } from './components/UniversalDashboardShell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'AllFantasy — All Your Leagues',
  description:
    'Every fantasy league you play — across every platform and every sport — in one universal dashboard, with health and next-action insight per league.',
}

/**
 * Universal B2C dashboard (prototype).
 *
 * The consumer "operating system" overview: instead of hopping platform to platform,
 * a manager sees every league they play — Sleeper, ESPN, Yahoo, CBS, MFL, Fantrax,
 * native AllFantasy, tournaments — across every sport in one place, each with a
 * derived health / next-action signal.
 *
 * Runs on the same server-side league source the main dashboard uses
 * (`getDashboardLeagueListForUser`), so it reflects real connected data with no new
 * backend. Deeper Decision OS analysis layers on top of this surface later.
 */
export default async function UniversalDashboardPage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''

  if (!userId) {
    const guestCookie = (await cookies()).get(GUEST_SESSION_COOKIE_NAME)?.value
    const guest = await verifyGuestSessionToken(guestCookie)
    if (!guest) {
      redirect('/login?callbackUrl=/dashboard/universal')
    }

    const legacyUser = await prisma.legacyUser
      .findUnique({ where: { id: guest.legacyUserId }, select: { sleeperUsername: true, displayName: true } })
      .catch(() => null)

    // Cookie verified but the LegacyUser row is gone (e.g. deleted) — treat as no guest session.
    if (!legacyUser) {
      redirect('/login?callbackUrl=/dashboard/universal')
    }

    const guestLeagues = (await getLegacyLeagueBoardItems(guest.legacyUserId).catch(() => [])) as UserLeague[]

    return (
      <UniversalDashboardShell leagues={guestLeagues} guestMode guestDisplayName={legacyUser.displayName || legacyUser.sleeperUsername}>
        <UniversalLeaguesBoard leagues={guestLeagues} guestSleeperUsername={legacyUser.sleeperUsername} />
      </UniversalDashboardShell>
    )
  }

  // AF_GATE0 §3.5 — belt-and-suspenders trial claim on first authenticated load of the trial
  // board. events.signIn already claims at sign-in; this covers any path where the guest cookie
  // was still present when the user returns here (notably the OAuth-first signup). Idempotent and
  // best-effort — a server component can READ the cookie and write the claim, but not clear it;
  // middleware invalidates the cookie on authenticated navigations.
  const guestClaimCookie = (await cookies()).get(GUEST_SESSION_COOKIE_NAME)?.value
  if (guestClaimCookie) {
    await claimGuestTrialForUser(userId, guestClaimCookie).catch(() => null)
  }

  const payload = await getDashboardLeagueListForUser(userId).catch(() => null)
  const leagues = (payload?.leagues ?? []) as UserLeague[]

  return (
    <UniversalDashboardShell leagues={leagues}>
      <UniversalLeaguesBoard leagues={leagues} />
    </UniversalDashboardShell>
  )
}
