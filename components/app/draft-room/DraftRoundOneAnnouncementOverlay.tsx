'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { RoundOneAnnouncementQueueItem } from '@/lib/draft-room/resolvePickAnnouncementAssets'
import { FallbackImg } from '@/components/core-app/FallbackImg'

export type RoundOneAnnouncementItem = RoundOneAnnouncementQueueItem

const AUTO_DISMISS_MS = 6200
/**
 * Set this to a valid subtle stinger file when one is added to public assets.
 * Leaving null keeps the code path safe and silent.
 */
const ROUND_ONE_SOUND_SRC: string | null = null

export type DraftRoundOneAnnouncementOverlayProps = {
  presentationVariant?: 'default' | 'redraft_snake'
  leagueName?: string
  sportLabel?: string
  /** Queue: first item is visible */
  queue: RoundOneAnnouncementItem[]
  onDismissFront: () => void
}

export function DraftRoundOneAnnouncementOverlay({
  presentationVariant = 'default',
  leagueName,
  sportLabel,
  queue,
  onDismissFront,
}: DraftRoundOneAnnouncementOverlayProps) {
  const rs = presentationVariant === 'redraft_snake'
  const current = queue[0]
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!current || current.pick.round === 1) return
    onDismissFront()
  }, [current?.id, current?.pick.round, onDismissFront])

  useEffect(() => {
    if (!current) return
    setEntered(false)
    const id = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(id)
  }, [current?.id])

  useEffect(() => {
    if (!current) return
    const t = window.setTimeout(() => onDismissFront(), AUTO_DISMISS_MS)
    return () => window.clearTimeout(t)
  }, [current?.id, onDismissFront])

  useEffect(() => {
    if (!current) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismissFront()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current?.id, onDismissFront])

  useEffect(() => {
    if (!current || !ROUND_ONE_SOUND_SRC) return
    try {
      const audio = new Audio(ROUND_ONE_SOUND_SRC)
      audio.volume = 0.18
      void audio.play().catch(() => {})
    } catch {
      // Silent fallback by design.
    }
  }, [current?.id])

  if (!current || current.pick.round !== 1) return null

  const { pick, headshotUrl, teamLogoUrl } = current
  const mgr = pick.displayName ?? 'Draft board'
  const subtitle = `${sportLabel ? `${sportLabel} · ` : ''}Round 1 · Pick ${pick.slot} · #${pick.overall} overall`
  const hypeLine = (() => {
    const pos = String(pick.position ?? '').toUpperCase()
    if (pos === 'QB') return 'Commanding the board early with a field general.'
    if (pos === 'RB') return 'Ground game priority set for the draft room.'
    if (pos === 'WR') return 'A high-upside target just came off the board.'
    if (pos === 'TE') return 'Securing a mismatch creator in Round 1.'
    return 'Opening statement pick locked in.'
  })()
  const chips = [
    `Pick ${pick.pickLabel}`,
    `Overall #${pick.overall}`,
    pick.byeWeek != null ? `Bye ${pick.byeWeek}` : null,
    pick.amount != null ? `$${pick.amount}` : null,
  ].filter((v): v is string => Boolean(v))

  return (
    <div
      className={`fixed inset-0 z-[95] flex items-center justify-center bg-black/55 px-3 backdrop-blur-[2px] ${
        entered ? 'opacity-100' : 'opacity-0'
      } transition-opacity duration-300 ease-out`}
      role="dialog"
      aria-modal="true"
      aria-label="Round one pick announcement"
      data-testid="draft-round-one-announcement"
      onClick={onDismissFront}
    >
      <div
        className="pointer-events-auto relative w-[min(96vw,680px)] overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.07] backdrop-blur-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={`absolute inset-0 ${
            rs
              ? 'bg-[linear-gradient(135deg,rgba(8,47,73,0.94),rgba(15,23,42,0.96))]'
              : 'bg-[linear-gradient(135deg,rgba(13,24,41,0.94),rgba(7,15,28,0.96))]'
          }`}
        />
        <div
          className={`pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl ${
            rs ? 'bg-cyan-400/25' : 'bg-violet-500/20'
          }`}
        />
        <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <div className="relative h-[96px] w-[96px] shrink-0 overflow-hidden rounded-xl border border-white/15 bg-black/40 shadow-inner sm:h-[110px] sm:w-[110px]">
            {headshotUrl ? (
              <FallbackImg
                src={headshotUrl}
                alt=""
                className="h-full w-full object-cover object-top"
                fallback={
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/10 to-black/40 text-2xl font-black text-white/35">
                    {pick.playerName.slice(0, 1)}
                  </div>
                }
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/10 to-black/40 text-2xl font-black text-white/35">
                {pick.playerName.slice(0, 1)}
              </div>
            )}
            {teamLogoUrl ? (
              <div className="absolute bottom-1 right-1 h-8 w-8 overflow-hidden rounded-md border border-white/20 bg-black/60 p-0.5 shadow-lg">
                <FallbackImg src={teamLogoUrl} alt="" className="h-full w-full object-contain" fallback={null} />
              </div>
            ) : pick.team ? (
              <div className="absolute bottom-1 right-1 rounded-md border border-white/15 bg-black/55 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white/80">
                {pick.team}
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className={`h-4 w-4 shrink-0 ${rs ? 'text-cyan-300' : 'text-violet-300'}`} />
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">Round 1 selection</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onDismissFront}
                  className="rounded-lg border border-cyan-300/30 bg-cyan-500/12 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan-100 transition hover:bg-cyan-500/22"
                  aria-label="Skip announcement"
                  data-testid="draft-round-one-announcement-skip"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={onDismissFront}
                  className="rounded-lg border border-white/10 bg-black/30 p-1.5 text-white/55 transition hover:bg-white/10 hover:text-white"
                  aria-label="Dismiss announcement"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="mt-1 truncate text-xl font-bold tracking-tight text-white">{pick.playerName}</p>
            <p className="mt-0.5 text-[13px] font-medium text-white/55">
              {pick.position}
              {pick.team ? ` · ${pick.team}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.slice(0, 4).map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[11px] font-semibold text-white/80"
                >
                  {chip}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-snug text-white/70">
              <span className="font-semibold text-cyan-100/95">{mgr}</span>
              <span className="text-white/40"> · </span>
              <span className="text-white/55">{subtitle}</span>
            </p>
            <p className="mt-1 text-[12px] text-cyan-100/75">{hypeLine}</p>
            {leagueName ? (
              <p className="mt-1 truncate text-[11px] font-medium uppercase tracking-wide text-white/35">{leagueName}</p>
            ) : null}
          </div>
        </div>

        {queue.length > 1 ? (
          <div className="border-t border-white/[0.06] bg-black/35 px-4 py-2 text-center text-[11px] font-medium text-white/40">
            +{queue.length - 1} more Round 1 pick{queue.length > 2 ? 's' : ''} queued
          </div>
        ) : null}
      </div>
    </div>
  )
}
