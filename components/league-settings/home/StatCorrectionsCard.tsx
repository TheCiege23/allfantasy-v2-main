'use client'

import { useEffect, useState } from 'react'
import type { StatCorrectionView } from '@/lib/stat-corrections/statCorrectionService'

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Stat corrections for the last sealed week (lib/stat-corrections): which scores would change if the
 * league office's corrected stats were applied, and whether a result would flip. Free leagues: shown
 * only — the commissioner decides, using the score adjustments below. "Extended scoring corrections"
 * (AF Commissioner, lib/stat-corrections/extendedCorrections.ts): applied automatically, for 14 days.
 */
export function StatCorrectionsCard({ leagueId }: { leagueId: string }) {
  const [view, setView] = useState<StatCorrectionView | null>(null)
  const [error, setError] = useState(false)
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

  useEffect(() => {
    let live = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/operations?view=stat_corrections`, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as StatCorrectionView
        if (live) setView(data)
      })
      .catch(() => live && setError(true))
    return () => {
      live = false
    }
  }, [leagueId])

  if (error) return null
  if (!view) return <p className="lsh-help" role="status">Checking for stat corrections…</p>
  if (!view.covered) return null

  const latest = view.latest
  const ext = view.extended
  const autoApplied = Boolean(ext?.enabled && !ext.refusal)
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
              ? `Week ${latest.week}: the league office changed some stats after the week was final. AllFantasy applied them as score adjustments, and the standings follow.`
              : `Week ${latest.week}: the league office changed some stats after the week was final. Results and standings have not changed. To apply a correction, add a score adjustment below.`}
          </p>
          <ul className="space-y-1 pt-1">
            {latest.matchups.map((m) => (
              <li key={m.matchupId} className="text-[13px]" data-testid="stat-correction-matchup">
                <span className="tabular-nums">
                  {m.home.teamName} {m.home.before.toFixed(2)} → <strong>{m.home.after.toFixed(2)}</strong> vs {m.away.teamName}{' '}
                  {m.away.before.toFixed(2)} → <strong>{m.away.after.toFixed(2)}</strong>
                </span>
                {m.resultFlipped && <strong className="lsh-error"> Result would change</strong>}
              </li>
            ))}
          </ul>
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
      {latest && latest.unchecked > 0 && (
        <p className="lsh-help">
          {latest.unchecked} starter{latest.unchecked === 1 ? '' : 's'} could not be re-checked: no stat line to compare.
        </p>
      )}
      {latest && <p className="lsh-help">Team defenses and players dropped since that week are not re-checked yet.</p>}
    </div>
  )
}
