'use client'

import { useEffect, useState } from 'react'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * The commissioner's "fix a problem" tools. The season runs itself; these are for the few things
 * only a person can know: a stat correction the provider missed, a manager who quit, or a cast that
 * is ready to merge early, a Tribal result that named the wrong manager, or tribes that need redrawing.
 * Each one asks for a second tap before it runs and lands in the audit log. Every string is in
 * `lib/i18n` under `survivorFix.*`, English and Spanish.
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
  const { t, tInterpolate: ti } = useOptionalLanguage()
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
  const nameOf = (userId: string) => managers.find(manager => manager.userId === userId)?.name ?? t('survivorFix.thisManager')

  const tribalName = (userId: string) => target?.candidates.find(c => c.userId === userId)?.name ?? t('survivorFix.thisManager')
  /** What the override could not give back, said plainly after it runs. */
  const overrideNotice = (result: OverrideResult) => {
    const restored = result.restoredPlayerIds?.length ?? 0
    const kept = result.claimedElsewherePlayerIds?.length ?? 0
    const parts = [ti('survivorFix.tribal.done.out', { name: tribalName(tribalUserId) })]
    if (target?.resolved) {
      const back = target.eliminatedName ?? t('survivorFix.tribal.done.otherManager')
      parts.push(ti(restored === 0 ? 'survivorFix.tribal.done.back' : restored === 1 ? 'survivorFix.tribal.done.backWithOne' : 'survivorFix.tribal.done.backWithMany', { name: back, count: restored }))
      if (kept) parts.push(ti(kept === 1 ? 'survivorFix.tribal.done.keptOne' : 'survivorFix.tribal.done.keptMany', { count: kept }))
      if (result.eliminationApplied === false) parts.push(ti('survivorFix.tribal.done.unfinished', { error: result.eliminationError ?? t('survivorFix.tribal.done.tryAgain') }))
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
      if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : t('survivorFix.failed'))
      setNotice(typeof success === 'function' ? success(json as Record<string, unknown>) : success)
      setOpen(null)
      if (fix === 'score') { setScorePoints(''); setScoreReason('') }
      if (fix === 'remove') { setRemoveUserId(''); setRemoveReason('') }
      if (fix === 'tribal') { setTribalUserId(''); setTribalReason(''); setTarget(undefined) }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('survivorFix.failed'))
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
      <p className="text-sm text-white/65">{t('survivorFix.intro')}</p>
      {notice && <p role="status" className="rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-red-200">{error}</p>}

      {choice('score', t('survivorFix.score.title'), t('survivorFix.score.detail'))}
      {open === 'score' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <label className="block text-xs text-white/60">{t('survivorFix.manager')}
            <select aria-label={t('survivorFix.score.managerAria')} className={field} value={scoreUserId} onChange={event => { setScoreUserId(event.target.value); setConfirming(null) }}>
              <option value="">{t('survivorFix.chooseManager')}</option>
              {managers.map(manager => <option key={manager.userId} value={manager.userId}>{manager.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-white/60">{t('survivorFix.score.week')}
              <input aria-label={t('survivorFix.score.week')} inputMode="numeric" className={field} value={scoreWeek} onChange={event => { setScoreWeek(event.target.value); setConfirming(null) }} />
            </label>
            <label className="block text-xs text-white/60">{t('survivorFix.score.points')}
              <input aria-label={t('survivorFix.score.pointsAria')} inputMode="decimal" placeholder={t('survivorFix.score.pointsPlaceholder')} className={field} value={scorePoints} onChange={event => { setScorePoints(event.target.value); setConfirming(null) }} />
            </label>
          </div>
          <label className="block text-xs text-white/60">{t('survivorFix.reason')}
            <input aria-label={t('survivorFix.score.reasonAria')} className={field} value={scoreReason} onChange={event => setScoreReason(event.target.value)} />
          </label>
          <p className="text-xs text-white/50">{t('survivorFix.score.note')}</p>
          <button type="button" disabled={busy || !scoreReady} className={`${button} ${confirming === 'score' ? 'bg-amber-400 text-black' : ''}`}
            onClick={() => void run('score', { action: 'adjust_score', userId: scoreUserId, week: weekNumber, adjustmentAmount: points, notes: scoreReason.trim() || undefined },
              ti('survivorFix.score.done', { week: weekNumber, name: nameOf(scoreUserId), delta: `${points > 0 ? '+' : ''}${points}` }))}>
            {confirming === 'score' ? ti('survivorFix.score.confirm', { delta: `${points > 0 ? '+' : ''}${scoreReady ? points : ''}`, name: nameOf(scoreUserId) }) : t('survivorFix.score.apply')}
          </button>
        </div>
      )}

      {choice('remove', t('survivorFix.remove.title'), t('survivorFix.remove.detail'))}
      {open === 'remove' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <label className="block text-xs text-white/60">{t('survivorFix.manager')}
            <select aria-label={t('survivorFix.remove.managerAria')} className={field} value={removeUserId} onChange={event => { setRemoveUserId(event.target.value); setConfirming(null) }}>
              <option value="">{t('survivorFix.chooseManager')}</option>
              {managers.map(manager => <option key={manager.userId} value={manager.userId}>{manager.name}</option>)}
            </select>
          </label>
          <label className="block text-xs text-white/60">{t('survivorFix.reason')}
            <input aria-label={t('survivorFix.remove.reasonAria')} className={field} value={removeReason} onChange={event => setRemoveReason(event.target.value)} />
          </label>
          <button type="button" disabled={busy || !removeReady} className={`${button} ${confirming === 'remove' ? 'bg-red-500 text-white' : ''}`}
            onClick={() => void run('remove', { action: 'remove_player', userId: removeUserId, reason: removeReason.trim() || t('survivorFix.remove.defaultReason') },
              ti('survivorFix.remove.done', { name: nameOf(removeUserId) }))}>
            {confirming === 'remove' ? ti('survivorFix.remove.confirm', { name: nameOf(removeUserId) }) : t('survivorFix.remove.apply')}
          </button>
        </div>
      )}

      {choice('tribal', t('survivorFix.tribal.title'), t('survivorFix.tribal.detail'))}
      {open === 'tribal' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3" data-testid="survivor-tribal-override">
          {target === undefined ? <p className="text-xs text-white/50">{t('survivorFix.tribal.loading')}</p>
            : target === null ? <p className="text-xs text-white/50">{t('survivorFix.tribal.none')}</p>
            : (
              <>
                <p className="text-xs text-white/60">{ti('survivorFix.tribal.week', { week: target.week })} <strong className="text-white">{target.eliminatedName ?? t('survivorFix.tribal.aManager')}</strong> {t('survivorFix.tribal.wasVotedOut')}</p>
                <label className="block text-xs text-white/60">{t('survivorFix.tribal.instead')}
                  <select aria-label={t('survivorFix.tribal.insteadAria')} className={field} value={tribalUserId} onChange={event => { setTribalUserId(event.target.value); setConfirming(null) }}>
                    <option value="">{t('survivorFix.chooseManager')}</option>
                    {target.candidates.map(candidate => <option key={candidate.userId} value={candidate.userId}>{candidate.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-white/60">{t('survivorFix.reason')}
                  <input aria-label={t('survivorFix.tribal.reasonAria')} className={field} value={tribalReason} onChange={event => setTribalReason(event.target.value)} />
                </label>
                <p className="text-xs text-white/50">
                  {target.resolved
                    ? ti('survivorFix.tribal.comesBack', { name: target.eliminatedName ?? t('survivorFix.tribal.they') })
                    : t('survivorFix.tribal.notCarriedOut')}
                  {' '}{t('survivorFix.tribal.latestOnly')}
                </p>
                <button type="button" disabled={busy || !tribalUserId} className={`${button} ${confirming === 'tribal' ? 'bg-red-500 text-white' : ''}`}
                  onClick={() => void run('tribal', { action: 'override_tribal', councilId: target.councilId, eliminateUserId: tribalUserId, notes: tribalReason.trim() || undefined },
                    json => overrideNotice(json as OverrideResult))}>
                  {confirming === 'tribal' ? ti('survivorFix.tribal.confirm', { name: tribalName(tribalUserId) }) : t('survivorFix.tribal.apply')}
                </button>
              </>
            )}
        </div>
      )}

      {!merged && choice('redraw', t('survivorFix.redraw.title'), t('survivorFix.redraw.detail'))}
      {!merged && open === 'redraw' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <p className="text-xs text-white/50">{t('survivorFix.redraw.note')}</p>
          <button type="button" disabled={busy} className={`${button} ${confirming === 'redraw' ? 'bg-amber-400 text-black' : ''}`}
            onClick={() => void run('redraw', { action: 'redraw_tribes', notes: 'Commissioner redrew the tribes' }, t('survivorFix.redraw.done'))}>
            {confirming === 'redraw' ? t('survivorFix.redraw.confirm') : t('survivorFix.redraw.apply')}
          </button>
        </div>
      )}

      {!merged && choice('merge', t('survivorFix.merge.title'), t('survivorFix.merge.detail'))}
      {!merged && open === 'merge' && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <p className="text-xs text-white/50">{t('survivorFix.merge.note')}</p>
          <button type="button" disabled={busy} className={`${button} ${confirming === 'merge' ? 'bg-amber-400 text-black' : ''}`}
            onClick={() => void run('merge', { action: 'force_phase', toPhase: 'merge', notes: 'Commissioner started the merge early' }, t('survivorFix.merge.done'))}>
            {confirming === 'merge' ? t('survivorFix.merge.confirm') : t('survivorFix.merge.apply')}
          </button>
        </div>
      )}
    </div>
  )
}
