import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveCurrentInjuryDesignations } from '@/lib/injuries/currentInjuryDesignations'
import { PlayerProfileClient } from './PlayerProfileClient'
import { readPlayerPageLookup, resolvePlayerPageIdentity } from './resolvePlayerIdentity'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>
  searchParams?: PageSearchParams
}): Promise<Metadata> {
  const { playerId } = await params
  const { identity } = await resolvePlayerPageIdentity(playerId, readPlayerPageLookup(await searchParams))

  const name = identity?.canonicalName ?? 'Player'
  return {
    title: `${name} – Player Profile – AllFantasy`,
    description: `${name} (${identity?.position ?? ''}, ${identity?.currentTeam ?? ''}) fantasy profile, news, outlook, analytics, and market trends.`,
  }
}

export default async function PlayerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>
  searchParams?: PageSearchParams
}) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    const { playerId } = await params
    redirect(`/login?callbackUrl=/player/${playerId}`)
  }

  const { playerId } = await params
  const lookup = readPlayerPageLookup(await searchParams)
  const { identity, reason } = await resolvePlayerPageIdentity(playerId, lookup)
  // Several players answer to this name in this sport and nothing narrowed them. A placeholder would
  // let the tabs re-guess by name, so the page refuses outright.
  if (reason === 'ambiguous') notFound()

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
        sport: lookup.sport,
        sleeperId: null,
        status: 'unknown',
        injuryStatus: null,
      }

  return <PlayerProfileClient player={playerData} />
}
