'use client'

import { useRef, useState } from 'react'
import { useOverlayContainment } from '@/components/core-app/useOverlayContainment'
import { useRouter } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { SUPPORT_WIDGET_OPEN_EVENT } from '@/lib/support/support-widget'

type Props = {
  leagueId: string
  leagueName: string
  platform: string
  canRemove: boolean
  supportEvent?: string
}

/** A visible, mobile-sized path to the existing per-user import removal API. */
export function ImportedLeagueQuickActions({ leagueId, leagueName, platform, canRemove, supportEvent = SUPPORT_WIDGET_OPEN_EVENT }: Props) {
  const router = useRouter()
  const { t, tInterpolate } = useOptionalLanguage()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useOverlayContainment({
    active: confirmOpen,
    containerRef: dialogRef,
    initialFocusRef: cancelRef,
    onClose: () => { if (!removing) setConfirmOpen(false) },
  })

  async function remove() {
    if (removing) return
    setRemoving(true)
    setError(null)
    try {
      const response = await fetch(`/api/league/${encodeURIComponent(leagueId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!response.ok || result?.ok !== true) {
        throw new Error(result?.error || t('league.importedActions.deleteFailed'))
      }
      router.push('/core')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('league.importedActions.deleteFailed'))
      setRemoving(false)
      setConfirmOpen(false)
    }
  }

  return (
    <section
      aria-label={t('league.importedActions.aria')}
      className="shrink-0 border-b border-white/10 bg-[#0b1328] px-4 py-3"
      data-testid="imported-league-quick-actions"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/*
          ⚠ NOT FRAMED AS HELP. This strip used to open with "Need help with this imported league?",
          which made its remove button read as a support action — a user who wanted these leagues gone
          hid them instead (2026-10-29). It states what the league is, and Remove comes first.
        */}
        <p className="text-xs leading-5 text-white/70">
          {tInterpolate('league.importedActions.importedFrom', { platform })}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {canRemove ? (
            <button
              type="button"
              onClick={() => { setError(null); setConfirmOpen(true) }}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 text-sm font-semibold text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              data-testid="delete-imported-league-open"
            >
              {t('league.importedActions.remove')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(supportEvent))}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-4 text-sm font-semibold text-[var(--badge-text-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            {t('league.importedActions.contactSupport')}
          </button>
        </div>
      </div>
      {error ? <p role="alert" className="mx-auto mt-2 max-w-5xl text-sm text-rose-200">{error}</p> : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4" role="presentation" onClick={() => { if (!removing) setConfirmOpen(false) }}>
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-imported-league-title"
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0a1228] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white shadow-2xl sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-imported-league-title" className="text-lg font-bold">
              {t('league.importedActions.confirmTitle')}
            </h2>
            <p className="mt-2 break-words text-sm font-semibold">{leagueName}</p>
            <p className="mt-3 text-sm leading-6 text-white/70">
              {tInterpolate('league.importedActions.confirmBody', { platform })}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
              <button ref={cancelRef} type="button" disabled={removing} onClick={() => setConfirmOpen(false)} className="min-h-11 flex-1 rounded-xl border border-white/20 px-4 text-sm font-semibold disabled:opacity-50">
                {t('league.common.cancel')}
              </button>
              <button type="button" disabled={removing} onClick={() => void remove()} className="min-h-11 flex-1 rounded-xl bg-rose-600 px-4 text-sm font-semibold disabled:opacity-50" data-testid="delete-imported-league-confirm">
                {removing ? t('league.importedActions.deleting') : t('league.importedActions.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
