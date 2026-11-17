'use client'

import { useState } from 'react'
import { RotateCcw, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

export default function ResetLeaguePanel({ leagueId }: { leagueId?: string }) {
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'soft' | 'full'>('soft')
  const [result, setResult] = useState<null | {
    waiverClaimsRemoved: number
    waiverTransactionsRemoved: number
    waiverPickupsRemoved: number
    standingsRowsReset: number
    chatMessagesRemoved: number
    aiAlertsRemoved: number
    aiActionLogsRemoved: number
    draftSessionReset: boolean
  }>(null)

  const handleReset = async () => {
    if (!leagueId || loading) return
    if (!confirm(`Reset league (${mode})? This will clear operational data and standings. This action cannot be undone.`)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setResult({
          waiverClaimsRemoved: Number(data?.waiverClaimsRemoved ?? 0),
          waiverTransactionsRemoved: Number(data?.waiverTransactionsRemoved ?? 0),
          waiverPickupsRemoved: Number(data?.waiverPickupsRemoved ?? 0),
          standingsRowsReset: Number(data?.standingsRowsReset ?? 0),
          chatMessagesRemoved: Number(data?.chatMessagesRemoved ?? 0),
          aiAlertsRemoved: Number(data?.aiAlertsRemoved ?? 0),
          aiActionLogsRemoved: Number(data?.aiActionLogsRemoved ?? 0),
          draftSessionReset: Boolean(data?.draftSessionReset),
        })
        toast.success('League reset completed')
      } else {
        toast.error(data?.error || 'Reset failed or not available')
      }
    } catch {
      toast.error('Request failed')
    } finally {
      setLoading(false)
    }
  }

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Reset League</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to access reset options.</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <RotateCcw className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Reset League</h3>
      </div>
      <p className="mt-2 text-xs text-white/65">
        Reset league operational state without platform admin intervention.
      </p>
      <div className="mt-3 max-w-xs">
        <label className="mb-1 block text-xs text-white/70">Reset mode</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value === 'full' ? 'full' : 'soft')}
          data-testid="commissioner-reset-mode"
          className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white"
        >
          <option value="soft">Soft reset (waivers, standings, draft session)</option>
          <option value="full">Full reset (+ chat + Chimmy alerts)</option>
        </select>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-xs text-white/70">Use with caution. This does not delete the league, rosters, or membership.</p>
      </div>
      <button
        type="button"
        onClick={handleReset}
        disabled={loading}
        data-testid="commissioner-reset-league-button"
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Reset league now
      </button>
      {result && (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100" data-testid="commissioner-reset-result">
          <p>
            Claims {result.waiverClaimsRemoved}, transactions {result.waiverTransactionsRemoved}, pickups {result.waiverPickupsRemoved}, standings rows {result.standingsRowsReset}.
          </p>
          <p>
            Draft session reset: {result.draftSessionReset ? 'yes' : 'no'}.
            Extra cleanup: chat {result.chatMessagesRemoved}, Chimmy alerts {result.aiAlertsRemoved}, Chimmy logs {result.aiActionLogsRemoved}.
          </p>
        </div>
      )}
    </section>
  )
}
