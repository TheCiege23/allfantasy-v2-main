'use client'

import { useCallback, useEffect, useState } from 'react'
import { MAX_ADJUSTMENT_POINTS, REASON_MAX, REASON_MIN, formatAdjustment, type ScoreAdjustment } from '@/lib/score-adjustments/scoreAdjustments'
import type { AdjustmentWeekView } from '@/lib/score-adjustments/scoreAdjustmentService'

const url = (leagueId: string) => `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/operations`

type Draft = { matchupId: string; rosterId: string; name: string; points: string; reason: string }
/** Marking one game final by hand: the game and the reason being typed. */
type FinalDraft = { matchupId: string; label: string; reason: string }

/**
 * Commissioner score adjustments (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free): add or take back
 * points on one team's score in one matchup, with a required reason that goes to the audit log.
 * Standings follow the adjusted score. Rules live server-side (lib/score-adjustments).
 */
export function ScoreAdjustmentsEditor({ leagueId }: { leagueId: string }) {
  const [view, setView] = useState<AdjustmentWeekView | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [finalDraft, setFinalDraft] = useState<FinalDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const load = useCallback(async (w: number | null) => {
    setLoadError(null)
    try {
      const res = await fetch(`${url(leagueId)}?view=score_adjustments${w != null ? `&week=${w}` : ''}`, { credentials: 'include', cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as AdjustmentWeekView & { error?: string }
      if (!res.ok) {
        setLoadError(data.error || 'Could not load this week’s matchups.')
        return
      }
      setView(data)
      setWeek(data.week)
    } catch {
      setLoadError('Could not reach the server. Try again.')
    }
  }, [leagueId])

  useEffect(() => {
    void load(null)
  }, [load])

  const post = async (body: Record<string, unknown>, success: string) => {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const res = await fetch(url(leagueId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error || 'Could not save the change.')
        return false
      }
      setOk(success)
      await load(week)
      return true
    } catch {
      setError('Could not reach the server. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <p className="lsh-error" role="alert">{loadError}</p>
  if (!view) return <p className="lsh-help" role="status">Loading matchups…</p>

  // Adjustments are points only. A head-to-head category league still has games to mark final; a
  // rotisserie league has no games at all.
  const pointsLeague = view.scoringMode === 'points'
  if (!pointsLeague && view.scoringMode !== 'h2h_category') {
    return <p className="lsh-help">Score adjustments are for points leagues. In a category league the score is categories won.</p>
  }

  const points = draft ? Number(draft.points) : NaN
  const reason = draft?.reason.trim() ?? ''
  const draftValid =
    Number.isFinite(points) && points !== 0 && Math.abs(points) <= MAX_ADJUSTMENT_POINTS && Math.round(points * 100) / 100 === points &&
    reason.length >= REASON_MIN && reason.length <= REASON_MAX
  const nameOf = (rosterId: string) => view.matchups.flatMap((m) => m.teams).find((t) => t.rosterId === rosterId)?.name ?? 'Team'

  return (
    <div className="space-y-4" data-testid="score-adjustments">
      <div className="lsh-field-card">
        <label className="lsh-field-label" htmlFor="score-adj-week">Week</label>
        <select id="score-adj-week" value={week ?? ''} onChange={(e) => { setDraft(null); setOk(null); setError(null); void load(Number(e.target.value)) }}>
          {view.weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
        </select>
        {pointsLeague ? (
          <p className="lsh-help">
            Add or take away points for a stat-correction dispute, a penalty or a ruling. Standings use the adjusted score, and a later stat sync keeps it. Every change, with its reason, goes to the league audit log.
          </p>
        ) : (
          <p className="lsh-help">
            Score adjustments are for points leagues. In a category league the score is categories won. You can still mark a game final here.
          </p>
        )}
      </div>

      {view.matchups.length === 0 && <p className="lsh-help">No head-to-head matchups this week.</p>}
      <ul className="space-y-2">
        {view.matchups.map((m) => (
          <li key={m.matchupId} className="lsh-field-card" data-testid="score-adj-matchup">
            {m.teams.map((t) => (
              <div key={t.rosterId} className="flex items-center justify-between gap-3 py-1">
                <span className="min-w-0 truncate text-[14px]">{t.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[14px] font-semibold tabular-nums">{pointsLeague ? t.score.toFixed(2) : String(t.score)}</span>
                  {t.adjustment !== 0 && <span className="text-[12px] tabular-nums" aria-label={`includes ${formatAdjustment(t.adjustment)} adjustment`}>({formatAdjustment(t.adjustment)})</span>}
                  {pointsLeague && (
                    <button type="button" className="lsh-secondary" disabled={busy}
                      onClick={() => { setOk(null); setError(null); setDraft({ matchupId: m.matchupId, rosterId: t.rosterId, name: t.name, points: '', reason: '' }) }}>
                      Adjust
                    </button>
                  )}
                </span>
              </div>
            ))}
            {pointsLeague && m.status !== 'final' && <p className="lsh-help">In progress: the adjustment stays on top as the score updates.</p>}
            {m.manualFinal && <p className="lsh-help" data-testid="score-adj-manual-final">Marked final by the commissioner: {m.manualFinal.reason}</p>}
            <div className="flex justify-end pt-1">
              {m.manualFinal ? (
                <button type="button" className="lsh-secondary" disabled={busy} data-testid="score-adj-reopen"
                  onClick={() => void post({ action: 'matchup_reopen', matchupId: m.matchupId }, 'Reopened. The next score update scores this game again.')}>
                  Reopen game
                </button>
              ) : m.status !== 'final' ? (
                <button type="button" className="lsh-secondary" disabled={busy} data-testid="score-adj-mark-final"
                  onClick={() => { setOk(null); setError(null); setDraft(null); setFinalDraft({ matchupId: m.matchupId, label: m.teams.map((t) => t.name).join(' vs '), reason: '' }) }}>
                  Mark final
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <div className="lsh-field-card" data-testid="score-adj-form">
          <p className="lsh-field-label">Adjust {draft.name}</p>
          <label className="lsh-help" htmlFor="score-adj-points">Points (use a minus sign for a penalty)</label>
          <input id="score-adj-points" type="number" inputMode="decimal" step="0.01" value={draft.points}
            onChange={(e) => setDraft({ ...draft, points: e.target.value })} />
          <label className="lsh-help" htmlFor="score-adj-reason">Reason (shows in the audit log)</label>
          <input id="score-adj-reason" type="text" maxLength={REASON_MAX} value={draft.reason}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
          <div className="flex gap-2 pt-2">
            <button type="button" className="lsh-primary" disabled={!draftValid || busy}
              onClick={async () => {
                const done = await post({ action: 'score_adjustment_add', matchupId: draft.matchupId, rosterId: draft.rosterId, points, reason }, `Saved: ${draft.name} ${formatAdjustment(points)}.`)
                if (done) setDraft(null)
              }}>
              {busy ? 'Saving…' : 'Save adjustment'}
            </button>
            <button type="button" className="lsh-secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      {finalDraft && (
        <div className="lsh-field-card" data-testid="score-final-form">
          <p className="lsh-field-label">Mark final: {finalDraft.label}</p>
          <p className="lsh-help">
            The game closes at the score shown now and counts in the standings. Later stat updates will not change it. To change the score afterwards, {pointsLeague ? 'add an adjustment or reopen the game' : 'reopen the game'}.
          </p>
          <label className="lsh-help" htmlFor="score-final-reason">Reason (shows in the audit log)</label>
          <input id="score-final-reason" type="text" maxLength={REASON_MAX} value={finalDraft.reason}
            onChange={(e) => setFinalDraft({ ...finalDraft, reason: e.target.value })} />
          <div className="flex gap-2 pt-2">
            <button type="button" className="lsh-primary"
              disabled={busy || finalDraft.reason.trim().length < REASON_MIN || finalDraft.reason.trim().length > REASON_MAX}
              onClick={async () => {
                const done = await post({ action: 'matchup_finalize', matchupId: finalDraft.matchupId, reason: finalDraft.reason.trim() }, `Marked final: ${finalDraft.label}.`)
                if (done) setFinalDraft(null)
              }}>
              {busy ? 'Saving…' : 'Mark final'}
            </button>
            <button type="button" className="lsh-secondary" disabled={busy} onClick={() => setFinalDraft(null)}>Cancel</button>
          </div>
        </div>
      )}

      {view.adjustments.length > 0 && (
        <div className="lsh-field-card">
          <p className="lsh-field-label">Adjustments this week</p>
          <ul className="space-y-1">
            {view.adjustments.map((a: ScoreAdjustment) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-[13px]" data-testid="score-adj-row">
                <span className="min-w-0">
                  <strong className="tabular-nums">{formatAdjustment(a.points)}</strong> {nameOf(a.rosterId)} — {a.reason}
                </span>
                <button type="button" className="lsh-secondary shrink-0" disabled={busy}
                  onClick={() => void post({ action: 'score_adjustment_remove', adjustmentId: a.id }, `Removed ${formatAdjustment(a.points)} for ${nameOf(a.rosterId)}.`)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="lsh-error" role="alert">{error}</p>}
      {ok && <p className="lsh-ok" role="status">{ok}</p>}
    </div>
  )
}
