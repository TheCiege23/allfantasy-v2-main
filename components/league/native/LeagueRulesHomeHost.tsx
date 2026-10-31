'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { BookOpen, X } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import type { ChangeGroup } from '@/lib/league-rules-explainer/types'
import type { RulesExplainerView } from '@/lib/league-rules-explainer/view'
import './league-rules-home.css'

type ViewResponse = RulesExplainerView | { supported: false }

/** Another dialog is up (an intro video, the post-create sheet, settings): wait for it to close. */
function anotherModalOpen(own: HTMLElement | null): boolean {
  if (typeof document === 'undefined') return false
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))) {
    if (own && (el === own || own.contains(el))) continue
    if (el.getClientRects().length > 0) return true
  }
  return false
}

/** How often the first-time popup re-checks for a clear screen. */
const CLEAR_SCREEN_POLL_MS = 1000

function formatChangeDate(iso: string, lang: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
  } catch {
    return d.toISOString()
  }
}

/**
 * League home only: the "League rules" button, the first-time rules popup, and the "What changed"
 * card. Rendered by NativeLeagueHome, and by an imported league's League tab (`variant="classic"`, its
 * own styling) — never the draft room or a live game screen, which is the owner's rule ("never
 * interrupt"): the popup can only open while the league home is on screen.
 */
