import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveCurrentInjuryDesignations } from '@/lib/injuries/currentInjuryDesignations'
import { PlayerProfileClient } from './PlayerProfileClient'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ playerId: string }>
}): Promise<Metadata> {
  const { playerId } = await params
  const identity = await prisma.playerIdentityMap
    .findFirst({
      where: {
        OR: [
          { id: playerId },
          { sleeperId: playerId },
          { normalizedName: playerId.toLowerCase().replace(/-/g, ' ') },
        ],
      },
      select: { canonicalName: true, position: true, currentTeam: true },
    })
    .catch(() => null)

  const name = identity?.canonicalName ?? 'Player'
  return {
    title: `${name} – Player Profile – AllFantasy`,
    description: `${name} (${identity?.position ?? ''}, ${identity?.currentTeam ?? ''}) fantasy profile, news, outlook, analytics, and market trends.`,
  }
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ playerId: string }>
}) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    const { playerId } = await params
    redirect(`/login?callbackUrl=/player/${playerId}`)
  }

  const { playerId } = await params

  const identity = await prisma.playerIdentityMap
    .findFirst({
      where: {
        OR: [
          { id: playerId },
          { sleeperId: playerId },
          { normalizedName: playerId.toLowerCase().replace(/-/g, ' ') },
        ],
      },
    })
    .catch(() => null)

  /*
   * The header's injury badge comes from the LIVE injury feed, never from `identity.status` — that
   * column is a Rolling Insights roster code ("ACT" / "INACT"), and showing it put "⚠ ACT" on every
   * healthy player. Only an identified player is looked up: a slug-derived name with no team or
   * position is exactly the namesake the read port would have to refuse anyway.
   */
  let injuryStatus: string | null = null
  if (identity?.canonicalName) {
    const designations = await resolveCurrentInjuryDesignations({
      sport: identity.sport ?? 'NFL',
      players: [{ key: 'player', name: identity.canonicalName, team: identity.currentTeam, position: identity.position }],
    }).catch(() => null)
    injuryStatus = designations?.get('player')?.status ?? null
  }

  const playerData = identity
    ? {
        id: identity.id,
        name: identity.canonicalName,
        position: identity.position ?? '',
        team: identity.currentTeam ?? 'FA',
        sport: identity.sport ?? 'NFL',
        sleeperId: identity.sleeperId ?? null,
        status: identity.status ?? 'active',
        injuryStatus,
      }
    : {
        id: playerId,
        name: playerId.replace(/-/g, ' '),
        position: '',
        team: 'FA',
        sport: 'NFL',
        sleeperId: null,
        status: 'unknown',
        injuryStatus: null,
      }

  return <PlayerProfileClient player={playerData} />
}
