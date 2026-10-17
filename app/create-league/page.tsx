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
    // Import entry points live inside the wizard (its Import button and this list), so a phone
    // opens on the create form rather than on a second, unstyled import block above it.
    const imports = candidates
      .filter(league => !isNativePlatform(league.platform))
      .map(league => ({ id: league.id, name: league.name ?? '', sport: String(league.sport) }))
    return <CreateLeaguePageClient userId={userId} importedLeagues={imports} />
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
      <main className="flex min-h-[70vh] items-center justify-center bg-[color:var(--surface-app)] px-4 py-10 text-[color:var(--text-primary)]">
        <div className="w-full max-w-xl rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-6 text-center shadow-xl shadow-black/5 sm:p-8">
          <h1 className="text-2xl font-black tracking-tight">This import cannot be copied yet</h1>
          <p className="mt-4 text-sm leading-6 text-[color:var(--text-secondary)]">The imported league has {currentTeamCount} current teams, and AllFantasy does not support that team count for this sport and league type. Every team must carry over, so choose a supported source league or create a new league.</p>
          <a className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-black text-[#ffffff] shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 sm:w-auto" href="/create-league">Create a new league</a>
        </div>
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
    <div className="bg-[color:var(--surface-app)] text-[color:var(--text-primary)]">
      <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6" aria-label="Native import review">
        {/* pr-16: the theme toggle is fixed to the top-right corner on this route. */}
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-4 pr-16 sm:p-5 sm:pr-20 lg:pr-5">
          <h2 className="text-lg font-black tracking-tight">Review native carryover</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">Source season: {source.season ?? 'Unknown'}. Native season: {resolveLeagueCreationSeason(String(source.sport))}. All {currentTeamCount} teams and their current rosters carry over. Available history is archived; past results are not rescored.</p>
          {baseballReview && <p className="mt-2 break-words text-sm leading-6 text-[color:var(--text-secondary)]">Imported points rules: {Object.entries(baseballReview.categoryPoints).filter(([, value]) => value !== 0).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'All categories score zero'}.</p>}
          {reviewError && <p role="alert" className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6">{reviewError} Native creation will stop until these settings can be preserved.</p>}
        </div>
      </section>
    </div>
    <CreateLeaguePageClient
      userId={userId}
      importSourceLeagueId={source.id}
      importTemplate={importTemplate}
      importSourceName={source.name?.trim() || 'Imported League'}
    />
    </>
  )
}
