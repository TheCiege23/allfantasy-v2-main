'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { LeagueActivityItem, LeagueActivityLine } from '@/components/league/types'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return name.slice(0, 2).toUpperCase() || '?'
}

/** Adds before drops; notes last */
function sortActivityLines(lines: LeagueActivityLine[]): LeagueActivityLine[] {
  const order: Record<string, number> = { add: 0, drop: 1, note: 2 }
  return [...lines].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))
}

function transactionPill(item: LeagueActivityItem): { label: string; className: string } {
  if (item.type === 'trade') {
    return { label: 'TRADE', className: 'border-[#ff3d81]/35 bg-[#ff3d81]/15 text-[#ffd7e5]' }
  }
  if (item.badge === 'FREE AGENCY' || item.badge.toUpperCase().includes('FREE')) {
    return { label: 'FREE AGENT', className: 'border-sky-500/35 bg-sky-500/10 text-sky-100/95' }
  }
  const bid = item.amountLabel?.match(/\$(\d+)/)
  const amt = bid ? bid[1] : '0'
  return {
    label: `WAIVERED $${amt}`,
    className: 'border-[#ff3d81]/30 bg-[#ff3d81]/10 text-[#ffd7e5]/90',
  }
}

export function LeagueRecentActivity({ leagueId }: { leagueId: string }) {
  const [items, setItems] = useState<LeagueActivityItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/activity`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('activity'))))
      .then((data: unknown) => {
        if (cancelled) return
        setItems(Array.isArray(data) ? (data as LeagueActivityItem[]) : [])
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const preview = useMemo(() => (items ? items.slice(0, 8) : []), [items])

  if (items === null) {
    return (
      <section
        className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121826]"
        aria-label="Recent activity"
        data-testid="league-recent-activity-loading"
      >
        <div className="border-b border-white/[0.07] px-4 py-3">
          <div className="h-4 w-36 animate-pulse rounded bg-white/10" />
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="h-16 animate-pulse rounded-lg bg-white/[0.04]" />
          <div className="h-16 animate-pulse rounded-lg bg-white/[0.04]" />
        </div>
      </section>
    )
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121826]"
      aria-label="Recent activity"
      data-testid="league-recent-activity"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <h2 className="text-[14px] font-bold text-white sm:text-[15px]">Recent Activity</h2>
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?view=trades`}
          className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#ff3d81]/95 transition hover:text-[#ff9ec0]"
          data-testid="league-recent-activity-view-all"
        >
          View all
        </Link>
      </div>

      {preview.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-white/45 sm:px-5">No recent waiver or trade activity.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {preview.map((item) => {
            const pill = transactionPill(item)
            const lines = sortActivityLines(item.lines)
            return (
              <li key={item.id} className="px-3 py-3.5 sm:px-4">
                <div className="flex gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-bold text-white/85"
                    aria-hidden
                  >
                    {initials(item.managerName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-white">{item.managerName}</div>
                        <div className="text-[11px] text-white/40">{item.timestamp}</div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                    </div>

                    {item.type === 'trade' ? (
                      <p className="mt-2 text-[12px] leading-snug text-white/75">
                        {item.summary?.trim() ? item.summary : 'Trade completed'}
                      </p>
                    ) : (
                      <div className="mt-2 space-y-1.5">
                        {lines.map((line, idx) => {
                          if (line.type === 'note' || !line.playerName) {
                            return null
                          }
                          const meta = line.playerMeta?.trim() ?? ''
                          const isAdd = line.type === 'add'
                          return (
                            <div
                              key={`${item.id}-${idx}`}
                              className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] leading-snug"
                            >
                              <span
                                className={`font-bold ${isAdd ? 'text-emerald-400' : 'text-pink-400'}`}
                                aria-hidden
                              >
                                {isAdd ? '+' : '−'}
                              </span>
                              <span className="font-medium text-white">
                                {line.playerName}
                                {meta ? <span className="text-white/90"> {meta}</span> : null}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
