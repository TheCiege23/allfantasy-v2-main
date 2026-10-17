'use client'

import { useEffect, useId, useRef } from 'react'
import { ArrowRight, CalendarClock, PartyPopper, Settings2, X } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { LeagueInviteShare } from '@/components/league/invite/LeagueInviteShare'

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
 * "Your league is ready": what was created, the invite (QR, share sheet, text, WhatsApp, copy),
 * and the next step. Shown once, right after the intro, by the post-create welcome flow.
 */
export function PostCreateWelcomeSheet({
  league,
  inviteUrl,
  onClose,
  onOpenSettings,
}: {
  league: PostCreateWelcomeLeague
  inviteUrl: string
  onClose: () => void
  onOpenSettings: (panel: string | null) => void
}) {
  const { t, language } = useLanguage()
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

  const draftLabel = formatWelcomeDraftDate(league.draftDateIso, league.timezone, language === 'es' ? 'es' : undefined)
  const scoring = [
    league.scoringLabel,
    typeof league.tePremiumPoints === 'number'
      ? tx(t, 'league.welcome.tep', 'TE premium +{{points}} per catch').replace('{{points}}', String(league.tePremiumPoints))
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const rows: Array<[string, string]> = [
    [tx(t, 'league.welcome.format', 'Format'), `${league.sport} · ${league.formatLabel}`],
    [
      tx(t, 'league.welcome.managers', 'Managers'),
      tx(t, 'league.invite.joined', '{{filled}} of {{total}} managers joined')
        .replace('{{filled}}', String(league.claimedSeats))
        .replace('{{total}}', String(league.teamCount)),
    ],
    ...(scoring ? ([[tx(t, 'league.welcome.scoring', 'Scoring'), scoring]] as Array<[string, string]>) : []),
    [tx(t, 'league.welcome.draft', 'Draft'), draftLabel ?? tx(t, 'league.welcome.draftLater', 'Not scheduled yet')],
    ...(league.privacy
      ? ([
          [
            tx(t, 'league.welcome.privacy', 'Privacy'),
            league.privacy === 'public'
              ? tx(t, 'league.welcome.public', 'Public')
              : tx(t, 'league.welcome.private', 'Private (invite only)'),
          ],
        ] as Array<[string, string]>)
      : []),
  ]

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

        <div className="space-y-5 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <dl className="divide-y divide-[color:var(--border-subtle)] rounded-2xl border border-[color:var(--border-subtle)]" data-testid="post-create-welcome-info">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="shrink-0 font-semibold text-[color:var(--text-secondary)]">{label}</dt>
                <dd className="min-w-0 text-right font-bold">{value}</dd>
              </div>
            ))}
          </dl>

          <section aria-label={tx(t, 'league.welcome.inviteHeading', 'Invite your managers')}>
            <h3 className="mb-1 text-base font-black">{tx(t, 'league.welcome.inviteHeading', 'Invite your managers')}</h3>
            <p className="mb-3 text-sm text-[color:var(--text-secondary)]">
              {tx(t, 'league.welcome.inviteBody', 'Send the link however your group chats. Managers join your league from it.')}
            </p>
            <LeagueInviteShare url={inviteUrl} leagueName={league.name} testIdPrefix="post-create-invite" />
          </section>

          <section className="space-y-2" aria-label={tx(t, 'league.welcome.nextHeading', 'Next steps')}>
            <h3 className="text-base font-black">{tx(t, 'league.welcome.nextHeading', 'Next steps')}</h3>
            {!draftLabel ? (
              <button
                type="button"
                onClick={() => onOpenSettings('draft')}
                className="flex min-h-12 w-full touch-manipulation items-center justify-between gap-3 rounded-xl bg-violet-600 px-4 text-left text-sm font-black text-[#ffffff]"
                data-testid="post-create-welcome-set-draft"
              >
                <span className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4" aria-hidden />
                  {tx(t, 'league.welcome.setDraft', 'Set the draft time')}
                </span>
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenSettings(null)}
              className="flex min-h-12 w-full touch-manipulation items-center justify-between gap-3 rounded-xl border border-[color:var(--border-subtle)] px-4 text-left text-sm font-bold"
              data-testid="post-create-welcome-settings"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" aria-hidden />
                {tx(t, 'league.welcome.reviewSettings', 'Review league settings')}
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`flex min-h-12 w-full touch-manipulation items-center justify-center rounded-xl px-4 text-sm font-black ${
                draftLabel ? 'bg-violet-600 text-[#ffffff]' : 'text-[color:var(--text-secondary)]'
              }`}
              data-testid="post-create-welcome-done"
            >
              {tx(t, 'league.welcome.goToLeague', 'Go to my league')}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
