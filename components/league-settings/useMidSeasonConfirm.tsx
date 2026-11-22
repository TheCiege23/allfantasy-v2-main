'use client'

/**
 * Confirm-before-saving for mid-season scoring / roster changes.
 *
 * The settings routes answer a mid-season edit with 409 `mid_season_confirmation_required`
 * (lib/league/settingsLifecycleGate.ts). `confirmFetch` is a drop-in for `fetch` on those calls:
 * it shows this dialog and, if the commissioner confirms, re-sends the same request with
 * `confirmMidSeasonChange: true`. On cancel it resolves to a 409 whose `error` is
 * `lsEd.midSeason.cancelled`, so the caller's usual `if (!res.ok)` path reports it.
 *
 * Render `dialog` once in the panel.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AppModal } from '@/components/ui/AppModal'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { fetchWithMidSeasonConfirmation } from '@/lib/league/midSeasonConfirmation'

export function useMidSeasonConfirm(): {
  confirmFetch: (input: string, init?: RequestInit) => Promise<Response>
  /** Ask directly (for a caller that is not a plain fetch, e.g. useAutosave). */
  confirm: (message: string) => Promise<boolean>
  dialog: ReactNode
} {
  const { t } = useOptionalLanguage()
  const [open, setOpen] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean) => {
    const r = resolver.current
    resolver.current = null
    setOpen(false)
    r?.(ok)
  }, [])

  const confirm = useCallback((_message: string) => {
    // A second request while one is pending answers the first "no" rather than leaving it hanging.
    resolver.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setOpen(true)
    })
  }, [])

  const confirmFetch = useCallback(
    (input: string, init?: RequestInit) =>
      fetchWithMidSeasonConfirmation(input, init, confirm, t('lsEd.midSeason.cancelled')),
    [confirm, t],
  )

  const dialog = (
    <AppModal
      open={open}
      onClose={() => settle(false)}
      title={t('lsEd.midSeason.title')}
      size="sm"
      data-testid="mid-season-confirm-dialog"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(false)}
            data-testid="mid-season-confirm-cancel"
            className="rounded-lg border border-subtle px-3 py-1.5 text-sm text-primary hover:bg-surface-hover"
          >
            {t('lsEd.midSeason.cancel')}
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            data-testid="mid-season-confirm-accept"
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-black hover:bg-amber-400"
          >
            {t('lsEd.midSeason.confirm')}
          </button>
        </div>
      }
    >
      <p className="text-sm text-secondary">{t('lsEd.midSeason.body')}</p>
    </AppModal>
  )

  return { confirmFetch, confirm, dialog }
}
