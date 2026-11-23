import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildSeoMeta } from '@/lib/seo'
import { loadPortalView } from '@/lib/partner-portal/workspace'
import { portalDeps } from '@/lib/partner-portal/workspaceDeps'
import { Card, StatTile } from '@/components/partners/PartnerSections'
import { LiveIntelligencePanels } from '@/components/partners/LiveIntelligencePanels'
import { DemoLink, PortalLeagueTable, PortalNotice, PortalSourcesTable, RecommendationRecord } from '@/components/partners/PortalSections'

/**
 * The signed-in partner portal (docs/os/OS_BACKBONE_PRINCIPLES.md §4, owner's decisions 2026-11-17). The read
 * path and its safety argument live in lib/partner-portal/workspace.ts. Customer-safe language only (the no-AI
 * copy guard scans app/partners).
 */

export const dynamic = 'force-dynamic'

export const metadata = buildSeoMeta({
  title: 'Partner workspace | AllFantasy',
  description: 'League health, activity and data quality for the leagues in your partner workspace.',
  canonicalPath: '/partners/portal',
  noIndex: true,
})

const ROLE_LABEL = { TENANT_OWNER: 'Owner', TENANT_ADMIN: 'Admin', TENANT_SUPPORT: 'Support' } as const

type SessionShape = { user?: { id?: string | null; name?: string | null; email?: string | null } } | null

export default async function PartnerPortalPage() {
  const session = (await getServerSession(authOptions as never)) as SessionShape
  const userId = session?.user?.id
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent('/partners/portal')}`)

  const view = await loadPortalView({ id: userId, label: session?.user?.name || session?.user?.email || userId }, portalDeps)
  const now = new Date()
  // The platform-wide live panels (lib/partner-portal/liveIntelligence.ts) — the same numbers /partners shows.
  const live =
    view.kind === 'ok'
      ? await Promise.all([import('@/lib/prisma'), import('@/lib/partner-portal/liveIntelligence')])
          .then(([{ prisma }, { loadLiveIntelligence }]) => loadLiveIntelligence(prisma as never))
          .catch(() => null)
      : null

  return (
    <main className="min-h-screen bg-[#050814] px-4 pb-20 pt-12 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <Link href="/partners" className="text-xs text-white/55 hover:text-white">
            ← League Intelligence for platforms
          </Link>
          <h1 className="mt-2 text-[28px] font-black leading-tight sm:text-[36px]">
            {view.kind === 'ok' ? view.workspaceName : 'Partner workspace'}
          </h1>
          {view.kind === 'ok' ? (
            <p className="mt-1 text-sm text-white/60">
              Signed in as {ROLE_LABEL[view.role]}
              {view.otherWorkspaces > 0 ? ` · you belong to ${view.otherWorkspaces} other workspace${view.otherWorkspaces === 1 ? '' : 's'}; this is the first` : ''}
            </p>
          ) : null}
        </header>

        {view.kind === 'unavailable' ? (
          <PortalNotice title="Partner workspaces aren't switched on yet" action={<DemoLink />}>
            We couldn&apos;t reach the workspace service just now. Nothing about your account has changed. Try again later, or explore the demo in
            the meantime.
          </PortalNotice>
        ) : null}

        {view.kind === 'not_member' ? (
          <PortalNotice
            title="This account isn't part of a partner workspace"
            action={
              <>
                <Link href="/partners#contact" className="rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-bold text-[#050814] hover:bg-cyan-400">
                  Talk to us
                </Link>
                <DemoLink />
              </>
            }
          >
            Workspaces are set up for each partner by our team. If your company works with us, ask your workspace owner to add this account. If
            you&apos;d like a workspace for your platform, talk to us.
          </PortalNotice>
        ) : null}

        {view.kind === 'forbidden' ? (
          <PortalNotice title="Your role can't view this workspace's reports" action={<DemoLink />}>
            Ask your workspace owner to change your role.
          </PortalNotice>
        ) : null}

        {view.kind === 'ok' ? (
          view.leagues.length === 0 ? (
            <PortalNotice title="No leagues are linked yet" action={<DemoLink />}>
              Your workspace is set up, but no leagues have been linked to it. Once our team links your leagues, their health, activity and
              data quality show here.
            </PortalNotice>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile label="Leagues" value={String(view.summary.leagues)} />
                <StatTile
                  label="Active managers"
                  value={view.summary.managers ? `${view.summary.activePct}%` : '—'}
                  detail={view.summary.managers ? `${view.summary.activeManagers} of ${view.summary.managers}, last 14 days` : 'No manager activity yet'}
                />
                <StatTile label="Median league health" value={String(view.summary.medianHealth)} detail="Out of 100" />
                <StatTile label="Need attention" value={String(view.summary.needsAttention)} detail={`${view.summary.openItems} flagged items`} />
              </div>
              <Card title="League health" subtitle="Worst first. Health combines how recently the league was active with how many managers are active.">
                <PortalLeagueTable leagues={view.leagues} />
              </Card>
              <Card title="Data quality" subtitle="Sync health per source, including leagues that have never synced.">
                <PortalSourcesTable sources={view.sources} now={now} />
              </Card>
              <Card
                title="Recommendation record"
                subtitle="How the lineup and pickup recommendations given in your leagues turned out, graded only once every game of the week is over."
              >
                <RecommendationRecord record={view.record} unavailable={view.recordUnavailable} />
              </Card>
              {live ? <LiveIntelligencePanels data={live} /> : null}
            </>
          )
        ) : null}
      </div>
    </main>
  )
}
