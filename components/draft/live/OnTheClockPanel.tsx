'use client'

import Image from 'next/image'
import type { CurrentOnTheClock, DraftSessionStatus } from '@/lib/live-draft-engine/types'
import type { DraftTeamStripTeamMeta } from '@/components/app/draft-room/DraftTeamStrip'

export type OnClockTeamSpotlight = Pick<
  DraftTeamStripTeamMeta,
  'teamName' | 'ownerName' | 'avatarUrl'
>

export function OnTheClockPanel({
  status,
  currentPick,
  spotlight,
}: {
  status: DraftSessionStatus
  currentPick: CurrentOnTheClock | null
  /** League chrome — larger identity card above the compact on-the-clock copy. */
  spotlight?: OnClockTeamSpotlight | null
}) {
  if (status === 'completed') {
    return (
      <div className="rounded-2xl border border-emerald-400/35 bg-gradient-to-br from-emerald-500/20 to-emerald-950/30 px-4 py-4 text-center shadow-[0_12px_40px_rgba(16,185,129,0.2)] ring-1 ring-emerald-400/20">
        <p className="text-sm font-bold tracking-tight text-emerald-100">Draft complete</p>
      </div>
    )
  }
  if (status === 'pre_draft') {
    return (
      <div
        data-testid="draft-on-the-clock"
        className="relative overflow-hidden rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-[#0c1528] via-[#0a1228] to-[#070d18] px-4 py-5 text-center shadow-[0_12px_40px_rgba(0,0,0,0.35)] ring-1 ring-cyan-400/15 sm:px-5 sm:py-6"
      >
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-400/10 blur-2xl"
          aria-hidden
        />
        <div className="relative flex flex-col items-center gap-4">
          <div className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-2xl border-2 border-cyan-400/30 bg-black/35 p-1 shadow-inner ring-2 ring-cyan-300/10 sm:h-[120px] sm:w-[120px]">
            <span className="text-3xl font-black tabular-nums text-cyan-100/80 drop-shadow-md sm:text-4xl">—</span>
          </div>
          <div className="w-full space-y-1">
            <p className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-200/80">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300/70" />
              </span>
              Pre-draft
            </p>
            <p className="mt-1 text-base font-semibold leading-snug text-white/90 sm:text-lg">
              Board is ready — same layout when the draft starts.
            </p>
            <p className="mt-1 text-[11px] font-medium text-white/50">Waiting for the commissioner to start…</p>
          </div>
        </div>
      </div>
    )
  }

  if (!currentPick) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 to-[#0a1228]/90 px-4 py-4 text-center text-sm font-medium text-amber-100/90 shadow-[0_8px_28px_rgba(245,158,11,0.12)]">
        {status === 'in_progress'
          ? 'Syncing current pick…'
          : 'Waiting for the board…'}
      </div>
    )
  }

  const title = spotlight?.teamName?.trim() || spotlight?.ownerName?.trim() || currentPick.displayName
  const ownerLine =
    spotlight?.teamName?.trim() && spotlight?.ownerName?.trim()
      ? spotlight.ownerName.trim()
      : null

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/[0.18] via-[#121a2e] to-[#0a1228] px-4 py-5 text-center shadow-[0_0_40px_rgba(251,191,36,0.22),0_16px_48px_rgba(0,0,0,0.4)] ring-1 ring-amber-400/25 sm:px-5 sm:py-6"
      data-testid="draft-on-the-clock"
    >
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-amber-400/10 blur-2xl"
        aria-hidden
      />
      <div className="relative flex flex-col items-center gap-4">
        <div className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-2xl border-2 border-amber-400/35 bg-black/35 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-2 ring-amber-300/15 sm:h-[120px] sm:w-[120px]">
          {spotlight?.avatarUrl ? (
            <Image
              src={spotlight.avatarUrl}
              alt=""
              width={112}
              height={112}
              className="h-full w-full rounded-xl object-cover"
              unoptimized
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <span className="text-4xl font-black tabular-nums text-amber-100/90 drop-shadow-md sm:text-5xl">
              {title.trim().slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <div className="w-full space-y-1">
          <p className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-amber-200/90">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300/50 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.9)]" />
            </span>
            On the clock
          </p>
          <p className="mt-1 line-clamp-2 text-xl font-extrabold tracking-tight text-white drop-shadow-sm sm:text-2xl">
            {title}
          </p>
          {ownerLine ? (
            <p className="mt-1 text-sm font-medium text-white/75">{ownerLine}</p>
          ) : null}
          <p className="mt-1 font-mono text-sm font-semibold text-cyan-200/95">{currentPick.pickLabel}</p>
        </div>
      </div>
    </div>
  )
}
