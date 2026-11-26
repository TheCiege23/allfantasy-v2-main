'use client'

import { useEffect, useId, useRef } from 'react'
import { PartyPopper, X } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { LeagueInviteShare } from '@/components/league/invite/LeagueInviteShare'
import { ClubhousePromoCard } from '@/components/community/ClubhousePromoCard'

type Translate = (key: string) => string

function tx(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

export type PostCreateWelcomeLeague = {
  id: string
  name: string
  sport: string
  formatLabel: string
  teamCount: number
  claimedSeats: number
  scoringLabel: string | null
  /** NFL TE premium, extra points per TE catch. */
  tePremiumPoints: number | null
  draftDateIso: string | null
  timezone: string | null
  privacy: 'public' | 'private' | null
}

/** "Sun, Nov 8, 8:00 PM CST" in the league's own timezone; falls back to the device zone. */
export function formatWelcomeDraftDate(iso: string | null, timezone: string | null, locale?: string): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }
  try {
    return new Intl.DateTimeFormat(locale, { ...options, ...(timezone ? { timeZone: timezone } : {}) }).format(date)
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date)
  }
}

/**
 * "Your league is ready": just the invite (QR, share sheet, text, WhatsApp, copy) and a way out.
 * Shown once, right after the intro. Kept deliberately small (owner, 2026-11-25: "it seems like a
 * lot at once"); the league's settings are on the Draft tab, Find a League listing in Settings.
 * `onOpenSettings` stays in the props so callers don't change; the sheet no longer links there.
 */
export function PostCreateWelcomeSheet({
  league,
  inviteUrl,
  onClose,
}: {
  league: PostCreateWelcomeLeague
  inviteUrl: string
  onClose: () => void
  onOpenSettings: (panel: string | null) => void
}) {
  const { t } = useLanguage()
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const previous = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      // Keep Tab inside the sheet while it is open.
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [onClose])

  const openSeats = Math.max(0, league.teamCount - league.claimedSeats)
  const inviteLine =
    openSeats > 0
      ? tx(t, 'league.welcome.inviteMore', 'Invite {{count}} more managers to fill the league.').replace('{{count}}', String(openSeats))
      : tx(t, 'league.welcome.full', 'Every seat is filled.')

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(2,6,23,0.72)] backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      data-testid="post-create-welcome"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-primary)] shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[color:var(--border-subtle)] px-5 pb-4 pt-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">
              <PartyPopper className="h-4 w-4" aria-hidden />
              {tx(t, 'league.welcome.eyebrow', 'League created')}
            </p>
            <h2 id={titleId} className="mt-1 break-words text-xl font-black leading-tight">
              {tx(t, 'league.welcome.title', '{{name}} is ready').replace('{{name}}', league.name)}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={tx(t, 'league.welcome.close', 'Close')}
            className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-secondary)]"
            data-testid="post-create-welcome-close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* One job only: get the invite out. League details live on the Draft tab, listing in Settings. */}
        <div className="space-y-4 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <p className="text-sm text-[color:var(--text-secondary)]" data-testid="post-create-welcome-invite-line">
            {inviteLine}
          </p>
          <LeagueInviteShare url={inviteUrl} leagueName={league.name} testIdPrefix="post-create-invite" />
          <ClubhousePromoCard variant="league-created" className="rounded-xl border border-[color:var(--border)] p-4" />
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 w-full touch-manipulation items-center justify-center rounded-xl px-4 text-sm font-black text-[color:var(--text-secondary)]"
            data-testid="post-create-welcome-done"
          >
            {tx(t, 'league.welcome.later', 'Later — go to my league')}
          </button>
        </div>
      </div>
    </div>
  )
}
