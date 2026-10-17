'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * Removes the league row from the signed-in user's AllFantasy account (DELETE /api/league/[leagueId]).
 * Does not delete the league on Sleeper or other hosts — copy makes that explicit.
 */
export function DeleteLeagueFromAfPanel({
  leagueId,
  currentUserId,
  leagueOwnerUserId,
}: {
  leagueId: string
  currentUserId: string
  /** Prisma `League.userId` — only that user can remove the imported row via this API. */
  leagueOwnerUserId: string
}) {
  const router = useRouter()
  const { t } = useLanguage()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const canRemove = currentUserId === leagueOwnerUserId

  const runDelete = async () => {
    if (!canRemove || loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? t('lsHub.del.failed'))
        return
      }
      toast.success(t('lsHub.del.removed'))
      router.push('/core')
      router.refresh()
    } catch {
      toast.error(t('lsHub.del.network'))
    } finally {
      setLoading(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="delete-league-af-panel">
      <p className="text-[13px] leading-relaxed text-white/70">
        <strong className="text-white/90">{t('lsHub.removeTitle')}</strong> {t('lsHub.del.body1')}{' '}
        <strong className="text-amber-200/90">{t('lsHub.del.not')}</strong> {t('lsHub.del.body2')}
      </p>

      {!canRemove ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-100/90">
          {t('lsHub.del.ownerOnly')}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="w-full rounded-xl border border-rose-500/35 bg-rose-950/35 py-2.5 text-[13px] font-semibold text-rose-100 hover:bg-rose-950/50"
            data-testid="delete-league-af-open"
          >
            {t('lsHub.del.open')}
          </button>
        </>
      )}

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-league-af-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/80"
            aria-label={t('lsHub.del.close')}
            onClick={() => !loading && setConfirmOpen(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#0a1228] p-5 shadow-2xl">
            <h3 id="delete-league-af-title" className="text-lg font-bold text-white">
              {t('lsHub.del.confirmTitle')}
            </h3>
            <p className="mt-2 text-[13px] text-white/65">
              {t('lsHub.del.confirmBody')}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-xl border border-white/[0.12] py-2.5 text-[13px] font-semibold text-white/85 hover:bg-white/[0.06]"
              >
                {t('lsHub.del.cancel')}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void runDelete()}
                className="flex-1 rounded-xl border border-rose-500/40 bg-rose-600/30 py-2.5 text-[13px] font-semibold text-rose-50 hover:bg-rose-600/45 disabled:opacity-50"
                data-testid="delete-league-af-confirm"
              >
                {loading ? t('lsHub.del.removing') : t('lsHub.del.remove')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
