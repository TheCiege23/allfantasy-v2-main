import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { startFromTemplate } from '@/lib/rule-templates/templateService'
import { CreateLeaguePageClient } from './CreateLeaguePageClient'
import { parseRequestedFormat } from '@/lib/create-league-v2/requestedFormat'
import { makeNativeLeagueHref } from '@/lib/league/makeNativeLeague'

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
  const templateId = firstStringParam(sp.template)?.trim()
  const fromDemo = firstStringParam(sp.from) === 'demo'
  // `?type=<format>` from a format demo: open the wizard on that format.
  const requestedFormat = parseRequestedFormat(firstStringParam(sp.type))
  const allowE2EBypass = process.env.NODE_ENV !== 'production' && e2eAuth === '1'

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  const userId =
    session?.user?.id ?? (allowE2EBypass ? 'e2e-user' : undefined)

  if (!userId) {
    const callbackUrl = fromLeagueId
      ? makeNativeLeagueHref(fromLeagueId)
      : templateId
        ? `/create-league?template=${encodeURIComponent(templateId)}`
        : fromDemo || requestedFormat
          ? `/create-league?${new URLSearchParams({ ...(fromDemo ? { from: 'demo' } : {}), ...(requestedFormat ? { type: requestedFormat } : {}) }).toString()}`
          : '/create-league'
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }

  /*
   * The copy flow is retired (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §10, owner decision Q9): it made a
   * second league beside the import. An old `?fromLeague=` link lands on the league's own switch card instead, which
   * moves the import onto AllFantasy in place. That page and its route check the commissioner role themselves.
   */
  if (fromLeagueId) redirect(makeNativeLeagueHref(fromLeagueId))

  // Rule templates library: start a fresh league from a template's rules (lib/rule-templates).
  // No import source is passed, so nothing of the template's source league carries over.
  if (templateId && !allowE2EBypass) {
    const started = await startFromTemplate(templateId, userId)
    if (!started.ok) notFound()
    return (
      <>
        <div className="bg-[color:var(--surface-app)] text-[color:var(--text-primary)]">
          <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6" aria-label="Template">
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-4 pr-16 sm:p-5 sm:pr-20 lg:pr-5">
              <h2 className="text-lg font-black tracking-tight">Starting from “{started.name}”</h2>
              <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
                {started.tags.join(' · ')}. These rules are filled in below; change anything before you create. Your league gets its own name, draft date and invite link.
              </p>
            </div>
          </section>
        </div>
        <CreateLeaguePageClient userId={userId} importTemplate={started.state} />
      </>
    )
  }

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
  return <CreateLeaguePageClient userId={userId} importedLeagues={imports} fromDemo={fromDemo} requestedFormat={requestedFormat ?? undefined} />
}
