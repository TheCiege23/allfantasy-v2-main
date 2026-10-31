'use client'

import { useEffect, useState } from 'react'

/**
 * The commissioner's "fix a problem" tools. The season runs itself; these are for the few things
 * only a person can know: a stat correction the provider missed, a manager who quit, or a cast that
 * is ready to merge early, a Tribal result that named the wrong manager, or tribes that need redrawing.
 * Each one asks for a second tap before it runs and lands in the audit log.
 */

type Manager = { userId: string; name: string }
type FixId = 'score' | 'remove' | 'merge' | 'tribal' | 'redraw'

/** GET /api/survivor/commissioner?type=tribal_override (lib/survivor/survivorTribalOverride.ts). */
type OverrideTarget = {
  councilId: string
  week: number
  eliminatedUserId: string
  eliminatedName: string | null
  resolved: boolean
  candidates: Array<{ userId: string; name: string }>
}

type OverrideResult = {
  restoredPlayerIds?: string[]
  claimedElsewherePlayerIds?: string[]
  eliminationApplied?: boolean
  eliminationError?: string
}

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
  const [target, setTarget] = useState<OverrideTarget | null | undefined>(undefined)
  const [tribalUserId, setTribalUserId] = useState('')
  const [tribalReason, setTribalReason] = useState('')

  useEffect(() => {
    if (open !== 'tribal' || target !== undefined) return
    fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=tribal_override`, { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then((json: { target?: OverrideTarget | null } | null) => setTarget(json?.target ?? null))
      .catch(() => setTarget(null))
  }, [open, target, leagueId])

  const points = Number(scorePoints)
  const weekNumber = Number(scoreWeek)
  const scoreReady = Boolean(scoreUserId) && Number.isInteger(weekNumber) && weekNumber > 0 && Number.isFinite(points) && points !== 0 && scorePoints.trim() !== ''
  const removeReady = Boolean(removeUserId)
  const nameOf = (userId: string) => managers.find(manager => manager.userId === userId)?.name ?? 'this manager'

  const tribalName = (userId: string) => target?.candidates.find(c => c.userId === userId)?.name ?? 'this manager'
  /** What the override could not give back, said plainly after it runs. */
  const overrideNotice = (result: OverrideResult) => {
    const restored = result.restoredPlayerIds?.length ?? 0
    const kept = result.claimedElsewherePlayerIds?.length ?? 0
    const parts = [`${tribalName(tribalUserId)} is now the one voted out.`]
    if (target?.resolved) {
      parts.push(`${target.eliminatedName ?? 'The other manager'} is back in the game${restored ? ` with ${restored} of their released player${restored === 1 ? '' : 's'}` : ''}.`)
      if (kept) parts.push(`${kept} released player${kept === 1 ? ' was' : 's were'} already claimed by another team and stay${kept === 1 ? 's' : ''} there.`)
      if (result.eliminationApplied === false) parts.push(`Their elimination did not finish (${result.eliminationError ?? 'try again'}); run the change again to complete it.`)
    }
    return parts.join(' ')
  }

  const run = async (fix: FixId, body: Record<string, unknown>, success: string | ((json: Record<string, unknown>) => string)) => {
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
      setNotice(typeof success === 'function' ? success(json as Record<string, unknown>) : success)
      setOpen(null)
      if (fix === 'score') { setScorePoints(''); setScoreReason('') }
      if (fix === 'remove') { setRemoveUserId(''); setRemoveReason('') }
      if (fix === 'tribal') { setTribalUserId(''); setTribalReason(''); setTarget(undefined) }
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

      {choice('tribal', 'Change a Tribal result', 'The wrong manager was voted out. Bring them back and vote out the right one instead.')}
      {open === 'tribal' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3" data-testid="survivor-tribal-override">
          {target === undefined ? <p className="text-xs text-white/50">Loading the latest Tribal Council…</p>
            : target === null ? <p className="text-xs text-white/50">No Tribal Council result can be changed right now.</p>
            : (
              <>
                <p className="text-xs text-white/60">Week {target.week}: <strong className="text-white">{target.eliminatedName ?? 'A manager'}</strong> was voted out.</p>
                <label className="block text-xs text-white/60">Vote out instead
                  <select aria-label="Manager to vote out instead" className={field} value={tribalUserId} onChange={event => { setTribalUserId(event.target.value); setConfirming(null) }}>
                    <option value="">Choose a manager</option>
                    {target.candidates.map(candidate => <option key={candidate.userId} value={candidate.userId}>{candidate.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-white/60">Reason (shown in the audit log)
                  <input aria-label="Reason for changing the result" className={field} value={tribalReason} onChange={event => setTribalReason(event.target.value)} />
                </label>
                <p className="text-xs text-white/50">
                  {target.resolved
                    ? `${target.eliminatedName ?? 'They'} come back to their tribe and chat, leave Exile or the jury, and get back released players nobody has claimed. Trades cancelled at the vote-out stay cancelled.`
                    : 'The result has not been carried out yet, so nothing needs undoing.'}
                  {' '}Only the most recent Tribal Council can be changed.
                </p>
                <button type="button" disabled={busy || !tribalUserId} className={`${button} ${confirming === 'tribal' ? 'bg-red-500 text-white' : ''}`}
                  onClick={() => void run('tribal', { action: 'override_tribal', councilId: target.councilId, eliminateUserId: tribalUserId, notes: tribalReason.trim() || undefined },
                    json => overrideNotice(json as OverrideResult))}>
                  {confirming === 'tribal' ? `Confirm: vote out ${tribalName(tribalUserId)}` : 'Change the result'}
                </button>
              </>
            )}
        </div>
      )}

      {!merged && choice('redraw', 'Redraw the tribes', 'Shuffle every active manager into new tribes now, before the next Tribal Council.')}
      {!merged && open === 'redraw' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <p className="text-xs text-white/50">Every active manager gets a new tribe and new tribe chats. Works only before the merge and between Tribal Councils. This cannot be undone.</p>
          <button type="button" disabled={busy} className={`${button} ${confirming === 'redraw' ? 'bg-amber-400 text-black' : ''}`}
            onClick={() => void run('redraw', { action: 'redraw_tribes', notes: 'Commissioner redrew the tribes' }, 'The tribes have been redrawn.')}>
            {confirming === 'redraw' ? 'Confirm: redraw now' : 'Redraw the tribes'}
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
