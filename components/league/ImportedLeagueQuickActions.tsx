'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { SUPPORT_WIDGET_OPEN_EVENT } from '@/lib/support/support-widget'

type Props = {
  leagueId: string
  leagueName: string
  platform: string
  canRemove: boolean
}

/** A visible, mobile-sized path to the existing per-user import removal API. */
export function ImportedLeagueQuickActions({ leagueId, leagueName, platform, canRemove }: Props) {
  const router = useRouter()
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        throw new Error(result?.error || (es ? 'No se pudo eliminar la liga.' : 'Could not delete this imported league.'))
      }
      router.push('/core')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (es ? 'No se pudo eliminar la liga.' : 'Could not delete this imported league.'))
      setRemoving(false)
      setConfirmOpen(false)
    }
  }

  return (
    <section
      aria-label={es ? 'Ayuda con esta liga importada' : 'Imported league help'}
      className="shrink-0 border-b border-white/10 bg-[#0b1328] px-4 py-3"
      data-testid="imported-league-quick-actions"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-white/70">
          {es ? '¿Necesitas ayuda con esta liga importada?' : 'Need help with this imported league?'}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(SUPPORT_WIDGET_OPEN_EVENT))}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            {es ? 'Contactar a soporte' : 'Contact support'}
          </button>
          {canRemove ? (
            <button
              type="button"
              onClick={() => { setError(null); setConfirmOpen(true) }}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 text-sm font-semibold text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              data-testid="delete-imported-league-open"
            >
              {es ? 'Eliminar esta liga importada' : 'Delete this imported league'}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p role="alert" className="mx-auto mt-2 max-w-5xl text-sm text-rose-200">{error}</p> : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4" role="presentation" onClick={() => { if (!removing) setConfirmOpen(false) }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-imported-league-title"
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0a1228] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white shadow-2xl sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-imported-league-title" className="text-lg font-bold">
              {es ? '¿Eliminar esta liga importada?' : 'Delete this imported league?'}
            </h2>
            <p className="mt-2 break-words text-sm font-semibold">{leagueName}</p>
            <p className="mt-3 text-sm leading-6 text-white/70">
              {es
                ? `Se eliminará tu copia en AllFantasy. La liga original en ${platform} y las copias de otros miembros no cambiarán.`
                : `This removes your copy from AllFantasy. The original league on ${platform} and other members' copies are unaffected.`}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
              <button type="button" disabled={removing} onClick={() => setConfirmOpen(false)} className="min-h-11 flex-1 rounded-xl border border-white/20 px-4 text-sm font-semibold disabled:opacity-50">
                {es ? 'Cancelar' : 'Cancel'}
              </button>
              <button type="button" disabled={removing} onClick={() => void remove()} className="min-h-11 flex-1 rounded-xl bg-rose-600 px-4 text-sm font-semibold disabled:opacity-50" data-testid="delete-imported-league-confirm">
                {removing ? (es ? 'Eliminando…' : 'Deleting…') : (es ? 'Eliminar de AllFantasy' : 'Delete from AllFantasy')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
