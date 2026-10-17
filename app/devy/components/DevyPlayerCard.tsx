'use client'

import { useState } from 'react'

export type DevyPlayerCardVariant = 'starter' | 'bench' | 'ir' | 'taxi' | 'devy'

export type DevyPlayerCardProps = {
  variant: DevyPlayerCardVariant
  playerId: string
  name: string
  position: string
  subtitle?: string
  pointsDisplay?: string | null
  statusLabel?: string
  newsTag?: string | null
  taxiYear?: { current: number; max: number }
  schoolLogoUrl?: string | null
  classYear?: string | null
  projectedYear?: number | null
  nflTeam?: string | null
  onMove?: (action: string) => void
  onPromote?: () => void
  onOpen?: () => void
}

export function DevyPlayerCard({
  variant,
  playerId,
  name,
  position,
  subtitle,
  pointsDisplay,
  statusLabel,
  newsTag,
  taxiYear,
  schoolLogoUrl,
  classYear,
  projectedYear,
  nflTeam,
  onMove,
  onPromote,
  onOpen,
}: DevyPlayerCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const dimmed = variant === 'bench' || variant === 'ir'
  const isDevy = variant === 'devy'
  const isTaxi = variant === 'taxi'

  const ptsColor =
    variant === 'starter'
      ? 'text-emerald-300'
      : variant === 'bench'
        ? 'text-white/35'
        : variant === 'ir'
          ? 'text-white/30'
          : variant === 'taxi'
            ? 'text-amber-200/70'
            : 'text-white/0'

  const tooltip =
    variant === 'bench'
      ? 'Display only — does not count'
      : variant === 'taxi'
        ? 'Taxi — not counted'
        : variant === 'ir'
          ? 'IR — not counted'
          : 'Counts toward score'

  return (
    <div
      className={`relative flex gap-3 rounded-xl border border-white/[0.06] p-3 ${
        isTaxi ? 'bg-[color:var(--devy-badge-taxi)]' : ''
      } ${isDevy ? 'bg-[color:var(--devy-badge-devy)]' : 'bg-black/20'} ${
        dimmed ? 'opacity-90' : ''
      }`}
      data-testid={`devy-card-${playerId}`}
    >
      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
        <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-white/40">
          {name
            .split(' ')
            .map((s) => s[0])
            .join('')
            .slice(0, 3)}
        </div>
        {schoolLogoUrl ? (
          <img src={schoolLogoUrl} alt="" className="absolute bottom-0 right-0 h-5 w-5 rounded-sm object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`truncate text-[13px] font-bold ${dimmed ? 'text-white/75' : 'text-white'}`}>{name}</p>
          {statusLabel ? (
            <span className="rounded-full border border-white/[0.1] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/55">
              {statusLabel}
            </span>
          ) : null}
          {isTaxi ? (
            <span className="rounded-full bg-amber-500/25 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-100">
              Taxi
            </span>
          ) : null}
          {isDevy ? (
            <span className="rounded-full bg-violet-600/35 px-2 py-0.5 text-[11px] font-bold uppercase text-violet-100">
              Devy
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-white/45">
          {position}
          {subtitle ? ` · ${subtitle}` : ''}
          {nflTeam ? ` · ${nflTeam}` : ''}
        </p>
        {classYear ? <p className="text-[11px] text-white/40">Class {classYear}</p> : null}
        {isDevy ? (
          <p className="mt-1 text-[11px] text-violet-200/80">
            {projectedYear ? `NFL entry: ${projectedYear}` : 'Undeclared'}
          </p>
        ) : null}
        {newsTag ? <p className="mt-1 text-[11px] text-amber-200/80">{newsTag}</p> : null}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        {!isDevy ? (
          <span title={tooltip} className={`text-[13px] font-bold tabular-nums ${ptsColor}`}>
            {pointsDisplay ?? '—'}
          </span>
        ) : (
          <span className="text-[11px] text-white/40">College — no scoring</span>
        )}
        {variant === 'starter' ? (
          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-bold text-emerald-200">
            ✓
          </span>
        ) : null}
        {isTaxi && onPromote ? (
          <button
            type="button"
            onClick={onPromote}
            className="mt-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-100 min-h-[44px] md:min-h-0"
            data-testid={`devy-promote-${playerId}`}
          >
            Promote to active
          </button>
        ) : null}
        {isDevy ? (
          <div className="mt-1 flex flex-col gap-1">
            <button
              type="button"
              onClick={onOpen}
              className="text-[11px] font-semibold text-cyan-300/90 underline"
              data-testid={`devy-view-${playerId}`}
            >
              View profile
            </button>
            <span className="text-[11px] text-white/35">Trade rights · Drop (soon)</span>
          </div>
        ) : (
          onMove && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-white/70 min-h-[44px] md:min-h-0"
                data-testid={`devy-move-menu-${playerId}`}
              >
                Move ▾
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-20 mt-1 min-w-[140px] rounded-lg border border-white/[0.1] bg-[#0a1228] py-1 shadow-xl">
                  {(['bench', 'ir', 'taxi'] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-[11px] text-white/80 hover:bg-white/[0.06]"
                      onClick={() => {
                        setMenuOpen(false)
                        onMove(a)
                      }}
                    >
                      {a === 'bench' ? 'Bench' : a === 'ir' ? 'IR' : 'Taxi'}
                    </button>
                  ))}
                  <div className="border-t border-white/[0.06] px-3 py-2 text-[11px] text-white/35">Drop (soon)</div>
                </div>
              ) : null}
            </div>
          )
        )}
        {isTaxi && taxiYear ? (
          <span className="text-[11px] text-amber-100/70">
            Year {taxiYear.current} of {taxiYear.max}
          </span>
        ) : null}
      </div>
    </div>
  )
}
