'use client'

import clsx from 'clsx'

export type ZombieFeedEvent = {
  id: string
  kind: string
  title: string
  subtitle?: string
  week?: number | null
  leagueName?: string | null
  timestamp?: string | null
  metadata?: Record<string, unknown>
}

const BORDER: Record<string, string> = {
  infection_event: 'border-l-[var(--zombie-purple)]',
  bashing_event: 'border-l-orange-500',
  mauling_event: 'border-l-[var(--zombie-red)] shadow-[var(--zombie-glow-red)]',
  revival_event: 'border-l-[var(--zombie-gold)]',
  weapon_event: 'border-l-white/20',
  serum_event: 'border-l-teal-500',
  ambush_event: 'border-l-[var(--zombie-crimson)]',
  whisperer_replaced: 'border-l-[var(--zombie-crimson)] animate-pulse',
  horde_milestone: 'border-l-[var(--zombie-purple)]',
  last_survivor: 'border-l-[var(--zombie-red)]',
  bomb_event: 'border-l-amber-500',
  announcement: 'border-l-white/15',
  weekly_update: 'border-l-sky-500/50',
  animation: 'border-l-sky-500/40',
}

const BG_HIGHLIGHT: Record<string, string> = {
  mauling_event: 'bg-[var(--zombie-red)]/[0.04]',
  bomb_event: 'bg-amber-500/[0.04]',
  whisperer_replaced: 'bg-[var(--zombie-crimson)]/[0.04]',
  last_survivor: 'bg-[var(--zombie-red)]/[0.06]',
  revival_event: 'bg-[var(--zombie-gold)]/[0.04]',
}

const ANIM_CLASS: Record<string, string> = {
  infection_event: 'zombie-turn-anim',
  mauling_event: 'mauling-anim',
  revival_event: 'revival-anim',
  weapon_event: 'weapon-pop-anim',
  serum_event: 'serum-anim',
  ambush_event: 'ambush-anim',
  bomb_event: 'bomb-anim',
}

export function ZombieEventCard({ event, compact, animate }: { event: ZombieFeedEvent; compact?: boolean; animate?: boolean }) {
  const b = BORDER[event.kind] ?? BORDER.announcement
  const bg = BG_HIGHLIGHT[event.kind] ?? ''
  const animClass = animate ? ANIM_CLASS[event.kind] : undefined

  return (
    <article
      className={clsx(
        'rounded-xl border border-[var(--zombie-border)] py-2.5 pl-3 pr-3 border-l-4 transition-all',
        'bg-[var(--zombie-panel)]',
        bg,
        b,
        animClass,
      )}
    >
      <p className="text-[13px] leading-snug text-[var(--zombie-text-full)]">{event.title}</p>
      {!compact && event.subtitle ? (
        <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--zombie-text-mid)]">{event.subtitle}</p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--zombie-text-dim)]">
        {event.week != null ? <span>Week {event.week}</span> : null}
        {event.leagueName ? <span>{event.leagueName}</span> : null}
        {event.timestamp ? (
          <span>{new Date(event.timestamp).toLocaleDateString()}</span>
        ) : null}
      </div>
    </article>
  )
}
