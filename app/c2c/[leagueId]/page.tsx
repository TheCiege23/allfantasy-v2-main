import Link from 'next/link'
import { ArrowRight, GraduationCap, Trophy, Users, Layers, Briefcase } from 'lucide-react'

export const metadata = {
  title: 'Campus to Canton — League Hub',
}

interface HubLink {
  href: (leagueId: string) => string
  label: string
  description: string
  icon: typeof GraduationCap
  accent: string
}

const LINKS: HubLink[] = [
  {
    href: (id) => `/c2c/${encodeURIComponent(id)}/roster`,
    label: 'Roster',
    description: 'Campus, canton, bench, taxi, devy, and IR buckets.',
    icon: Layers,
    accent: 'border-sky-500/30 bg-sky-500/[0.06] text-sky-200',
  },
  {
    href: (id) => `/c2c/${encodeURIComponent(id)}/campus`,
    label: 'Campus',
    description: 'College-side lineup and NCAAF/NCAAB scoring.',
    icon: GraduationCap,
    accent: 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200',
  },
  {
    href: (id) => `/c2c/${encodeURIComponent(id)}/canton`,
    label: 'Canton',
    description: 'Pro-side lineup and NFL/NBA scoring.',
    icon: Briefcase,
    accent: 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200',
  },
  {
    href: (id) => `/c2c/${encodeURIComponent(id)}/matchup`,
    label: 'Matchup',
    description: 'This-week head-to-head, combined campus + canton.',
    icon: Users,
    accent: 'border-indigo-500/30 bg-indigo-500/[0.06] text-indigo-200',
  },
  {
    href: (id) => `/c2c/${encodeURIComponent(id)}/picks`,
    label: 'Picks',
    description: 'Season-long pick tracking and promotion opportunities.',
    icon: Trophy,
    accent: 'border-rose-500/30 bg-rose-500/[0.06] text-rose-200',
  },
]

export default async function C2CLeagueHubPage(props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const { leagueId } = params
  return (
    <div className="min-h-screen bg-[#040915] px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-start gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-[#0a1228] to-[#040915] p-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-200">
            <GraduationCap className="h-8 w-8" />
          </div>
          <div className="flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-200/80">
              Campus to Canton
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">League hub</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/65">
              Pro + college combined. NFL and NBA starters count alongside NCAAF and NCAAB. Taxi and devy
              slots are roster-only and do not count toward weekly scoring.
            </p>
          </div>
          <Link
            href={`/league/${encodeURIComponent(leagueId)}`}
            className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/80 hover:bg-white/10"
          >
            League dashboard
          </Link>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.map((link) => {
            const Icon = link.icon
            return (
              <Link
                key={link.label}
                href={link.href(leagueId)}
                className={`group flex h-full flex-col justify-between rounded-2xl border p-4 transition hover:bg-white/[0.04] ${link.accent}`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5" />
                  <span className="text-base font-bold text-white">{link.label}</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-white/70">{link.description}</p>
                <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80 group-hover:opacity-100">
                  Open <ArrowRight className="h-3 w-3" />
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
