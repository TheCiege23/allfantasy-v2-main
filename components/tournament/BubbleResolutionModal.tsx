'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, X, ArrowRight } from 'lucide-react'

interface BubbleRow {
  userId: string
  teamName: string | null
  conferenceName: string
  wins: number
  losses: number
  pointsFor: number
  rankInConference: number
  advancementStatus: 'advanced' | 'bubble' | 'out'
}

interface BubbleResolutionModalProps {
  tournamentId: string
  open: boolean
  onClose: () => void
  onResolved?: () => void
}

export function BubbleResolutionModal({ tournamentId, open, onClose, onResolved }: BubbleResolutionModalProps) {
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [rows, setRows] = useState<BubbleRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const loadBubble = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/standings?bubble=true`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load standings')
      const data = await res.json()
      const bubbleRows: BubbleRow[] = (data.rows ?? [])
        .filter((r: Record<string, unknown>) => r.advancementStatus === 'bubble' || r.onBubble)
        .map((r: Record<string, unknown>) => ({
          userId: r.userId as string,
          teamName: (r.teamName as string | null) ?? (r.userId as string)?.slice(0, 8),
          conferenceName: r.conferenceName as string,
          wins: r.wins as number,
          losses: r.losses as number,
          pointsFor: r.pointsFor as number,
          rankInConference: r.rankInConference as number,
          advancementStatus: r.advancementStatus as BubbleRow['advancementStatus'],
        }))
      setRows(bubbleRows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [tournamentId])

  useEffect(() => {
    if (open) {
      loadBubble()
      setSuccess(false)
    }
  }, [open, loadBubble])

  async function resolveBubble() {
    setResolving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolveBubble: true }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to resolve bubble')
      }
      setSuccess(true)
      onResolved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setResolving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f1114] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Bubble Resolution
          </h2>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="h-7 w-7 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-emerald-300">Bubble resolved successfully!</p>
            <p className="text-xs text-white/60">Advancing bubble teams have been assigned to elimination leagues.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-white/60">
              These teams are on the bubble — they may advance based on tiebreaker resolution. Review and confirm to finalize advancement.
            </p>

            {error && (
              <div className="mb-3 rounded-lg border border-red-500/20 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {loading ? (
              <div className="py-8 text-center text-sm text-white/50">Loading bubble teams...</div>
            ) : rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-white/50">
                No bubble teams found. Bubble week may not be enabled or all slots are already filled.
              </div>
            ) : (
              <div className="mb-4 max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50">
                      <th className="py-2 pr-2">Team</th>
                      <th className="py-2 pr-2">Conf</th>
                      <th className="py-2 pr-2 text-right">W-L</th>
                      <th className="py-2 pr-2 text-right">PF</th>
                      <th className="py-2 text-right">Rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.userId} className="border-b border-white/5">
                        <td className="py-2 pr-2 font-medium text-white">{r.teamName}</td>
                        <td className="py-2 pr-2 text-white/60">{r.conferenceName}</td>
                        <td className="py-2 pr-2 text-right font-mono text-white/80">{r.wins}-{r.losses}</td>
                        <td className="py-2 pr-2 text-right font-mono text-white/80">{r.pointsFor.toFixed(1)}</td>
                        <td className="py-2 text-right">
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-200">
                            #{r.rankInConference}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resolving || rows.length === 0}
                onClick={resolveBubble}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-600/30 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-600/40 disabled:opacity-50"
              >
                {resolving ? (
                  'Resolving...'
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4" />
                    Advance {rows.length} bubble team{rows.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
