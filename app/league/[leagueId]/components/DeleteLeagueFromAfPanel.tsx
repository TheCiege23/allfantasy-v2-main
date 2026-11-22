'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

/**
 * Native leagues are deleted for all members after name confirmation. Imported leagues are
 * removed from the AllFantasy account; the league on the external host is unchanged.
 */
export function DeleteLeagueFromAfPanel({
  leagueId,
  currentUserId,
  leagueOwnerUserId,
  platform,
  leagueName,
}: {
  leagueId: string
  currentUserId: string
  /** Prisma `League.userId` — only that user can remove the imported row via this API. */
  leagueOwnerUserId: string
  platform?: string | null
  leagueName?: string | null
}) {
  const router = useRouter()
  const { t } = useLanguage()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [typedName, setTypedName] = useState('')
  const permanent = platform != null && isNativePlatform(platform)
  const confirmationName = leagueName || leagueId
  const canRemove = currentUserId === leagueOwnerUserId

  const runDelete = async () => {
    if (!canRemove || loading || (permanent && typedName !== confirmationName)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}${permanent ? '?permanent=1' : ''}`, {
        method: 'DELETE',
        credentials: 'include',
        ...(permanent ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueName: typedName }) } : {}),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? t('lsHub.del.failed'))
        return
      }
      toast.success(t(permanent ? 'lsHub.del.nativeRemoved' : 'lsHub.del.removed'))
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
        {permanent ? t('lsHub.del.nativeBody') : <><strong className="text-white/90">{t('lsHub.removeTitle')}</strong> {t('lsHub.del.body1')}{' '}<strong className="text-amber-200/90">{t('lsHub.del.not')}</strong> {t('lsHub.del.body2')}</>}
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
            {t(permanent ? 'lsHub.del.nativeOpen' : 'lsHub.del.open')}
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
              {t(permanent ? 'lsHub.del.nativeTitle' : 'lsHub.del.confirmTitle')}
            </h3>
            <p className="mt-2 text-[13px] text-white/65">
              {t(permanent ? 'lsHub.del.nativeConfirm' : 'lsHub.del.confirmBody')}
            </p>
            {permanent ? (
              <label className="mt-3 block text-sm text-white/75">
                {t('lsHub.del.typeName').replace('{{name}}', confirmationName)}
                <input value={typedName} onChange={(e) => setTypedName(e.target.value)} className="mt-2 w-full rounded border border-white/20 bg-black/20 px-3 py-2 text-white" />
              </label>
            ) : null}
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
                disabled={loading || (permanent && typedName !== confirmationName)}
                onClick={() => void runDelete()}
                className="flex-1 rounded-xl border border-rose-500/40 bg-rose-600/30 py-2.5 text-[13px] font-semibold text-rose-50 hover:bg-rose-600/45 disabled:opacity-50"
                data-testid="delete-league-af-confirm"
              >
                {loading ? t('lsHub.del.removing') : t(permanent ? 'lsHub.del.nativeOpen' : 'lsHub.del.remove')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
