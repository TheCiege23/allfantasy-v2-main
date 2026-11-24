'use client'

import { useState } from 'react'

type DevyPlayerCardVariant = 'starter' | 'bench' | 'ir' | 'taxi' | 'devy'

type DevyPlayerCardProps = {
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
      ? 'text-[var(--good)]'
      : variant === 'bench'
        ? 'text-[var(--faint)]'
        : variant === 'ir'
          ? 'text-[var(--faint)]'
          : variant === 'taxi'
            ? 'text-[var(--devy-amber)]'
            : 'text-[var(--faint)]'

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
      className={`relative flex items-center gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5 ${
        isTaxi ? 'bg-[color:var(--devy-badge-taxi)]' : ''
      } ${isDevy ? 'bg-[color:var(--devy-badge-devy)]' : 'bg-[var(--surface2)]'} ${
        dimmed ? 'opacity-90' : ''
      }`}
      data-testid={`devy-card-${playerId}`}
    >
      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
        <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-[var(--muted)]">
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
          <p className={`line-clamp-2 break-words text-[14px] font-bold leading-snug ${dimmed ? 'text-[var(--text2)]' : 'text-[var(--text)]'}`}>{name}</p>
          {statusLabel ? (
            <span className="rounded-full border border-white/[0.1] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
              {statusLabel}
            </span>
          ) : null}
          {isTaxi ? (
            <span className="rounded-full bg-[var(--devy-amber-soft)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--devy-amber)]">
              Taxi
            </span>
          ) : null}
          {isDevy ? (
            <span className="rounded-full bg-[var(--devy-violet-soft)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--devy-violet)]">
              Devy
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          {position}
          {subtitle ? ` · ${subtitle}` : ''}
          {nflTeam ? ` · ${nflTeam}` : ''}
        </p>
        {classYear ? <p className="text-[11px] text-[var(--muted)]">Class {classYear}</p> : null}
        {isDevy ? (
          <p className="mt-1 text-[11px] text-[var(--devy-violet)]">
            {projectedYear ? `Projected NFL entry: ${projectedYear}` : 'Undeclared'}
          </p>
        ) : null}
        {newsTag ? <p className="mt-1 text-[11px] text-[var(--devy-amber)]">{newsTag}</p> : null}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {!isDevy ? (
          <span title={tooltip} className={`text-[13px] font-bold tabular-nums ${ptsColor}`}>
            {pointsDisplay ?? '—'}
          </span>
        ) : (
          null
        )}
        {isTaxi && onPromote ? (
          <button
            type="button"
            onClick={onPromote}
            className="mt-1 rounded-lg border border-[var(--devy-amber-line)] bg-[var(--devy-amber-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--devy-amber)] min-h-[44px] md:min-h-0"
            data-testid={`devy-promote-${playerId}`}
          >
            Promote to active
          </button>
        ) : null}
        {isDevy ? (
          <div className="flex items-center">
            <button
              type="button"
              onClick={onOpen}
              className="text-[11px] font-semibold text-[var(--accent)] underline"
              data-testid={`devy-view-${playerId}`}
            >
              View profile
            </button>
          </div>
        ) : (
          onMove && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-[var(--text2)] min-h-[44px] md:min-h-0"
                data-testid={`devy-move-menu-${playerId}`}
              >
                Move ▾
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-20 mt-1 min-w-[140px] rounded-lg border border-white/[0.1] bg-[var(--surface)] py-1 shadow-xl">
                  {(['bench', 'ir', 'taxi'] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-[11px] text-[var(--text)] hover:bg-white/[0.06]"
                      onClick={() => {
                        setMenuOpen(false)
                        onMove(a)
                      }}
                    >
                      {a === 'bench' ? 'Bench' : a === 'ir' ? 'IR' : 'Taxi'}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        )}
        {isTaxi && taxiYear ? (
          <span className="text-[11px] text-[var(--devy-amber)]">
            Year {taxiYear.current} of {taxiYear.max}
          </span>
        ) : null}
      </div>
    </div>
  )
}