export function LeagueRulesHomeHost({
  leagueId,
  blocked = false,
  variant = 'native',
}: {
  leagueId: string
  blocked?: boolean
  /** `classic`: the imported-league shell, which has no `nl-*` styles. */
  variant?: 'native' | 'classic'
}) {
  // The app's i18n (`t` from LanguageProviderClient); English outside a provider.
  const { t, language } = useOptionalLanguage()
  const lang = language === 'es' ? 'es' : 'en'
  const [view, setView] = useState<RulesExplainerView | null>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const autoOpened = useRef(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    let cancelled = false
    autoOpened.current = false
    setView(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/rules-explainer`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<ViewResponse>) : null))
      .then((d) => {
        if (!cancelled && d && d.supported) setView(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leagueId])

  // First visit: open once the screen is clear of every other dialog.
  useEffect(() => {
    if (!view?.showRulesPopup || autoOpened.current || blocked) return
    const tryOpen = () => {
      if (autoOpened.current || anotherModalOpen(dialogRef.current)) return false
      autoOpened.current = true
      setOpen(true)
      return true
    }
    if (tryOpen()) return
    const timer = window.setInterval(() => {
      if (tryOpen()) window.clearInterval(timer)
    }, CLEAR_SCREEN_POLL_MS)
    return () => window.clearInterval(timer)
  }, [view?.showRulesPopup, blocked])

  const post = useCallback(
    (body: Record<string, unknown>) =>
      fetch(`/api/leagues/${encodeURIComponent(leagueId)}/rules-explainer`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null),
    [leagueId],
  )

  const close = useCallback(() => {
    setOpen(false)
    if (view?.showRulesPopup) {
      setView({ ...view, showRulesPopup: false })
      void post({ kind: 'rules' })
    }
  }, [view, post])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const dismissChanges = useCallback(() => {
    if (!view || view.pendingChanges.length === 0) return
    const newest = view.pendingChanges[0]!
    setView({ ...view, pendingChanges: [], history: [...view.pendingChanges, ...view.history] })
    void post({ kind: 'changes', eventId: newest.lastEventId })
  }, [view, post])

  if (!view) return null

  const commissionerFirst = view.isCommissioner && view.showRulesPopup
  const groupList = (groups: ChangeGroup[], testId: string) => (
    <ul className="space-y-3" data-testid={testId}>
      {groups.map((g) => (
        <li key={g.lastEventId}>
          <p className="nl-rules-modal-when text-[11px] font-semibold uppercase tracking-wide">
            {renderRuleText({ k: 'leagueRules.ui.changedOn', vars: { date: formatChangeDate(g.lastAt, lang) } }, t, lang)}
          </p>
          <ul className="mt-1 space-y-1">
            {g.lines.map((line) => (
              <li key={line.key} className="nl-rules-modal-change text-[13px] leading-snug">
                {renderChangeLine(line, t, lang)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      {!view.showRulesPopup && view.pendingChanges.length > 0 ? (
        <section className="nl-card" data-testid="league-rules-changes-card" aria-live="polite">
          <div className="nl-card-label">
            <span>{t('leagueRules.ui.whatChanged')}</span>
          </div>
          <p className="nl-rules-sub mb-3 text-[13px] text-white/70">{t('leagueRules.ui.whatChangedSubtitle')}</p>
          {groupList(view.pendingChanges, 'league-rules-pending')}
          <div className="nl-actions">
            <button type="button" className="nl-button nl-primary" onClick={dismissChanges} data-testid="league-rules-changes-dismiss">
              {t('leagueRules.ui.gotIt')}
            </button>
            <button type="button" className="nl-button" onClick={() => setOpen(true)}>
              {t('leagueRules.ui.open')}
            </button>
          </div>
        </section>
      ) : null}

      <div className="flex justify-end" ref={hostRef}>
        <button
          type="button"
          className={
            variant === 'classic'
              ? 'inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-[13px] font-semibold text-white/80 hover:bg-white/[0.08]'
              : 'nl-button'
          }
          onClick={() => setOpen(true)}
          data-testid="league-rules-open"
        >
          <BookOpen size={15} aria-hidden /> {t('leagueRules.ui.open')}
        </button>
      </div>

      {mounted && open
        ? createPortal(
            <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 px-4 pb-4 pt-10 sm:items-center" onClick={close}>
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                data-testid="league-rules-modal"
                className="nl-rules-modal flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="nl-rules-modal-head flex items-start justify-between gap-3 border-b px-5 py-4">
                  <div className="min-w-0">
                    <h2 id={titleId} className="text-[17px] font-bold">
                      {t(commissionerFirst ? 'leagueRules.ui.commissionerTitle' : 'leagueRules.ui.title')}
                    </h2>
                    <p className="nl-rules-modal-sub mt-0.5 text-[12px]">
                      {t(commissionerFirst ? 'leagueRules.ui.commissionerSubtitle' : 'leagueRules.ui.subtitle')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    aria-label={t('leagueRules.ui.close')}
                    className="nl-rules-modal-close inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    data-testid="league-rules-close"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                  {view.sections.map((section) => (
                    <section key={section.id} data-testid={`league-rules-section-${section.id}`}>
                      <h3 className="nl-rules-modal-h3 mb-1.5 text-[11px] font-bold uppercase tracking-wide">{renderRuleText(section.title, t, lang)}</h3>
                      <ul className="space-y-1.5">
                        {section.lines.map((line) => (
                          <li key={line.id} className="nl-rules-modal-line text-[13px] leading-snug">
                            {renderRuleText(line.text, t, lang)}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  <section data-testid="league-rules-history-section">
                    <h3 className="nl-rules-modal-h3 mb-1.5 text-[11px] font-bold uppercase tracking-wide">{t('leagueRules.ui.history')}</h3>
                    {view.history.length ? (
                      groupList(view.history, 'league-rules-history')
                    ) : (
                      <p className="nl-rules-modal-empty text-[13px]">{t('leagueRules.ui.historyEmpty')}</p>
                    )}
                  </section>
                </div>
                <div className="nl-rules-modal-foot space-y-2 border-t px-5 py-3">
                  {/* The chat route types the question in, scoped to this league, and never sends it by itself. */}
                  <Link
                    href={`/chimmy/chat?prompt=${encodeURIComponent(t('leagueRules.ui.chimmyPrompt'))}&leagueId=${encodeURIComponent(leagueId)}`}
                    onClick={close}
                    className="nl-rules-modal-chimmy block w-full rounded-xl px-4 py-2.5 text-center text-[14px] font-semibold"
                    data-testid="league-rules-ask-chimmy"
                  >
                    {t('leagueRules.ui.askChimmy')}
                  </Link>
                  <button
                    type="button"
                    onClick={close}
                    className="nl-rules-modal-gotit w-full rounded-xl px-4 py-2.5 text-[14px] font-bold"
                    data-testid="league-rules-got-it"
                  >
                    {t('leagueRules.ui.gotIt')}
                  </button>
                </div>
              </div>
            </div>,
            /*
             * Inside a native redraft league the popup portals into that league's workspace root, so it
             * inherits the redraft tokens and light mode (league-rules-home.css). Everywhere else it goes
             * to <body> as before, with the colours it always had.
             */
            (variant === 'native' ? hostRef.current?.closest<HTMLElement>('.nl-workspace[data-format=redraft]') : null) ?? document.body,
          )
        : null}
    </>
  )
}
