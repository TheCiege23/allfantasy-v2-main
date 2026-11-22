'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { RoundOneAnnouncementQueueItem } from '@/lib/draft-room/resolvePickAnnouncementAssets'
import { FallbackImg } from '@/components/core-app/FallbackImg'
import { roundOneHypeLine } from '@/lib/draft-room/roundOneHypeLine'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { teamAccentColor } from '@/lib/draft-room/teamAccentColor'
import './round-one-card.css'

type RoundOneAnnouncementItem = RoundOneAnnouncementQueueItem

const AUTO_DISMISS_MS = 6200
/**
 * Set this to a valid subtle stinger file when one is added to public assets.
 * Leaving null keeps the code path safe and silent.
 */
const ROUND_ONE_SOUND_SRC: string | null = null

type DraftRoundOneAnnouncementOverlayProps = {
  presentationVariant?: 'default' | 'redraft_snake'
  leagueName?: string
  sportLabel?: string
  /** League format (e.g. 'survivor'): the island gets its own line under the pick. */
  formatType?: string | null
  /** Queue: first item is visible */
  queue: RoundOneAnnouncementItem[]
  onDismissFront: () => void
  /** Dynasty rooms: vault ground and trophy-gold accents instead of the default violet. */
  dynastySkin?: boolean
  /**
   * `modal` (live rooms): the dimmed full-screen card. `toast` (the mock room, 2026-11): a compact
   * card that taps pass around. CPU managers pick a mock's round 1 seconds apart, and a modal per
   * pick would take the board and the pool away from the one person drafting.
   */
  variant?: 'modal' | 'toast'
}

