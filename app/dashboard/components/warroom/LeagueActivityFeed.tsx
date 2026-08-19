'use client'

import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { ArrowRightLeft, HeartPulse, LayoutGrid, Megaphone, MessageSquare, Sparkles, TrendingUp, UserPlus } from 'lucide-react'
import { useActivityFeed } from '@/hooks/useActivityFeed'
import type { ActivityFeedItem } from '@/lib/activity/types'
import { WarRoomCard } from './WarRoomCard'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { InterpolationVars } from '@/lib/i18n/tInterpolate'

const TYPE_ICON = {
  trade: ArrowRightLeft,
  waiver: UserPlus,
  lineup: LayoutGrid,
  message: MessageSquare,
  announcement: Megaphone,
  injury: HeartPulse,
  standings: TrendingUp,
} as const

/** Where an item deep-links: its own href (a trade, a player, an announcement) or its league. */
function itemHref(item: ActivityFeedItem): string | null {
  if (item.href) return item.href
  if (item.leagueId) return `/league/${item.leagueId}`
  return null
}

function formatRelativeTime(iso: string, t: (key: string) => string, tInterpolate: (key: string, vars?: InterpolationVars) => string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return t('dashboard.warroom.time.justNow')
  if (diff < 3600000) return tInterpolate('dashboard.warroom.time.minutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return tInterpolate('dashboard.warroom.time.hoursAgo', { n: Math.floor(diff / 3600000) })
  return tInterpolate('dashboard.warroom.time.daysAgo', { n: Math.floor(diff / 86400000) })
}

/** Dark "war room" presentation over the real activity feed (same data hook the light-mode ActivityFeed uses). */
export function LeagueActivityFeed() {
  const { t, tInterpolate } = useLanguage()
  const { items, loading } = useActivityFeed({ limit: 12 })
  const visible = items.slice(0, 12)

  // Slide-in on new events: track the previous poll's item ids; anything not seen before gets
  // the entrance animation so the feed visibly "breathes" as fresh activity lands. The very first
  // load animates nothing (prevIds is null) — we only animate genuinely new items on later polls.
  const prevIds = useRef<Set<string> | null>(null)
  const newIds = useMemo(() => {
    const prev = prevIds.current
    if (prev === null) return new Set<string>()
    return new Set(visible.filter((i) => !prev.has(i.id)).map((i) => i.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  useEffect(() => {
    prevIds.current = new Set(visible.map((i) => i.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  return (
    <WarRoomCard className="overflow-hidden" accentBorder="rgba(255,255,255,0.08)">
      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t('dashboard.warroom.activityFeed.title')}
        </p>
      </div>
      {loading ? (
        <div className="px-4 py-6 text-center text-[11px] text-white/30">
          {t('dashboard.warroom.activityFeed.loading')}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] text-white/30">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <p className="text-[12px] font-semibold text-white/50">{t('dashboard.warroom.activityFeed.emptyTitle')}</p>
          <p className="max-w-[220px] text-[11px] leading-snug text-white/30">
            {t('dashboard.warroom.activityFeed.emptyDesc')}
          </p>
        </div>
      ) : (
        <ul className="max-h-[280px] overflow-y-auto">
          {visible.map((item) => {
            const Icon = TYPE_ICON[item.type] ?? Megaphone
            const href = itemHref(item)
            const isNew = newIds.has(item.id)
            const inner = (
              <>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-white/50">
                  <Icon className="h-3 w-3" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  {/* item.description is real event text from the shared activity API — not a UI-owned
                      string this component controls, so it is not translated here. */}
                  <p className="truncate text-[12px] text-white/80">{item.description}</p>
                  {/* Relative-time text is computed from Date.now() and legitimately differs
                      between server-render and client-hydration instants — not a real mismatch. */}
                  <p className="mt-0.5 text-[10px] text-white/30" suppressHydrationWarning>
                    {item.leagueName ? `${item.leagueName} · ` : ''}
                    {formatRelativeTime(item.timestamp, t, tInterpolate)}
                  </p>
                </div>
              </>
            )
            const rowClass = `flex items-start gap-2.5 border-b border-white/[0.04] px-4 py-2.5 last:border-b-0${isNew ? ' af-activity-slidein' : ''}`
            return href ? (
              <li key={item.id} className={isNew ? 'af-activity-slidein' : undefined}>
                <Link href={href} className="flex items-start gap-2.5 border-b border-white/[0.04] px-4 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.03]">
                  {inner}
                </Link>
              </li>
            ) : (
              <li key={item.id} className={rowClass}>
                {inner}
              </li>
            )
          })}
        </ul>
      )}
      <style jsx>{`
        :global(.af-activity-slidein) {
          animation: afActivitySlideIn 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes afActivitySlideIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.af-activity-slidein) {
            animation: none;
          }
        }
      `}</style>
    </WarRoomCard>
  )
}
