'use client'

import { cn } from '@/lib/utils'
import type { DraftPickRecord } from '../types'
import { TradedPickBadge } from './TradedPickBadge'
import { managerColorForIndex } from './manager-colors'

type PickCellProps = {
  pickLabel: string
  pick?: DraftPickRecord | null
  managerIndex: number
  isCurrentPick: boolean
  isTraded?: boolean
}

export function PickCell({ pickLabel, pick, managerIndex, isCurrentPick, isTraded }: PickCellProps) {
  const isPicked = Boolean(pick?.playerName)
  const mgr = managerColorForIndex(managerIndex)

  // Commit W.3 — board cell chrome upgrade. The cell now reads as a real
  // draft card: pill-shaped pick-number badge in the top-left, a manager
  // color stripe along the left edge for filled picks, a polished open-
  // pick state with a dashed border (Sleeper-style "slot ready" cue),
  // and a stronger on-the-clock highlight that includes a small "ON THE
  // CLOCK" tag in addition to the existing cyan ring + pulse.
  return (
    <div
      data-testid="legacy-draft-board-cell"
      data-state={isPicked ? 'filled' : isCurrentPick ? 'current' : 'open'}
      data-current={isCurrentPick ? 'true' : 'false'}
      data-manager-index={managerIndex}
      className={cn(
        'relative min-h-[64px] overflow-hidden rounded-xl border p-1.5 pl-2.5 text-xs shadow-inner shadow-black/25 transition-colors duration-200',
        // On-the-clock — strongest visual state (pulse + ring + glow)
        isCurrentPick &&
          'animate-pulse border-cyan-400/40 bg-cyan-500/[0.07] ring-2 ring-cyan-400/60 shadow-[0_0_22px_-6px_rgba(34,211,238,0.55)]',
        // Traded pick gets an amber ring on top of normal styling
        !isCurrentPick && isTraded && 'ring-1 ring-amber-400/80',
        // Filled pick — solid border + manager-colored background tint
        isPicked && !isCurrentPick && 'border-white/15',
        isPicked && mgr.bg,
        // Open pick — dashed border (Sleeper-style empty slot cue), faint
        // background gradient, hover lifts to a clearer outline
        !isPicked && !isCurrentPick &&
          'border border-dashed border-white/[0.10] bg-gradient-to-br from-white/[0.04] to-transparent hover:border-white/20 hover:bg-white/[0.06]',
      )}
      title={pick ? `${pick.playerName ?? ''} · ${pick.timestamp}` : pickLabel}
    >
      {/* Manager color stripe (left edge) — only on filled picks. Adds a
       *  Sleeper-style "team color" cue without overpowering the cell.
       *  Hidden on open / current picks so they read as empty slots. */}
      {isPicked && !isCurrentPick ? (
        <span
          aria-hidden
          data-testid="legacy-draft-board-cell-stripe"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-xl',
            mgr.bg,
          )}
        />
      ) : null}
      {/* Pick-number badge — small pill in top-left so the user can scan
       *  pick numbers down a column without mistaking them for player
       *  metadata. */}
      <span
        data-testid="legacy-draft-board-pick-number"
        className="inline-flex items-center rounded-md bg-black/30 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white/60 ring-1 ring-white/[0.06]"
      >
        {pickLabel}
      </span>
      {isPicked ? (
        <div className={cn('mt-1 truncate font-medium', mgr.text)}>
          <div
            data-testid="legacy-draft-board-player-name"
            className="truncate text-[11px] leading-tight"
          >
            {pick!.playerName}
          </div>
          <div
            data-testid="legacy-draft-board-player-meta"
            className="mt-0.5 flex items-center gap-1 text-[11px] text-white/55"
          >
            {pick!.position ? (
              <span className="rounded bg-black/30 px-1 py-px font-semibold uppercase tracking-wider text-white/75 ring-1 ring-white/[0.06]">
                {pick!.position}
              </span>
            ) : null}
            {pick!.team ? <span className="font-semibold text-white/70">{pick!.team}</span> : null}
          </div>
        </div>
      ) : isCurrentPick ? (
        <div className="mt-1 flex flex-col gap-0.5">
          <span
            data-testid="legacy-draft-board-on-the-clock-label"
            className="self-start rounded bg-cyan-500/20 px-1 py-px text-[11px] font-bold uppercase tracking-widest text-cyan-100 ring-1 ring-cyan-400/40"
          >
            On the clock
          </span>
          <span
            data-testid="legacy-draft-board-open-label"
            className="text-[11px] font-semibold uppercase tracking-widest text-cyan-200/70"
          >
            Pick {pickLabel}
          </span>
        </div>
      ) : (
        <div
          data-testid="legacy-draft-board-open-label"
          className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-white/35"
        >
          Open
        </div>
      )}
      {isTraded ? <TradedPickBadge /> : null}
    </div>
  )
}
