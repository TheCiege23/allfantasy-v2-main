'use client'

import Link from 'next/link'
import type { SerializedConference } from '@/lib/tournament/tournamentPageData'

function hueShift(hex: string | null | undefined, leagueIndex: number): string {
  if (!hex || !/^#([0-9a-f]{6})$/i.test(hex)) {
    return 'linear-gradient(135deg, #0e7490, #1e3a8a)'
  }
  const base = hex.slice(1)
  const r = parseInt(base.slice(0, 2), 16)
  const g = parseInt(base.slice(2, 4), 16)
  const b = parseInt(base.slice(4, 6), 16)
  const shift = leagueIndex * 10
  const nr = Math.min(255, Math.max(0, r + shift))
  const ng = Math.min(255, Math.max(0, g + shift / 2))
  const nb = Math.min(255, Math.max(0, b - shift / 3))
  return `linear-gradient(135deg, rgb(${nr},${ng},${nb}), rgb(${r},${g},${b}))`
}

export function LeagueIdentityCard({
  name,
  conference,
  roundLabel,
  teamSlots,
  currentCount,
  status,
  leagueId,
  href,
  leagueIndex = 0,
}: {
  name: string
  conference: SerializedConference | null
  roundLabel: string
  teamSlots: number
  currentCount: number
  status: string
  leagueId: string
  href?: string
  leagueIndex?: number
}) {
  const bg = hueShift(conference?.colorHex ?? null, leagueIndex)
  const inner = (
    <div className="overflow-hidden rounded-xl border border-[var(--tournament-border)] bg-[var(--tournament-panel)]">
      <div
        className="relative flex h-[100px] items-end justify-start bg-cover p-3 md:h-[120px]"
        style={{ background: bg }}
      >
        <p className="text-[15px] font-bold text-white drop-shadow-md">{name}</p>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {conference ? (
            <span
              className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={{
                borderColor: `${conference.colorHex ?? '#fff'}44`,
                background: `${conference.colorHex ?? '#333'}22`,
              }}
            >
              {conference.name}
            </span>
          ) : null}
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{roundLabel}</span>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-[var(--tournament-text-mid)]">
            {currentCount}/{teamSlots} teams
          </span>
        </div>
        <p className="text-[11px] uppercase tracking-wide text-[var(--tournament-text-dim)]">
          Status: <span className="text-white/80">{status}</span>
        </p>
        <p className="font-mono text-[11px] text-[var(--tournament-text-dim)]">ID: {leagueId.slice(0, 8)}…</p>
      </div>
    </div>
  )
  if (href) return <Link href={href}>{inner}</Link>
  return inner
}
