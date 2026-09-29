'use client'

import clsx from 'clsx'
import { Crown, EyeOff, Sparkles } from 'lucide-react'

export function ZombieWhispererCard({
  revealed,
  displayName,
  ambushesRemaining,
  hordeSize,
}: {
  revealed: boolean
  displayName?: string | null
  ambushesRemaining: number
  hordeSize: number
}) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-2xl border p-4 sm:p-5',
        'border-fuchsia-500/35 bg-gradient-to-br from-fuchsia-950/50 via-[#140818]/90 to-black/80',
        'shadow-[inset_0_1px_0_rgba(232,121,249,0.15),0_12px_40px_rgba(0,0,0,0.45)]',
      )}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-fuchsia-500/15 blur-2xl"
        aria-hidden
      />
      <div className="relative flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-fuchsia-400/35 bg-black/40 shadow-[0_0_18px_rgba(217,70,239,0.25)]">
          <Crown className="h-5 w-5 text-fuchsia-200" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-fuchsia-200/90">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Whisperer
          </p>
          {revealed ? (
            <>
              <p className="mt-2 truncate text-lg font-black tracking-tight text-white">{displayName ?? 'Unknown'}</p>
              <p className="mt-2 text-[13px] leading-snug text-white/65">
                Ambushes remaining: <span className="font-semibold text-fuchsia-100">{ambushesRemaining}</span>
                <span className="text-white/40"> · </span>
                Horde command: <span className="font-semibold text-lime-200/90">{hordeSize}</span>
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-white/72">
                <EyeOff className="h-4 w-4 text-white/45" aria-hidden />
                Identity classified — a Whisperer walks among you.
              </p>
              <p className="mt-2 text-[12px] text-white/45">Watch matchups, items, and league chat for tells.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
