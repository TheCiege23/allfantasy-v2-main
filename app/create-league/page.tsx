import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { createStateFromImportedLeague } from '@/lib/create-league-v2/import-template'
import { CreateLeaguePageClient } from './CreateLeaguePageClient'

export const dynamic = 'force-dynamic'

function firstStringParam(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined
  return typeof value === 'string' ? value : value[0]
}

export default async function CreateLeaguePage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}) {
  const sp =
    searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const e2eAuth = firstStringParam(sp.e2eAuth)
  const fromLeagueId = firstStringParam(sp.fromLeague)?.trim()
  const allowE2EBypass = process.env.NODE_ENV !== 'production' && e2eAuth === '1'

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  const userId =
    session?.user?.id ?? (allowE2EBypass ? 'e2e-user' : undefined)

  if (!userId) {
    const callbackUrl = fromLeagueId
      ? `/create-league?fromLeague=${encodeURIComponent(fromLeagueId)}`
      : '/create-league'
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }

  if (!fromLeagueId) return <CreateLeaguePageClient userId={userId} />

  const source = await prisma.league.findUnique({
    where: { id: fromLeagueId },
    select: {
      id: true,
      name: true,
      platform: true,
      sport: true,
      leagueType: true,
      leagueVariant: true,
      leagueSize: true,
      scoringPresetId: true,
      leagueSettings: { select: { draftType: true } },
    },
  })
  if (!source || isNativePlatform(source.platform) || !isCommissionerRole(await getLeagueRole(source.id, userId))) {
    notFound()
  }

  return (
    <CreateLeaguePageClient
      userId={userId}
      importSourceLeagueId={source.id}
      importTemplate={createStateFromImportedLeague({
        ...source,
        sport: String(source.sport),
        draftType: source.leagueSettings?.draftType ?? null,
      })}
      importSourceName={source.name?.trim() || 'Imported League'}
    />
  )
}
