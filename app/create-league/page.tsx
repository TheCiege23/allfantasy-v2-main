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

export default async function CreateLeaguePage(
  props: {
    searchParams?: Promise<| Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>>
  }
) {
  const searchParams = await props.searchParams
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

  const currentTeamCount = await prisma.leagueTeam.count({
    where: { leagueId: source.id, lifecycleState: { not: 'ARCHIVED' } },
  })
  const importTemplate = createStateFromImportedLeague({
    ...source,
    sport: String(source.sport),
    leagueSize: currentTeamCount,
    draftType: source.leagueSettings?.draftType ?? null,
  })
  if (importTemplate.teamCount !== currentTeamCount) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-2xl font-bold">This import cannot be copied yet</h1>
        <p className="mt-4">The imported league has {currentTeamCount} current teams, and AllFantasy does not support that team count for this sport and league type. Every team must carry over, so choose a supported source league or create a new league.</p>
        <a className="mt-6 inline-block font-bold underline" href="/create-league">Create a new league</a>
      </main>
    )
  }

  return (
    <CreateLeaguePageClient
      userId={userId}
      importSourceLeagueId={source.id}
      importTemplate={importTemplate}
      importSourceName={source.name?.trim() || 'Imported League'}
    />
  )
}
