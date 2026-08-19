'use client'

import Link from 'next/link'
import { Swords, Sparkles, Activity, Search, Trophy } from 'lucide-react'

type MissionCard = {
  key: string
  icon: React.ReactNode
  title: string
  reason: string
  urgency: 'active' | 'ready' | 'watch'
  badge?: string
  href?: string
  onClick?: () => void
}

type TodaysMissionStripProps = {
  warRoomDecisions: number
  pendingTrades: number
  waiverSuggestions: number
  onWarRoomClick: () => void
  onChimmyClick: () => void
  onTradesClick: () => void
  onWaiverClick: () => void
}

const URGENCY: Record<'active' | 'ready' | 'watch', { card: string; chip: string; label: string }> = {
  active: {
    card: 'border-cyan-300/35 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_45%),linear-gradient(135deg,rgba(34,211,238,0.10),rgba(255,255,255,0.035))] shadow-[0_0_24px_-16px_rgba(34,211,238,0.95)]',
    chip: 'border-cyan-300/45 bg-cyan-300/[0.16] text-cyan-50 shadow-[0_0_18px_-10px_rgba(34,211,238,0.9)]',
    label: 'Active',
  },
  ready: {
    card: 'border-violet-300/25 bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.16),transparent_42%),linear-gradient(135deg,rgba(167,139,250,0.08),rgba(255,255,255,0.03))]',
    chip: 'border-violet-300/35 bg-violet-300/[0.14] text-violet-50',
    label: 'Ready',
  },
  watch: {
    card: 'border-white/[0.09] bg-white/[0.035]',
    chip: 'border-white/15 bg-white/[0.07] text-white/65',
    label: 'Info',
  },
}

export function TodaysMissionStrip({
  warRoomDecisions,
  pendingTrades,
  waiverSuggestions,
  onWarRoomClick,
  onChimmyClick,
  onTradesClick,
  onWaiverClick,
}: TodaysMissionStripProps) {
  const cards: MissionCard[] = [
    {
      key: 'war-room',
      icon: <Swords className="h-4 w-4" />,
      title: 'Open AF Legacy',
      reason: warRoomDecisions > 0 ? `${warRoomDecisions} decisions ready for review` : 'NFL draft intelligence is active',
      urgency: 'active' as const,
      badge: warRoomDecisions > 0 ? String(warRoomDecisions) : undefined,
      onClick: onWarRoomClick,
    },
    {
      key: 'chimmy',
      icon: <Sparkles className="h-4 w-4" />,
      title: 'Ask Chimmy',
      reason: 'Get personalized roster strategy and matchup outlook',
      urgency: 'ready' as const,
      onClick: onChimmyClick,
    },
    ...(pendingTrades > 0
      ? [
          {
            key: 'trades',
            icon: <Activity className="h-4 w-4" />,
            title: 'Review Trades',
            reason: `${pendingTrades} pending trade${pendingTrades > 1 ? 's' : ''} need your attention`,
            urgency: 'watch' as const,
            badge: String(pendingTrades),
            onClick: onTradesClick,
          },
        ]
      : []),
    ...(waiverSuggestions > 0
      ? [
          {
            key: 'waivers',
            icon: <Search className="h-4 w-4" />,
            title: 'Waiver Pickups',
            reason: `${waiverSuggestions} pickup${waiverSuggestions > 1 ? 's' : ''} recommended this week`,
            urgency: 'watch' as const,
            badge: String(waiverSuggestions),
            onClick: onWaiverClick,
          },
        ]
      : []),
    {
      key: 'rankings',
      icon: <Trophy className="h-4 w-4" />,
      title: 'View Legacy',
      reason: 'Track your AF rank, tier, and championship history',
      urgency: 'watch' as const,
      href: '/af-rankings',
    },
  ].slice(0, 5)

  return (
    <section className="rounded-2xl border border-cyan-300/10 bg-black/20 p-3 shadow-[0_18px_46px_-38px_rgba(34,211,238,0.75)]">
      <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/55">
        Today&apos;s Mission
      </p>
      <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
        {cards.map((card) => {
          const style = URGENCY[card.urgency]
          const inner = (
            <>
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${style.chip}`}
                >
                  {card.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-white/90">{card.title}</span>
                    {card.badge && (
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${style.chip}`}>
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-white/45">{card.reason}</p>
                </div>
              </div>
            </>
          )

          const baseClass = `group relative flex min-w-0 cursor-pointer items-center rounded-2xl border px-3 py-3 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/35 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${style.card}`

          return card.href ? (
            <Link key={card.key} href={card.href} className={baseClass}>
              {inner}
            </Link>
          ) : (
            <button key={card.key} type="button" onClick={card.onClick} className={baseClass}>
              {inner}
            </button>
          )
        })}
      </div>
    </section>
  )
}
