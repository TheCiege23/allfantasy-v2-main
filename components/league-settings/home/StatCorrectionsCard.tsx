'use client'

import { useCallback, useEffect, useState } from 'react'
import type { StatCorrectionView } from '@/lib/stat-corrections/statCorrectionService'
import { ScoreAdjustmentsEditor } from './ScoreAdjustmentsEditor'

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const opsUrl = (leagueId: string) => `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/operations`

/**
 * Stat corrections for the last sealed week (lib/stat-corrections): which scores would change if the
 * league office's corrected stats were applied, and whether a result would flip. Free leagues: the
 * commissioner taps Apply, which posts each team's correction as a score adjustment, so the sealed
 * result, the standings and the audit log move together. "Extended scoring corrections" (AF
 * Commissioner, lib/stat-corrections/extendedCorrections.ts): applied automatically, for 14 days.
 * Never in an elimination format or once playoff seeds are set — shown only.
 */
export function StatCorrectionsCard({ leagueId, onApplied }: { leagueId: string; onApplied?: () => void }) {
  const [view, setView] = useState<StatCorrectionView | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const setExtended = async (enabled: boolean) => {
    if (!view?.extended) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/operations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_extended_corrections', enabled }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof d?.error === 'string' ? d.error : 'Could not save.')
      setView((v) => (v?.extended ? { ...v, extended: { ...v.extended, enabled, windowDays: enabled ? 14 : 6 } } : v))
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${opsUrl(leagueId)}?view=stat_corrections`, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setView((await res.json()) as StatCorrectionView)
    } catch {
      setError(true)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const apply = async (matchupId: string) => {
    setBusy(matchupId)
    setMessage(null)
    try {
      const res = await fetch(opsUrl(leagueId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stat_correction_apply', matchupId }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; adjustmentsAdded?: number }
      if (!res.ok) {
        setMessage({ ok: false, text: data.error || 'Could not apply the correction.' })
        return
      }
      setMessage({
        ok: true,
        text: data.adjustmentsAdded ? 'Applied. Scores and standings are updated.' : 'Already applied. Nothing changed.',
      })
      await load()
      onApplied?.()
    } catch {
      setMessage({ ok: false, text: 'Could not reach the server. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  if (error) return null
  if (!view) return <p className="lsh-help" role="status">Checking for stat corrections…</p>
  if (!view.covered) return null

  const latest = view.latest
  const ext = view.extended
  const autoApplied = Boolean(ext?.enabled && !ext.refusal)
  /** Elimination formats and set playoff seeds: shown only, never applied by anyone. */
  const applyBlocked = Boolean(ext?.refusal)
  const pending = applyBlocked ? [] : latest?.matchups.filter((m) => !m.fullyApplied) ?? []
  return (
    <div className="lsh-field-card" data-testid="stat-corrections">
      <p className="lsh-field-label">Stat corrections</p>
      {ext ? (
        <div className="space-y-1 pb-2" data-testid="stat-corrections-extended">
          <label className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold">Extended scoring corrections{ext.available ? '' : ' · AF Commissioner'}</span>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={ext.enabled}
              disabled={saving || (!ext.available && !ext.enabled)}
              onChange={(e) => void setExtended(e.target.checked)}
              data-testid="stat-corrections-extended-toggle"
            />
          </label>
          <p className="lsh-help">
            {ext.refusal === 'elimination_format'
              ? 'In an elimination league a week can already have cost a team its season, so corrections are shown, never applied.'
              : ext.refusal === 'playoffs'
                ? 'Playoff seeds are set, so corrections are shown, never applied.'
                : 'On: AllFantasy checks the last two finished weeks for 14 days and applies any stat correction for you, moving the score and the standings. Off: corrections are shown here for six days and you decide.'}
          </p>
          {saveError ? <p className="lsh-error" role="status">{saveError}</p> : null}
        </div>
      ) : null}
      {!latest ? (
        <p className="lsh-help">
          After a week is final, AllFantasy re-checks its stats for {ext?.windowDays === 14 ? '14' : 'six'} days and lists any correction here. Nothing to show yet.
        </p>
      ) : latest.changes.length === 0 ? (
        <p className="lsh-help" data-testid="stat-corrections-none">
          No corrections for week {latest.week}. Last checked {when(latest.checkedAt)}; checks stop {when(latest.windowClosesAt)}.
        </p>
      ) : (
        <>
          <p className="lsh-help">
            {autoApplied
              ? `Week ${latest.week}: the league office changed some stats after the week was final. AllFantasy applies them as score adjustments, and the standings follow.`
              : applyBlocked
                ? `Week ${latest.week}: the league office changed some stats after the week was final. Results and standings have not changed.`
                : `Week ${latest.week}: the league office changed some stats after the week was final. Nothing changes until you apply it. Applying adds each team's correction as a score adjustment, which updates the result, the standings and the league log.`}
          </p>
          <ul className="space-y-2 pt-1">
            {latest.matchups.map((m) => (
              <li key={m.matchupId} className="text-[13px]" data-testid="stat-correction-matchup">
                <div className="tabular-nums">
                  {m.home.teamName} {m.home.before.toFixed(2)} → <strong>{m.home.after.toFixed(2)}</strong> vs {m.away.teamName}{' '}
                  {m.away.before.toFixed(2)} → <strong>{m.away.after.toFixed(2)}</strong>
                  {m.resultFlipped && <strong className="lsh-error"> Result changes</strong>}
                </div>
                {m.fullyApplied ? (
                  <span className="lsh-ok" data-testid="stat-correction-applied">Applied</span>
                ) : applyBlocked ? null : (
                  <button type="button" className="lsh-secondary" disabled={busy !== null} onClick={() => void apply(m.matchupId)}>
                    {busy === m.matchupId ? 'Applying…' : 'Apply'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {pending.length > 1 && (
            <button type="button" className="lsh-primary mt-2" disabled={busy !== null} onClick={() => void apply('all')}>
              {busy === 'all' ? 'Applying…' : `Apply all ${pending.length}`}
            </button>
          )}
          <ul className="space-y-1 pt-2">
            {latest.changes.map((c) => (
              <li key={`${c.rosterId}:${c.playerId}`} className="flex justify-between gap-3 text-[13px]" data-testid="stat-correction-player">
                <span className="min-w-0 truncate">
                  {c.playerName} ({c.teamName})
                </span>
                <span className="shrink-0 tabular-nums">
                  {c.before.toFixed(2)} → {c.after.toFixed(2)} <strong>{signed(c.delta)}</strong>
                </span>
              </li>
            ))}
          </ul>
          <p className="lsh-help pt-1">Last checked {when(latest.checkedAt)}; checks stop {when(latest.windowClosesAt)}.</p>
        </>
      )}
      {message && (
        <p className={message.ok ? 'lsh-ok' : 'lsh-error'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      {latest && latest.unchecked > 0 && (
        <p className="lsh-help">
          {latest.unchecked} starter{latest.unchecked === 1 ? '' : 's'} could not be re-checked: no stat line to compare.
        </p>
      )}
      {latest && <p className="lsh-help">Team defenses and players dropped since that week are not re-checked yet.</p>}
    </div>
  )
}

/** The Score adjustments page: corrections on top, and the adjustment list reloaded after an Apply. */
export function ScoreAdjustmentsWithCorrections({ leagueId }: { leagueId: string }) {
  const [version, setVersion] = useState(0)
  return (
    <div className="space-y-4">
      <StatCorrectionsCard leagueId={leagueId} onApplied={() => setVersion((v) => v + 1)} />
      <ScoreAdjustmentsEditor key={version} leagueId={leagueId} />
    </div>
  )
}
