'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

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
        toast.error(data.error ?? 'Could not remove league')
        return
      }
      toast.success('League removed from AllFantasy')
      router.push('/core')
      router.refresh()
    } catch {
      toast.error('Network error')
    } finally {
      setLoading(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="delete-league-af-panel">
      <p className="text-[13px] leading-relaxed text-white/70">
        <strong className="text-white/90">Remove from AllFantasy</strong> deletes this league from your dashboard and
        AllFantasy data tied to this import. It does <strong className="text-amber-200/90">not</strong> delete or archive
        the league on Sleeper, Yahoo, ESPN, or other platforms.
      </p>

      {!canRemove ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-100/90">
          Only the AllFantasy account that imported this league can remove it here. Use your host app to leave or ask the
          commissioner to remove your team.
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="w-full rounded-xl border border-rose-500/35 bg-rose-950/35 py-2.5 text-[13px] font-semibold text-rose-100 hover:bg-rose-950/50"
            data-testid="delete-league-af-open"
          >
            Remove league from AllFantasy…
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
            aria-label="Close"
            onClick={() => !loading && setConfirmOpen(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#0a1228] p-5 shadow-2xl">
            <h3 id="delete-league-af-title" className="text-lg font-bold text-white">
              Remove from AllFantasy?
            </h3>
            <p className="mt-2 text-[13px] text-white/65">
              This cannot be undone from the app. Your host league (e.g. Sleeper) is unchanged.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-xl border border-white/[0.12] py-2.5 text-[13px] font-semibold text-white/85 hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void runDelete()}
                className="flex-1 rounded-xl border border-rose-500/40 bg-rose-600/30 py-2.5 text-[13px] font-semibold text-rose-50 hover:bg-rose-600/45 disabled:opacity-50"
                data-testid="delete-league-af-confirm"
              >
                {loading ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
