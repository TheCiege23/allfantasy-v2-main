'use client'

import { useState } from 'react'

/**
 * The commissioner's "fix a problem" tools. The season runs itself; these are for the few things
 * only a person can know: a stat correction the provider missed, a manager who quit, or a cast that
 * is ready to merge early. Each one asks for a second tap before it runs and lands in the audit log.
 */

type Manager = { userId: string; name: string }
type FixId = 'score' | 'remove' | 'merge'

export function SurvivorSeasonFixPanel({ leagueId, managers, week, merged }: { leagueId: string; managers: Manager[]; week: number; merged: boolean }) {
  const [open, setOpen] = useState<FixId | null>(null)
  const [confirming, setConfirming] = useState<FixId | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scoreUserId, setScoreUserId] = useState('')
  const [scoreWeek, setScoreWeek] = useState(String(week || 1))
  const [scorePoints, setScorePoints] = useState('')
  const [scoreReason, setScoreReason] = useState('')
  const [removeUserId, setRemoveUserId] = useState('')
  const [removeReason, setRemoveReason] = useState('')

  const points = Number(scorePoints)
  const weekNumber = Number(scoreWeek)
  const scoreReady = Boolean(scoreUserId) && Number.isInteger(weekNumber) && weekNumber > 0 && Number.isFinite(points) && points !== 0 && scorePoints.trim() !== ''
  const removeReady = Boolean(removeUserId)
  const nameOf = (userId: string) => managers.find(manager => manager.userId === userId)?.name ?? 'this manager'

  const run = async (fix: FixId, body: Record<string, unknown>, success: string) => {
    if (confirming !== fix) { setConfirming(fix); setNotice(null); setError(null); return }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/survivor/commissioner', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, ...body }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : 'That change could not be made.')
      setNotice(success)
      setOpen(null)
      if (fix === 'score') { setScorePoints(''); setScoreReason('') }
      if (fix === 'remove') { setRemoveUserId(''); setRemoveReason('') }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That change could not be made.')
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  const toggle = (fix: FixId) => { setOpen(open === fix ? null : fix); setConfirming(null); setError(null); setNotice(null) }
  const field = 'mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white'
  const button = 'min-h-11 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold disabled:opacity-40'
  const choice = (fix: FixId, title: string, detail: string) => (
    <button type="button" aria-expanded={open === fix} onClick={() => toggle(fix)}
      className={`w-full rounded-xl border p-3 text-left ${open === fix ? 'border-amber-300/60 bg-amber-400/5' : 'border-white/10 bg-white/[0.02]'}`}>
      <span className="block text-sm font-semibold text-white">{title}</span>
      <span className="mt-1 block text-xs text-white/55">{detail}</span>
    </button>
  )

  return (
    <div className="space-y-3" data-testid="survivor-season-fix-panel">
      <p className="text-sm text-white/65">The season runs on its own. Use these only when something real needs a person.</p>
      {notice && <p role="status" className="rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-red-200">{error}</p>}

      {choice('score', 'Correct a score', 'Add or take away points for one manager and week, for a stat correction the feed missed.')}
      {open === 'score' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <label className="block text-xs text-white/60">Manager
            <select aria-label="Manager to correct" className={field} value={scoreUserId} onChange={event => { setScoreUserId(event.target.value); setConfirming(null) }}>
              <option value="">Choose a manager</option>
              {managers.map(manager => <option key={manager.userId} value={manager.userId}>{manager.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-white/60">Week
              <input aria-label="Week" inputMode="numeric" className={field} value={scoreWeek} onChange={event => { setScoreWeek(event.target.value); setConfirming(null) }} />
            </label>
            <label className="block text-xs text-white/60">Points (+ or −)
              <input aria-label="Points to add or remove" inputMode="decimal" placeholder="e.g. 4.5 or -2" className={field} value={scorePoints} onChange={event => { setScorePoints(event.target.value); setConfirming(null) }} />
            </label>
          </div>
          <label className="block text-xs text-white/60">Reason (shown in the audit log)
            <input aria-label="Reason for the correction" className={field} value={scoreReason} onChange={event => setScoreReason(event.target.value)} />
          </label>
          <p className="text-xs text-white/50">A correction changes the week&apos;s score. A council that has already been read is not re-run.</p>
          <button type="button" disabled={busy || !scoreReady} className={`${button} ${confirming === 'score' ? 'bg-amber-400 text-black' : ''}`}
            onClick={() => void run('score', { action: 'adjust_score', userId: scoreUserId, week: weekNumber, adjustmentAmount: points, notes: scoreReason.trim() || undefined },
              `Week ${weekNumber} score for ${nameOf(scoreUserId)} changed by ${points > 0 ? '+' : ''}${points}.`)}>
            {confirming === 'score' ? `Confirm: ${points > 0 ? '+' : ''}${scoreReady ? points : ''} for ${nameOf(scoreUserId)}` : 'Apply correction'}
          </button>
        </div>
      )}

      {choice('remove', 'Remove a manager who quit', 'Takes them out of the game for good. No Exile, no jury. Their open votes are cleared so the tribe can vote again.')}
      {open === 'remove' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <label className="block text-xs text-white/60">Manager
            <select aria-label="Manager to remove" className={field} value={removeUserId} onChange={event => { setRemoveUserId(event.target.value); setConfirming(null) }}>
              <option value="">Choose a manager</option>
              {managers.map(manager => <option key={manager.userId} value={manager.userId}>{manager.name}</option>)}
            </select>
          </label>
          <label className="block text-xs text-white/60">Reason (shown in the audit log)
            <input aria-label="Reason for removal" className={field} value={removeReason} onChange={event => setRemoveReason(event.target.value)} />
          </label>
          <button type="button" disabled={busy || !removeReady} className={`${button} ${confirming === 'remove' ? 'bg-red-500 text-white' : ''}`}
            onClick={() => void run('remove', { action: 'remove_player', userId: removeUserId, reason: removeReason.trim() || 'Left the league' },
              `${nameOf(removeUserId)} was removed. If a tribe is now too small, Chimmy rebalances it before the next council.`)}>
            {confirming === 'remove' ? `Confirm: remove ${nameOf(removeUserId)}` : 'Remove manager'}
          </button>
        </div>
      )}

      {!merged && choice('merge', 'Start the merge now', 'Everyone joins one tribe this week instead of waiting for the planned merge.')}
      {!merged && open === 'merge' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <p className="text-xs text-white/50">Everyone moves into one merged tribe, individual immunity starts, and idols that expire at the merge expire. This cannot be undone.</p>
          <button type="button" disabled={busy} className={`${button} ${confirming === 'merge' ? 'bg-amber-400 text-black' : ''}`}
            onClick={() => void run('merge', { action: 'force_phase', toPhase: 'merge', notes: 'Commissioner started the merge early' }, 'The merge has started.')}>
            {confirming === 'merge' ? 'Confirm: merge now' : 'Start the merge'}
          </button>
        </div>
      )}
    </div>
  )
}
