'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { RulesSheetView } from '@/lib/league-rules/rulesSheetService'

/**
 * The league rules sheet (lib/league-rules/rulesSheet.ts): every rule the commissioner has set and
 * what it means, read fresh each time it opens so it always shows the league as it plays now.
 * Opens from the Rules button in the league header, and once by itself for a manager new to the
 * league (lib/league-rules/rulesSheetSeen.ts). Strings: rules.sheet.* (EN/ES).
 */
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; view: RulesSheetView }

export function useRulesSheet(leagueId: string, open: boolean, lang: 'en' | 'es') {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open || !leagueId) return
    let live = true
    setLoad({ state: 'loading' })
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/rules-sheet?lang=${lang}`, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as RulesSheetView | null
        if (!live) return
        setLoad(res.ok && body && Array.isArray(body.sections) ? { state: 'ready', view: body } : { state: 'error' })
      })
      .catch(() => live && setLoad({ state: 'error' }))
    return () => {
      live = false
    }
  }, [leagueId, open, lang, attempt])
  return { load, retry: useCallback(() => setAttempt((a) => a + 1), []) }
}

export function LeagueRulesSheet({
  leagueId,
  open,
  onClose,
  isCommissioner = false,
}: {
  leagueId: string
  open: boolean
  onClose: () => void
  isCommissioner?: boolean
}) {
  const { language, t, tInterpolate } = useOptionalLanguage()
  const lang = language === 'es' ? 'es' : 'en'
  const { load, retry } = useRulesSheet(leagueId, open, lang)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // The chat route types the question in, scoped to this league, and never sends it by itself.
  const chimmyHref = `/chimmy/chat?prompt=${encodeURIComponent(t('rules.sheet.chimmyPrompt'))}&leagueId=${encodeURIComponent(leagueId)}`

  return (
    <div
      className="fixed inset-0 z-[90] overflow-y-auto overscroll-contain bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="league-rules-sheet-title"
      data-testid="league-rules-sheet"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="relative w-full max-w-lg rounded-t-2xl border border-white/[0.1] bg-[#0a1228] text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)] sm:rounded-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] px-4 py-4 sm:px-5">
            <div>
              <h2 id="league-rules-sheet-title" className="text-[17px] font-bold">
                {t('rules.sheet.title')}
              </h2>
              <p className="mt-0.5 text-[12px] text-white/55">{t('rules.sheet.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('rules.sheet.close')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] text-white/60 hover:text-white"
              data-testid="league-rules-sheet-close"
            >
              <X className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-4 py-3 sm:px-5">
            {load.state === 'loading' ? (
              <p role="status" className="py-6 text-center text-[13px] text-white/55">
                {t('rules.sheet.loading')}
              </p>
            ) : load.state === 'error' ? (
              <div role="alert" className="py-6 text-center text-[13px] text-white/70">
                <p>{t('rules.sheet.error')}</p>
                <button type="button" onClick={retry} className="mt-3 rounded-lg border border-white/20 px-4 py-2 text-[13px]" data-testid="league-rules-sheet-retry">
                  {t('rules.sheet.retry')}
                </button>
              </div>
            ) : (
              <>
                {isCommissioner ? (
                  <p className="mb-3 rounded-lg border border-[#ff3d81]/25 bg-[#ff3d81]/[0.07] px-3 py-2 text-[12px] text-white/75" data-testid="league-rules-sheet-commissioner-hint">
                    {t('rules.sheet.commissionerHint')}
                  </p>
                ) : null}
                {load.view.platform ? (
                  <p className="mb-3 text-[12px] text-white/60" data-testid="league-rules-sheet-imported">
                    {tInterpolate('rules.sheet.imported', { platform: load.view.platform })}
                  </p>
                ) : null}
                {load.view.sections.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-white/55">{t('rules.sheet.empty')}</p>
                ) : (
                  load.view.sections.map((section) => (
                    <section key={section.id} className="py-2" data-testid={`league-rules-section-${section.id}`}>
                      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/45">{section.title}</h3>
                      <ul>
                        {section.rules.map((rule, i) => (
                          <li key={`${rule.id}-${i}`} className="border-b border-white/[0.05] py-2.5 last:border-0" data-testid="league-rule">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                              <span className="text-[12px] text-white/55">{rule.label}</span>
                              <span className="text-[13px] font-semibold text-white">
                                {rule.value}
                                {rule.source ? (
                                  <span className="ml-2 rounded-full border border-white/15 px-1.5 py-px text-[11px] font-medium text-white/50" data-testid="league-rule-source">
                                    {t(`rules.sheet.source.${rule.source}`)}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                            {rule.means ? <p className="mt-0.5 text-[12px] leading-snug text-white/70">{rule.means}</p> : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3 sm:px-5" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <div className="flex flex-wrap gap-2">
              <Link href={chimmyHref} onClick={onClose} className="rounded-lg border border-white/20 px-3 py-2 text-[13px] text-white/85 hover:bg-white/10" data-testid="league-rules-sheet-chimmy">
                {t('rules.sheet.askChimmy')}
              </Link>
              <Link href={`/league/${encodeURIComponent(leagueId)}/constitution`} className="rounded-lg px-3 py-2 text-[13px] text-white/70 underline-offset-2 hover:underline">
                {t('rules.sheet.constitution')}
              </Link>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg bg-[#ff3d81] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#ff5a94]" data-testid="league-rules-sheet-done">
              {t('rules.sheet.gotIt')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
