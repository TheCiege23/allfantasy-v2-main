'use client'

import Link from 'next/link'

export type SurvivorDeepLinkTabId =
  | 'survivor_tribal'
  | 'survivor_challenges'
  | 'survivor_chimmy'
  | 'survivor_exile'
  | 'survivor_jury'
  | 'survivor_command'

const SEGMENT: Record<SurvivorDeepLinkTabId, string> = {
  survivor_tribal: 'tribal',
  survivor_challenges: 'challenges',
  survivor_chimmy: 'chimmy',
  survivor_exile: 'exile',
  survivor_jury: 'jury',
  survivor_command: 'commissioner',
}

const COPY: Record<SurvivorDeepLinkTabId, { title: string; subtitle: string }> = {
  survivor_tribal: {
    title: 'Tribal council',
    subtitle: 'Votes, advantages, and elimination rounds run in the Survivor island experience.',
  },
  survivor_challenges: {
    title: 'Challenges',
    subtitle: 'Reward and immunity challenges, scoring, and results live on the island route.',
  },
  survivor_chimmy: {
    title: 'Chimmy',
    subtitle: 'Coaching from Chimmy and narrative context for this league open in the island workspace.',
  },
  survivor_exile: {
    title: 'Exile',
    subtitle: 'Exile island, tokens, and twists are managed in the full Survivor experience.',
  },
  survivor_jury: {
    title: 'Jury',
    subtitle: 'Final jury voting and finale context are available on the island.',
  },
  survivor_command: {
    title: 'Commissioner command',
    subtitle: 'Bootstrap, exile rules, tribal cadence, and commissioner tools live here.',
  },
}

export function SurvivorLeagueDeepLinkPanel({
  leagueId,
  tabId,
}: {
  leagueId: string
  tabId: SurvivorDeepLinkTabId
}) {
  const segment = SEGMENT[tabId]
  const href = `/survivor/${encodeURIComponent(leagueId)}/${segment}`
  const islandHome = `/survivor/${encodeURIComponent(leagueId)}`
  const { title, subtitle } = COPY[tabId]

  return (
    <div className="flex min-h-[min(60vh,28rem)] flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#0c1428]/95 to-[#07071a] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/75">
          Survivor island
        </p>
        <h2 className="mt-2 text-lg font-bold text-white">{title}</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-white/65">{subtitle}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={href}
            className="inline-flex items-center justify-center rounded-xl border border-amber-400/35 bg-amber-500/15 px-4 py-2.5 text-[13px] font-semibold text-amber-100 transition-colors hover:bg-amber-500/25"
            data-testid={`survivor-deeplink-open-${tabId.replace('survivor_', '')}`}
          >
            Open full island experience →
          </Link>
          <Link
            href={islandHome}
            className="inline-flex items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-[13px] font-semibold text-white/80 transition-colors hover:bg-white/[0.08]"
            data-testid="survivor-deeplink-island-home"
          >
            Island home
          </Link>
        </div>
      </div>
    </div>
  )
}
