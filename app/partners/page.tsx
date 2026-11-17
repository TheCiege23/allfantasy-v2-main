import Link from 'next/link'
import { buildSeoMeta } from '@/lib/seo'
import {
  DEMO_DATA_QUALITY,
  DEMO_DECISIONS,
  DEMO_LEAGUES,
  DEMO_PLATFORM,
  DEMO_WEEKS,
  PARTNER_API_ENDPOINTS,
  findDemoLeague,
  leaguesByAttention,
  summarizeTenant,
} from '@/lib/partner-portal/demoTenant'
import { ActivityChart } from '@/components/partners/ActivityChart'
import { DecisionBars } from '@/components/partners/DecisionBars'
import {
  Card,
  DataQualityTable,
  HowItWorksFlow,
  LeagueDrillDown,
  LeagueTable,
  StatTile,
  WidgetCatalog,
} from '@/components/partners/PartnerSections'

/**
 * The B2B front door (docs/os/OS_BACKBONE_PRINCIPLES.md §4, owner's order "B2B visuals", 2026-11-17).
 *
 * A partner should understand their leagues, their users and our value in five minutes, so this is a live
 * demo tenant first and a pitch second: league health across every league with drill-down to one, what the
 * engine recommended and whether it helped, data quality including our own gaps, and how it works. Every
 * number is sample data from lib/partner-portal/demoTenant.ts and says so. Customer-safe language only
 * ("Intelligence"; never "AI" — the no-AI copy guard scans this directory).
 */

export const metadata = buildSeoMeta({
  title: 'League Intelligence for fantasy platforms | AllFantasy',
  description:
    'See league health across every league you run, what the engine recommended and whether it helped, and how the data is sourced. Explore a live demo with sample leagues.',
  canonicalPath: '/partners',
})

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ league?: string | string[] }> }) {
  const sp = await searchParams
  const leagueParam = Array.isArray(sp.league) ? sp.league[0] : sp.league
  const selected = findDemoLeague(leagueParam)
  const summary = summarizeTenant(DEMO_LEAGUES)
  const leagues = leaguesByAttention(DEMO_LEAGUES)

  return (
    <main className="min-h-screen bg-[#050814] text-white">
      <header className="px-4 pb-10 pt-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-300">
            For fantasy platforms and league hosts
          </span>
          <h1 className="mt-4 text-[32px] font-black leading-tight tracking-tight sm:text-[44px]">League Intelligence for your platform</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/65 sm:text-[16px]">
            Know which leagues are healthy and which are slipping, what your managers were advised and whether it helped, and how fresh the
            data behind it is. Connect through a versioned API, with every recommendation logged against its outcome.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#demo" className="rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-bold text-[#050814] hover:bg-cyan-400">
              Explore the live demo
            </a>
            <Link href="/contact?topic=partners" className="rounded-xl border border-white/20 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/5">
              Talk to us
            </Link>
          </div>
        </div>
      </header>

      <div id="demo" className="scroll-mt-6 px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-100" role="note">
            <span className="font-semibold">{DEMO_PLATFORM.name}.</span>
            <span>{DEMO_PLATFORM.note}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Leagues" value={String(summary.leagues)} detail="Across NFL, NBA and MLB" />
            <StatTile
              label="Active managers"
              value={`${summary.activePct}%`}
              detail={`${summary.activeManagers} of ${summary.managers} this week`}
            />
            <StatTile label="Median league health" value={String(summary.medianHealth)} detail="Out of 100" />
            <StatTile
              label="Need attention"
              value={String(summary.needsAttention)}
              detail={`${summary.openActionItems} open items for commissioners`}
            />
          </div>

          <Card title="Manager actions per week, all leagues" subtitle="Lineups set, claims made, trades proposed and messages sent.">
            <ActivityChart labels={DEMO_WEEKS} values={summary.weeklyActions} title="Manager actions per week, all leagues" />
          </Card>

          <Card id="leagues" title="League health" subtitle="Leagues that need attention first. Open a league to see why it scores the way it does.">
            <LeagueTable leagues={leagues} selectedId={selected?.id ?? null} />
          </Card>

          {selected ? (
            <Card id="league" title="League detail" subtitle="The same health score, risks and evidence the API returns for one league.">
              <LeagueDrillDown league={selected} />
            </Card>
          ) : null}

          <Card
            title="What the engine recommended, and whether it helped"
            subtitle="Every recommendation is logged when it is shown, when a manager acts on it, and when its outcome is known."
          >
            <DecisionBars rows={DEMO_DECISIONS} />
          </Card>

          <Card title="Data quality" subtitle="How fresh and complete the data is, per source — including where it falls short.">
            <DataQualityTable rows={DEMO_DATA_QUALITY} />
          </Card>

          <Card id="how-it-works" title="How it works">
            <HowItWorksFlow />
            <h3 className="mt-8 text-sm font-semibold text-white">The API</h3>
            <p className="mt-1 text-sm text-white/60">
              Versioned under <code className="rounded bg-white/10 px-1 py-0.5 text-xs">/api/v1</code>, scoped to your tenant by API key, with per-tier
              rate limits.
            </p>
            <ul className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10">
              {PARTNER_API_ENDPOINTS.map((e) => (
                <li key={e.path} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="w-12 shrink-0 text-xs font-bold text-emerald-300">{e.method}</span>
                  <code className="break-all text-xs text-white/85">{e.path}</code>
                  <span className="text-xs text-white/55 sm:ml-auto sm:text-right">{e.what}</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-8 text-sm font-semibold text-white">Widgets by license</h3>
            <p className="mt-1 text-sm text-white/60">
              The views you can place in your own app, by license tier. Embed code for your site comes with your sandbox key.
            </p>
            <div className="mt-3">
              <WidgetCatalog />
            </div>
          </Card>

          <section className="rounded-2xl border border-cyan-500/30 bg-cyan-500/[0.06] p-6 text-center">
            <h2 className="text-xl font-bold">See it on your own leagues</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-white/65">
              We set up a sandbox tenant with your leagues, so the charts above show your platform instead of sample data.
            </p>
            <Link href="/contact?topic=partners" className="mt-4 inline-block rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-bold text-[#050814] hover:bg-cyan-400">
              Talk to us
            </Link>
          </section>
        </div>
      </div>
    </main>
  )
}
