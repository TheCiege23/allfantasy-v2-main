import { redirect } from 'next/navigation'
import nextDynamic from 'next/dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildMyTeamContext } from '@/lib/my-team/buildMyTeamContext'
import type { MyTeamLeagueOption } from '@/components/my-team/MyTeamCommandCenter'

export const dynamic = 'force-dynamic'

/**
 * My Team — Manager Command Center.
 *
 * Scope is carried entirely in the URL (`?league=<League.id>&week=<n>`) rather than
 * in localStorage/sessionStorage. The repo has four separate league-scope
 * mechanisms and none of them are server-readable; a search param is the only one
 * that survives SSR, deep links, and sharing. Week has no persistence anywhere in
 * the app, so it is a param too.
 *
 * Client-only render (`ssr: false`) mirrors `/dashboard` — SSR-bundling next/image
 * on Windows Next 14.2 corrupts the dev manifests.
 */
const MyTeamCommandCenter = nextDynamic(
  () => import('@/components/my-team/MyTeamCommandCenter'),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#161826',
          color: '#9397ab',
          fontSize: 14,
        }}
      >
        Loading your team…
      </div>
    ),
  },
)

/** Leagues the viewer either owns or holds a claimed roster in. */
async function getLeagueOptions(userId: string): Promise<MyTeamLeagueOption[]> {
  const leagues = await prisma.league.findMany({
    where: {
      OR: [{ userId }, { rosters: { some: { platformUserId: userId } } }],
    },
    select: {
      id: true,
      name: true,
      platform: true,
      sport: true,
      season: true,
      logoUrl: true,
      userId: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  return leagues.map((l) => ({
    id: l.id,
    name: l.name,
    platform: String(l.platform ?? 'unknown'),
    sport: String(l.sport ?? 'NFL'),
    season: l.season ?? null,
    logoUrl: l.logoUrl ?? null,
    isCommissioner: l.userId === userId,
  }))
}

export default async function MyTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; week?: string }>
}) {
  let session: { user?: { id?: string; name?: string | null; image?: string | null } } | null
  try {
    session = (await getServerSession(authOptions as never)) as typeof session
  } catch (error) {
    console.error('[my-team] getServerSession failed:', error)
    redirect('/login?callbackUrl=/my-team')
  }

  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''
  if (!userId) {
    redirect('/login?callbackUrl=/my-team')
  }

  const params = await searchParams
  const leagueOptions = await getLeagueOptions(userId)

  if (leagueOptions.length === 0) {
    return (
      <MyTeamCommandCenter
        leagueOptions={[]}
        context={null}
        unavailable={{
          title: 'No teams yet',
          message:
            'My Team works on a league you have a team in. Import a league from Sleeper, ESPN, or Yahoo — or create an AllFantasy league — and your command center builds itself.',
          actions: [
            { label: 'Import a league', href: '/leagues' },
            { label: 'Create a league', href: '/create-league' },
          ],
        }}
        viewerName={session?.user?.name ?? null}
        viewerImage={session?.user?.image ?? null}
      />
    )
  }

  const requestedLeagueId = typeof params.league === 'string' ? params.league.trim() : ''
  const selected = leagueOptions.find((l) => l.id === requestedLeagueId) ?? leagueOptions[0]

  const parsedWeek = Number(params.week)
  const week = Number.isFinite(parsedWeek) && parsedWeek > 0 ? parsedWeek : undefined

  let result: Awaited<ReturnType<typeof buildMyTeamContext>>
  try {
    result = await buildMyTeamContext({
      leagueId: selected.id,
      viewerUserId: userId,
      week,
    })
  } catch (error) {
    console.error('[my-team] buildMyTeamContext threw:', error)
    return (
      <MyTeamCommandCenter
        leagueOptions={leagueOptions}
        context={null}
        unavailable={{
          title: 'My Team is temporarily unavailable',
          message:
            'We could not assemble your team context just now. This is on our side, not your league — try again in a moment.',
          actions: [{ label: 'Retry', href: `/my-team?league=${selected.id}` }],
        }}
        viewerName={session?.user?.name ?? null}
        viewerImage={session?.user?.image ?? null}
      />
    )
  }

  if (!result.ok) {
    return (
      <MyTeamCommandCenter
        leagueOptions={leagueOptions}
        context={null}
        unavailable={{
          title: result.status === 403 ? 'You do not have a team in this league' : 'League not found',
          message: result.reason,
          actions: [{ label: 'Back to dashboard', href: '/dashboard' }],
        }}
        viewerName={session?.user?.name ?? null}
        viewerImage={session?.user?.image ?? null}
      />
    )
  }

  return (
    <MyTeamCommandCenter
      leagueOptions={leagueOptions}
      context={result.context}
      unavailable={null}
      viewerName={session?.user?.name ?? null}
      viewerImage={session?.user?.image ?? null}
    />
  )
}
