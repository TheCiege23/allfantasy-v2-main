import { redirect } from 'next/navigation'
import nextDynamic from 'next/dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAppRouterRedirectError } from '@/lib/next/is-app-router-redirect-error'
import { getValuationLeagues } from '@/lib/players/getValuationLeagues'
import type { LeagueOption } from '@/components/players/PlayerIntelligenceCenter'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Player Intelligence Center — AllFantasy',
  description:
    'Search every player, understand their value in your specific league, and move straight into the right tool.',
}

/**
 * Client-only, mirroring `/dashboard`. Note `nextDynamic` is aliased because the
 * bare name `dynamic` is taken by the route segment config exported above.
 */
const PlayerIntelligenceCenter = nextDynamic(
  () => import('@/components/players/PlayerIntelligenceCenter'),
  {
    ssr: false,
    loading: () => (
      // Tokens are unavailable before the scoped stylesheet loads, so the ground
      // colour is inlined here to avoid a white flash against the dark shell.
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
        Loading players…
      </div>
    ),
  },
)

export default async function PlayersPage() {
  let session: { user?: { id?: string } } | null = null

  try {
    session = await getServerSession(authOptions)
  } catch (error) {
    if (isAppRouterRedirectError(error)) throw error
    console.error('[players] session lookup failed', error)
  }

  const userId = session?.user?.id
  if (!userId) {
    redirect('/login?callbackUrl=/players')
  }

  // A failed league lookup degrades to generic valuations rather than failing the
  // page — the player catalog is useful on its own.
  let leagues: LeagueOption[] = []
  try {
    const rows = await getValuationLeagues(userId)
    leagues = rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
    }))
  } catch (error) {
    if (isAppRouterRedirectError(error)) throw error
    console.error('[players] league list failed', error)
  }

  return <PlayerIntelligenceCenter leagues={leagues} />
}
