import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import './[tournamentId]/tournament-hub.css'

/**
 * A commissioner's tournaments.
 *
 * 🛑 THE HUB HAD NO FRONT DOOR. `/tournament-hub/[id]` needs an id nobody has
 * memorised, so every screen behind it was reachable only by typing a URL — a
 * built feature nobody can find is not a shipped feature.
 *
 * ⚠ A STATIC INDEX BESIDE `[tournamentId]`, which Next.js resolves first, so
 * this renders instead of looking for a tournament with an empty id.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Tournaments — AllFantasy',
  robots: { index: false, follow: false },
}

export default async function TournamentHubIndex() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) redirect('/api/auth/signin?callbackUrl=%2Ftournament-hub')

  /*
   * ⚠ ZOMBIE UNIVERSES ARE LISTED HERE TOO, AND THEY ARE NOT MERGED IN.
   * A universe is already a group-of-leagues with its own commissioner and its
   * own hub at `/app/zombie-universe/[id]` — the thing a commissioner lacked was
   * one place that knows about ALL the multi-league things they run. Rebuilding
   * Zombie's screen inside this one would be a rewrite; listing it is a link.
   */
  const universes = await prisma.zombieUniverse
    .findMany({
      where: { commissionedByUserId: userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        sport: true,
        status: true,
        _count: { select: { leagues: true } },
      },
    })
    .catch(() => [])

  const tournaments = await prisma.tournamentShell.findMany({
    where: { commissionerId: userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      sport: true,
      status: true,
      currentRoundNumber: true,
      currentParticipantCount: true,
      _count: { select: { tournamentLeagues: true, conferences: true } },
    },
  })

  return (
    <main className="af-th">
      <header className="af-th-head">
        <div>
          <h1 className="af-th-title">Tournaments you run</h1>
          <p className="af-th-sub">
            Standings across every league at once, and one message to whichever managers you
            choose.
          </p>
        </div>
        <div className="af-th-actions">
          <Link href="/tournament-hub/new" className="af-th-copy">
            Group leagues into a tournament
          </Link>
        </div>
      </header>

      {tournaments.length === 0 && universes.length === 0 ? (
        /*
         * ⚠ AN EMPTY LIST IS A STARTING POINT, NOT AN ERROR. This is what a
         * commissioner sees the first time, and it is also what they see if they
         * arrive expecting an existing tournament — so it says what to do rather
         * than reporting that nothing was found.
         */
        <section className="af-th-league">
          <h2 className="af-th-league-name">Nothing here yet</h2>
          <p className="af-th-note">
            If you run one big tournament across several leagues, group them here. Nothing is
            created on any platform and no league is changed — it records that they belong
            together, so standings, the cut and messages can work across all of them at once.
          </p>
        </section>
      ) : null}

      {universes.length > 0 ? (
        <>
          {tournaments.length > 0 ? <h2 className="af-th-league-name">Tournaments</h2> : null}
        </>
      ) : null}

      {tournaments.map((t) => (
        <Link key={t.id} href={`/tournament-hub/${t.id}`} className="af-th-league af-th-card">
          <h2 className="af-th-league-name">
            {t.name}
            <span className="af-th-linknote">{t.status}</span>
          </h2>
          <p className="af-th-pick-meta">
            {t.sport} · round {t.currentRoundNumber || 1} · {t._count.conferences}{' '}
            {t._count.conferences === 1 ? 'conference' : 'conferences'} ·{' '}
            {t._count.tournamentLeagues} leagues · {t.currentParticipantCount} managers
          </p>
        </Link>
      ))}

      {universes.length > 0 ? (
        <>
          <h2 className="af-th-league-name">Zombie universes</h2>
          {universes.map((u) => (
            <Link key={u.id} href={`/app/zombie-universe/${u.id}`} className="af-th-league af-th-card">
              <h2 className="af-th-league-name">
                {u.name}
                <span className="af-th-linknote">{u.status}</span>
              </h2>
              <p className="af-th-pick-meta">
                {u.sport} · {u._count.leagues} {u._count.leagues === 1 ? 'league' : 'leagues'}
              </p>
            </Link>
          ))}
        </>
      ) : null}
    </main>
  )
}
