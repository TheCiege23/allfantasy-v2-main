'use client'

import Link from 'next/link'
import { Flag } from 'lucide-react'
import type { ActivityFeedItem } from '@/lib/activity/types'

/**
 * One row of the 10c feed.
 *
 * ⚠ BUILD RULE 1: the commissioner broadcast is the ONLY row that gets a coloured border. Every
 * other event type keeps the same neutral card so the feed reads as a flat, unbiased log —
 * differentiation is carried by the icon and the type tag, not by row weight.
 *
 * ⚠ BUILD RULE 2 IS HONOURED AS FAR AS THE DATA ALLOWS. The handoff's tags are granular
 * (`TRADE_ACCEPTED`, `TRADE_REJECTED`, `PLAYOFF_CLINCH`). The aggregator behind this feed is
 * coarser — it emits `trade`, `waiver`, `lineup`, `announcement`, `injury`, `standings` — so the
 * tag is the real type uppercased. Rendering `TRADE_ACCEPTED` over an item that only says "trade"
 * would be inventing a distinction the data does not carry.
 */

/** Mono, uppercase, log-like — deliberately terse and distinct from the sentence below it. */
function typeTag(item: ActivityFeedItem): string {
  if (item.type === 'announcement') return 'Commissioner · Broadcast'
  return item.type
}

const ICON_TINT: Record<string, string> = {
  trade: 'bg-cyan-400/15 text-cyan-300',
  waiver: 'bg-violet-400/15 text-violet-300',
  lineup: 'bg-white/[0.07] text-white/60',
  message: 'bg-white/[0.07] text-white/60',
  injury: 'bg-rose-400/15 text-rose-300',
  standings: 'bg-emerald-400/15 text-emerald-300',
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '—'
  )
}

/** "4m ago" / "3h ago" / "2d ago". Absolute date once it stops being a live event. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(then).toLocaleDateString()
}

export default function FeedEvent({ item }: { item: ActivityFeedItem }) {
  const isBroadcast = item.type === 'announcement'

  const body = (
    <div
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
        isBroadcast
          ? 'border-amber-400/45 bg-amber-500/[0.07]'
          : 'border-white/10 bg-white/[0.03]'
      }`}
      data-testid={`feed-event-${item.id}`}
      data-broadcast={isBroadcast ? 'true' : undefined}
    >
      <span
        aria-hidden
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold ${
          isBroadcast ? 'bg-amber-400/20 text-amber-300' : (ICON_TINT[item.type] ?? 'bg-white/[0.07] text-white/60')
        }`}
      >
        {isBroadcast ? <Flag className="h-4 w-4" /> : initials(item.userName)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-bold text-white">{item.userName || 'League'}</span>
          <span
            className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${
              isBroadcast ? 'text-amber-300' : 'text-white/35'
            }`}
          >
            {typeTag(item)}
          </span>
        </span>
        <span className="mt-0.5 block text-sm leading-relaxed text-white/70">
          {item.description}
        </span>
      </span>

      <span className="shrink-0 font-mono text-[11px] text-white/35">
        {relativeTime(item.timestamp)}
      </span>
    </div>
  )

  /* The aggregator supplies a deep link for items that have one; the rest are not fake links. */
  return item.href ? (
    <Link href={item.href} className="block focus:outline-none focus:ring-2 focus:ring-cyan-400/40 rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  )
}
