import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import DashboardUnavailableState from '@/components/dashboard/DashboardUnavailableState'
import { loadCommandCenterViewModel } from '@/lib/league-command-center/viewModel'
import { loadAttentionSection } from '@/lib/league-command-center/sections/attention'
import { buildLeagueHealthSection } from '@/lib/league-command-center/sections/leagueHealth'
import { loadMatchupsSection } from '@/lib/league-command-center/sections/matchups'
import { loadMissionControlSection } from '@/lib/league-command-center/sections/missionControl'
import { loadOverviewSection } from '@/lib/league-command-center/sections/overview'
import { loadRosterSection } from '@/lib/league-command-center/sections/roster'
import { loadStandingsSection } from '@/lib/league-command-center/sections/standings'
import { resolveActionCapability } from '@/lib/league-command-center/capability'
import { resolveMissionControlSnapshot } from '@/lib/decision-os/missionControl'
import { prisma } from '@/lib/prisma'
import {
  COMMAND_CENTER_NAV,
  isCommandCenterSectionId,
  type CommandCenterSectionId,
} from '@/lib/league-command-center/types'
import { CommandCenterHero } from '@/components/league-command-center/shell/CommandCenterHero'
import { CommandCenterSidebar } from '@/components/league-command-center/shell/CommandCenterSidebar'
import { MissionControlStrip } from '@/components/league-command-center/shell/MissionControlStrip'
import { CommandCenterSectionHost } from '@/components/league-command-center/CommandCenterSectionHost'
import '@/components/league-command-center/command-center.css'

