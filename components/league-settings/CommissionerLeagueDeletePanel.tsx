'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Archive, AlertTriangle } from 'lucide-react'
import { dispatchStateRefreshEvent } from '@/lib/state-consistency'

interface Props {
  leagueId: string
  leagueName: string
  /** Head commissioner (`League.userId`) from settings payload */
  leagueOwnerUserId: string
  /** `userRole` from settings — archive is head-only */
  userRole: 'commissioner' | 'co_commissioner' | 'member' | 'viewer' | null
  settingsSnapshot?: Record<string, unknown>
}

export function CommissionerLeagueDeletePanel({
  leagueId,
  leagueName,
  leagueOwnerUserId,
  userRole,
  settingsSnapshot,
}: Props) {
  const router = useRouter()
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? ''
  const isHeadCommissioner = userRole === 'commissioner'

  const [archiveOpen, setArchiveOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [removeLoading, setRemoveLoading] = useState(false)

  const imported =
    typeof settingsSnapshot?.importSource === 'string' ||
    typeof settingsSnapshot?.platformLeagueId === 'string' ||
    Boolean(settingsSnapshot?.importedFromProvider)

  const runArchive = async () => {
    if (!isHeadCommissioner || archiveLoading) return
    setArchiveLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/commissioner-controls`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive' }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? 'Could not archive league')
        return
      }
      toast.success('League archived')
      dispatchStateRefreshEvent({ domain: 'leagues', leagueId, reason: 'league_archived' })
      setArchiveOpen(false)
      router.push('/core')
      router.refresh()
    } catch {
      toast.error('Network error')
    } finally {
      setArchiveLoading(false)
    }
  }

  const runRemoveFromAf = async () => {
    if (!canRemoveFromAf || removeLoading) return
    if (typedName.trim() !== leagueName.trim()) {
      toast.error('League name does not match')
      return
    }
    setRemoveLoading(true)
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
      dispatchStateRefreshEvent({ leagueId, domain: 'leagues' })
      setRemoveOpen(false)
      router.push('/core')
      router.refresh()
    } catch {
      toast.error('Network error')
    } finally {
      setRemoveLoading(false)
    }
  }

  const canRemoveFromAf = viewerId === leagueOwnerUserId

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-white">Delete League</h3>
        <p className="mt-0.5 text-xs text-white/50">
          Destructive actions are limited by role. Co-commissioners cannot archive or remove the league row.
        </p>
      </div>

      {imported ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/25 px-3 py-2 text-[12px] text-amber-100/90">
          This league is linked to an imported host. Archiving or removing it here does not change your league on
          Sleeper, ESPN, Yahoo, or other platforms.
        </div>
      ) : null}

      {/* Archive — head commissioner */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="flex items-start gap-3">
          <Archive className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300/80" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[13px] font-semibold text-white">Archive league</p>
            <p className="text-[12px] leading-relaxed text-white/55">
              Marks the league as archived, freezes commissioner tools where applicable, and moves it out of active
              dashboards. Prefer this over deleting when you want history preserved.
            </p>
            {isHeadCommissioner ? (
              <button
                type="button"
                onClick={() => setArchiveOpen(true)}
                className="mt-1 rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-2 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-950/45"
              >
                Archive league…
              </button>
            ) : (
              <p className="text-[11px] text-white/35">Only the head commissioner can archive.</p>
            )}
          </div>
        </div>
      </div>

      {/* Remove from AF — importer only */}
      <div className="rounded-xl border border-rose-500/20 bg-rose-950/15 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300/90" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[13px] font-semibold text-rose-100/95">Remove from AllFantasy</p>
            <p className="text-[12px] leading-relaxed text-white/55">
              Deletes this league from your AllFantasy account and associated AF data for this import.{' '}
              <strong className="text-white/80">Irreversible</strong> from the app perspective.
            </p>
            {!canRemoveFromAf ? (
              <p className="text-[11px] text-white/40">
                Only the AllFantasy account that created this league can remove it here.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTypedName('')
                  setRemoveOpen(true)
                }}
                className="mt-1 rounded-lg border border-rose-500/35 bg-rose-950/35 px-3 py-2 text-[12px] font-semibold text-rose-50 hover:bg-rose-950/50"
              >
                Remove league from AllFantasy…
              </button>
            )}
          </div>
        </div>
      </div>

      {archiveOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/80"
            aria-label="Close"
            onClick={() => !archiveLoading && setArchiveOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0a1228] p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Archive this league?</h3>
            <p className="mt-2 text-[13px] text-white/65">
              The league will be archived for all members. You can still reference history where retained by policy.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={archiveLoading}
                onClick={() => setArchiveOpen(false)}
                className="flex-1 rounded-xl border border-white/[0.12] py-2.5 text-[13px] font-semibold text-white/85 hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiveLoading}
                onClick={() => void runArchive()}
                className="flex-1 rounded-xl border border-cyan-500/40 bg-cyan-600/25 py-2.5 text-[13px] font-semibold text-cyan-50 hover:bg-cyan-600/40 disabled:opacity-50"
              >
                {archiveLoading ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {removeOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/80"
            aria-label="Close"
            onClick={() => !removeLoading && setRemoveOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-rose-500/25 bg-[#120a10] p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-50">Remove from AllFantasy?</h3>
            <p className="mt-2 text-[13px] text-white/65">
              Type the league name <span className="font-semibold text-white">{leagueName}</span> to confirm.
            </p>
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="mt-3 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
              placeholder="League name"
              autoComplete="off"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={removeLoading}
                onClick={() => setRemoveOpen(false)}
                className="flex-1 rounded-xl border border-white/[0.12] py-2.5 text-[13px] font-semibold text-white/85 hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removeLoading || typedName.trim() !== leagueName.trim()}
                onClick={() => void runRemoveFromAf()}
                className="flex-1 rounded-xl border border-rose-500/40 bg-rose-600/30 py-2.5 text-[13px] font-semibold text-rose-50 hover:bg-rose-600/45 disabled:opacity-40"
              >
                {removeLoading ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
