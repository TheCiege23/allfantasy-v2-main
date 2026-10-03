import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { createStateFromImportedLeague } from '@/lib/create-league-v2/import-template'
import { CreateLeaguePageClient } from './CreateLeaguePageClient'
import { importedMlbScoring } from '@/lib/league-creation/canonical/importedMlbScoring'
import { importedMlbRoster } from '@/lib/league-creation/canonical/importedMlbRoster'
import { resolveLeagueCreationSeason } from '@/lib/season-week/leagueCreationSeason'

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

  if (!fromLeagueId) {
    const candidates = allowE2EBypass ? [] : await prisma.league.findMany({
      where: { OR: [{ userId }, { teams: { some: { claimedByUserId: userId, OR: [{ isCommissioner: true }, { isCoCommissioner: true }] } } }] },
      select: { id: true, name: true, platform: true, sport: true },
      orderBy: { updatedAt: 'desc' },
    })
    const imports = candidates.filter(league => !isNativePlatform(league.platform))
    return <>
      <section className="mx-auto max-w-5xl px-6 pt-6" aria-label="League import options">
        <h2 className="text-lg font-bold">Bring your league to AllFantasy</h2>
        <p className="mt-2 text-sm">Import from a supported platform, then review the rules and make the league native.</p>
        <a className="mt-3 inline-block font-bold underline" href="/import">Import a league</a>
        {imports.length > 0 && <details id="imported-leagues" className="mt-4 rounded-xl border p-4">
          <summary className="cursor-pointer font-bold">Make an already imported league native</summary>
          <ul className="mt-3 space-y-3">{imports.map(league => <li key={league.id}>
            <a className="underline" href={`/create-league?fromLeague=${encodeURIComponent(league.id)}`}>{league.name || 'Imported league'} · {String(league.sport)}</a>
          </li>)}</ul>
        </details>}
      </section>
      <CreateLeaguePageClient userId={userId} />
    </>
  }

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
      season: true,
      settings: true,
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

  let reviewError: string | undefined
  let baseballReview: ReturnType<typeof importedMlbScoring> | undefined
  if (String(source.sport) === 'MLB') {
    try { baseballReview = importedMlbScoring(source.settings); importedMlbRoster(source.settings) }
    catch (error) { reviewError = error instanceof Error ? error.message : 'Imported settings need review.' }
  }
  return (
    <>
    <section className="mx-auto max-w-5xl px-6 pt-6" aria-label="Native import review">
      <h2 className="text-lg font-bold">Review native carryover</h2>
      <p className="mt-2 text-sm">Source season: {source.season ?? 'Unknown'}. Native season: {resolveLeagueCreationSeason(String(source.sport))}. All {currentTeamCount} teams and their current rosters carry over. Available history is archived; past results are not rescored.</p>
      {baseballReview && <p className="mt-2 text-sm">Imported points rules: {Object.entries(baseballReview.categoryPoints).filter(([, value]) => value !== 0).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'All categories score zero'}.</p>}
      {reviewError && <p role="alert" className="mt-3 rounded-xl border border-amber-500 p-4">{reviewError} Native creation will stop until these settings can be preserved.</p>}
    </section>
    <CreateLeaguePageClient
      userId={userId}
      importSourceLeagueId={source.id}
      importTemplate={importTemplate}
      importSourceName={source.name?.trim() || 'Imported League'}
    />
    </>
  )
}