/**
 * League Command Center.
 *
 * Additive route: the live `/league/[leagueId]` shell is untouched. This ships
 * alongside it so the redesign can be verified against real leagues without
 * risking the 8 sports × 7 variants the existing shell serves, following the
 * same preview → verify → cut over sequence used for the Nocturne dashboard.
 *
 * Auth and membership mirror `app/league/[leagueId]/page.tsx` exactly:
 * unauthenticated visitors round-trip through `/login` with a `callbackUrl`,
 * non-members get an explicit access state rather than an opaque redirect.
 *
 * The active section comes from `?section=`, read fresh on every render. There
 * is no React state mirroring it, so the two-way-binding echo that
 * `lib/league/leagueTabSync.ts` exists to suppress cannot occur here.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function LeagueCommandCenterPage({ params, searchParams }: PageProps) {
  const { leagueId } = await params
  const sp = await searchParams

  const sectionParam = firstParam(sp.section)
  const activeSection: CommandCenterSectionId =
    sectionParam && isCommandCenterSectionId(sectionParam) ? sectionParam : 'overview'

  const weekParam = firstParam(sp.week)
  const parsedWeek = weekParam ? Number.parseInt(weekParam, 10) : Number.NaN
  const requestedWeek = Number.isFinite(parsedWeek) && parsedWeek > 0 ? parsedWeek : null

  let session: {
    user?: { id?: string; email?: string | null }
  } | null

  try {
    session = (await getServerSession(authOptions as never)) as typeof session
  } catch (error) {
    console.error('[command-center] getServerSession failed:', error)
    return (
      <DashboardUnavailableState
        title="Command Center temporarily unavailable"
        message="We couldn't verify your session. Please sign in again or try again in a moment."
      />
    )
  }

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/league/${leagueId}/command-center`)}`)
  }

  const result = await loadCommandCenterViewModel({
    leagueId,
    userId: session.user.id,
    email: session.user.email ?? null,
    // Honoured only for a server-verified site admin, and only to narrow the
    // role — never to elevate. See `lib/league-command-center/adminPreview.ts`.
    requestedViewAs: firstParam(sp.viewAs),
  })

  if (result.status === 'not_found') {
    return (
      <DashboardUnavailableState
        title="League not found"
        message="This league doesn't exist or you may not have access to it. It may have been deleted, or you may need to reconnect your platform."
      />
    )
  }

  if (result.status === 'not_member') {
    return (
      <DashboardUnavailableState
        title="You don't have access to this league"
        message="You are not a member of this league. Ask the commissioner to invite you, or check if you joined under a different account."
      />
    )
  }

  if (result.status === 'error') {
    return <DashboardUnavailableState title="Command Center unavailable" message={result.message} />
  }

  const viewModel = result.viewModel
  const userId = session.user.id

  /*
   * Commissioner-section access gate, enforced on the server.
   *
   * The sidebar already hides `requiresCommissioner` sections from managers, but
   * hiding a nav link is not access control — a manager can still type
   * `?section=attention`. This is the real gate: a non-commissioner requesting a
   * commissioner section gets an explicit access state, never the ops data. The
   * full manager experience is unaffected and one click away on the default
   * section.
   */
  const activeNavEntry = COMMAND_CENTER_NAV.find((item) => item.id === activeSection)
  if (activeNavEntry?.requiresCommissioner && !viewModel.viewer.isCommissioner) {
    return (
      <DashboardUnavailableState
        title="Commissioner access required"
        message="This is a commissioner-only area of the Command Center. Your own team, matchups, and standings are all still available — head back to the league overview to manage your roster."
      />
    )
  }

  // Load only what the active section needs. Anything not loaded is never
  // serialized to the client — which is also how gated data stays server-side:
  // league health is resolved only when `entitlement.intelligence.allowed`.
  const needsStandings = activeSection === 'overview' || activeSection === 'standings'
  const needsMatchups = activeSection === 'overview' || activeSection === 'matchups'
  const needsOverview = activeSection === 'overview'
  const needsRoster = activeSection === 'roster'
  // Commissioner-only sections — only reachable past the access gate above.
  const needsAttention = activeSection === 'attention'
  const needsHealth = activeSection === 'health'

  /*
   * League health, resolved exactly once per page load.
   *
   * Mission Control and the Overview health card both want it, and
   * `resolveDecisionOsLeagueHealth` federates league events and loops every
   * manager — so it is resolved here and handed to both rather than being
   * resolved independently by each. Skipped entirely when the viewer is not
   * entitled, which is also what keeps the gated payload out of the client
   * bundle rather than merely hidden in it.
   */
  const missionSnapshot = viewModel.entitlement.intelligence.allowed
    ? await resolveMissionControlSnapshot(leagueId).catch((error) => {
        console.error('[command-center] mission control snapshot failed', { leagueId, error })
        return null
      })
    : null

  const preResolvedHealth =
    missionSnapshot && missionSnapshot.leagueHealth.available
      ? missionSnapshot.leagueHealth.result
      : null

  const [missionControl, standings, matchups, overview, roster] = await Promise.all([
    // Mission Control is shell chrome, not a section — it renders on every
    // section because it is the league's heartbeat, not part of any one view.
    loadMissionControlSection({
      leagueId,
      userId,
      source: viewModel.source,
      snapshot: missionSnapshot,
      entitledToHealth: viewModel.entitlement.intelligence.allowed,
      isCommissioner: viewModel.viewer.isCommissioner,
    }),
    needsStandings ? loadStandingsSection({ leagueId, userId }) : Promise.resolve(null),
    needsMatchups
      ? loadMatchupsSection({ leagueId, userId, week: requestedWeek })
      : Promise.resolve(null),
    needsOverview
      ? loadOverviewSection({
          leagueId,
          includeHealth: viewModel.entitlement.intelligence.allowed,
          preResolvedHealth,
        })
      : Promise.resolve(null),
    needsRoster ? loadRosterSection({ leagueId, userId }) : Promise.resolve(null),
  ])

  /*
   * Commissioner HQ sections. Both project the already-resolved `missionSnapshot`
   * (one league-health resolve per load — the same snapshot Mission Control
   * reads), so they add no health query. `buildLeagueHealthSection` is a pure
   * reshape; only the attention loader is async (one bounded manager-actions
   * resolve for the viewer's own personal queue).
   */
  const attention = needsAttention
    ? await loadAttentionSection({
        leagueId,
        userId,
        snapshot: missionSnapshot,
        sourceIsNative: viewModel.source.isNative,
        commissionerName: viewModel.league.commissionerName,
        viewerIsHeadCommissioner: viewModel.viewer.role === 'commissioner',
        entitledToIntelligence: viewModel.entitlement.intelligence.allowed,
      })
    : null

  const leagueHealth = needsHealth
    ? buildLeagueHealthSection({
        snapshot: missionSnapshot,
        entitledToIntelligence: viewModel.entitlement.intelligence.allowed,
      })
    : null

  /*
   * Lineup-write capability, resolved on the server.
   *
   * A native league gets `native_execute`, which `resolveActionCapability`
   * turns into a real write control wired to `PATCH /api/redraft/roster`.
   * An imported league gets `open_provider`, which becomes a deep link or
   * honest guidance — never an editable lineup, because AllFantasy has no write
   * access to Sleeper/ESPN/Yahoo. Deciding this here (not in the client) means
   * the browser is never handed a capability it could flip.
   */
  let rosterCapability = null
  if (needsRoster) {
    const platformRow = await prisma.league
      .findUnique({ where: { id: leagueId }, select: { platformLeagueId: true } })
      .catch(() => null)

    rosterCapability = resolveActionCapability({
      execution: viewModel.source.isNative ? 'native_execute' : 'open_provider',
      provider: viewModel.source.provider,
      platformLeagueId: platformRow?.platformLeagueId ?? null,
      sport: viewModel.league.sport,
    })
  }

  return (
    <div className="af-cc">
      <CommandCenterHero viewModel={viewModel} activeSection={activeSection} />

      <div className="af-cc__body">
        <CommandCenterSidebar viewModel={viewModel} activeSection={activeSection} />

        <main className="af-cc__main">
          <MissionControlStrip data={missionControl} />

          <CommandCenterSectionHost
            viewModel={viewModel}
            activeSection={activeSection}
            overview={overview}
            matchups={matchups}
            standings={standings}
            roster={roster}
            rosterCapability={rosterCapability}
            attention={attention}
            leagueHealth={leagueHealth}
          />
        </main>
      </div>
    </div>
  )
}