export function DraftRoundOneAnnouncementOverlay({
  presentationVariant = 'default',
  leagueName,
  sportLabel,
  formatType,
  queue,
  onDismissFront,
  dynastySkin = false,
  variant = 'modal',
}: DraftRoundOneAnnouncementOverlayProps) {
  const toast = variant === 'toast'
  const rs = presentationVariant === 'redraft_snake'
  const dyn = dynastySkin && !rs
  const current = queue[0]
  const [entered, setEntered] = useState(false)
  const { t: tl, tInterpolate } = useOptionalLanguage()

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
  /* Phase 6 (2026-11-19): the card is animated in round-one-card.css — slide in, team-colour sweep,
     headshot scale-in then a slow breathe, letter-by-letter name, pick-number stamp. Reduced motion
     shows it all at once. */
  const teamColor = teamAccentColor(pick.team, sportLabel)
  const mgr = pick.displayName ?? tl('draftRoom.roundOne.draftBoard')
  const subtitle = `${sportLabel ? `${sportLabel} · ` : ''}${tInterpolate('draftRoom.roundOne.subtitle', { slot: pick.slot, overall: pick.overall })}`
  const hypeLine = roundOneHypeLine({ sport: sportLabel, position: pick.position, formatType }, tl)
  const chips = [
    tInterpolate('draftRoom.roundOne.chipPick', { label: pick.pickLabel }),
    tInterpolate('draftRoom.roundOne.chipOverall', { overall: pick.overall }),
    pick.byeWeek != null ? tInterpolate('draftRoom.roundOne.chipBye', { week: pick.byeWeek }) : null,
    pick.amount != null ? `$${pick.amount}` : null,
  ].filter((v): v is string => Boolean(v))

  return (
    <div
      className={`${
        toast
          ? 'pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+7.5rem)] z-[95] flex justify-center px-3 md:inset-x-auto md:bottom-auto md:right-5 md:top-36 md:justify-end md:px-0'
          : 'fixed inset-0 z-[95] flex items-center justify-center bg-black/55 px-3 backdrop-blur-[2px]'
      } ${
        entered ? 'opacity-100' : 'opacity-0'
      } transition-opacity duration-300 ease-out motion-reduce:opacity-100 motion-reduce:transition-none`}
      role={toast ? 'status' : 'dialog'}
      aria-modal={toast ? undefined : 'true'}
      aria-live={toast ? 'polite' : undefined}
      aria-label={tl('draftRoom.roundOne.dialogAria')}
      data-testid="draft-round-one-announcement"
      data-variant={variant}
      data-dynasty-skin={dyn ? 'true' : undefined}
      onClick={toast ? undefined : onDismissFront}
    >
      <div
        className={`af-r1-card pointer-events-auto relative overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.07] backdrop-blur-md ${
          toast ? 'w-[min(96vw,520px)]' : 'w-[min(96vw,680px)]'
        }`}
        style={{ ['--af-r1-team' as string]: teamColor }}
        data-team-color={teamColor}
        data-testid="draft-round-one-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={`absolute inset-0 ${
            rs
              ? 'bg-[linear-gradient(135deg,rgba(8,47,73,0.94),rgba(15,23,42,0.96))]'
              : dyn
                ? 'bg-[linear-gradient(135deg,var(--dyn-vault,#121826),var(--dyn-ink,#0B0F17))]'
                : 'bg-[linear-gradient(135deg,rgba(13,24,41,0.94),rgba(7,15,28,0.96))]'
          }`}
        />
        <div className="af-r1-sweep" aria-hidden data-testid="draft-round-one-sweep" />
        <div className="af-r1-shine" aria-hidden />
        <div
          className={`pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl ${
            rs ? 'bg-cyan-400/25' : dyn ? 'bg-[rgba(212,162,76,0.22)]' : 'bg-violet-500/20'
          }`}
        />
        <div className={`relative flex gap-4 ${toast ? 'flex-row items-start p-3' : 'flex-col p-4 sm:flex-row sm:items-start'}`}>
          <div
            className={`af-r1-headshot-frame relative shrink-0 overflow-hidden rounded-xl border border-white/15 bg-black/40 shadow-inner ${
              toast ? 'h-[72px] w-[72px]' : 'h-[96px] w-[96px] sm:h-[110px] sm:w-[110px]'
            }`}
          >
            <div className="af-r1-headshot h-full w-full">
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
            </div>
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
                <Sparkles className={`h-4 w-4 shrink-0 ${rs ? 'text-cyan-300' : dyn ? 'text-[var(--dyn-gold,#D4A24C)]' : 'text-violet-300'}`} />
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">{tl('draftRoom.roundOne.selection')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onDismissFront}
                  className="rounded-lg border border-cyan-300/30 bg-cyan-500/12 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan-100 transition hover:bg-cyan-500/22"
                  aria-label={tl('draftRoom.roundOne.skipAria')}
                  data-testid="draft-round-one-announcement-skip"
                >
                  {tl('draftRoom.roundOne.skip')}
                </button>
                <button
                  type="button"
                  onClick={onDismissFront}
                  className="rounded-lg border border-white/10 bg-black/30 p-1.5 text-white/55 transition hover:bg-white/10 hover:text-white"
                  aria-label={tl('draftRoom.roundOne.dismissAria')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <p className="min-w-0 truncate text-xl font-bold tracking-tight text-white" data-testid="draft-round-one-player">
                <span className="sr-only">{pick.playerName}</span>
                <span aria-hidden>
                  {Array.from(pick.playerName).map((ch, i) => (
                    <span key={i} className="af-r1-letter" style={{ ['--i' as string]: i }}>
                      {ch}
                    </span>
                  ))}
                </span>
              </p>
              {pick.pickLabel ? (
                <span
                  className="af-r1-stamp shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[13px] font-extrabold tabular-nums text-white"
                  data-testid="draft-round-one-stamp"
                >
                  {pick.pickLabel}
                </span>
              ) : null}
            </div>
            <p className="af-r1-rise mt-0.5 text-[13px] font-medium text-white/55">
              {pick.position}
              {pick.team ? ` · ${pick.team}` : ''}
            </p>
            <div className={`af-r1-rise mt-2 flex flex-wrap gap-1.5 ${toast ? 'max-sm:hidden' : ''}`}>
              {chips.slice(0, 4).map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[11px] font-semibold text-white/80"
                >
                  {chip}
                </span>
              ))}
            </div>
            <p className="af-r1-rise mt-2 text-[12px] leading-snug text-white/70">
              <span className="font-semibold text-cyan-100/95">{mgr}</span>
              <span className="text-white/40"> · </span>
              <span className="text-white/55">{subtitle}</span>
            </p>
            {toast ? null : <p className="mt-1 text-[12px] text-cyan-100/75">{hypeLine}</p>}
            {leagueName && !toast ? (
              <p className="mt-1 truncate text-[11px] font-medium uppercase tracking-wide text-white/35">{leagueName}</p>
            ) : null}
          </div>
        </div>

        {queue.length > 1 ? (
          <div className="border-t border-white/[0.06] bg-black/35 px-4 py-2 text-center text-[11px] font-medium text-white/40">
            {tInterpolate(queue.length > 2 ? 'draftRoom.roundOne.queuedMany' : 'draftRoom.roundOne.queuedOne', { count: queue.length - 1 })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
