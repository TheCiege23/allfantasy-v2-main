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
 * league office's corrected stats were applied, whether a result would flip, and Apply — which posts
 * each team's correction as a score adjustment, so the sealed result, the standings and the audit log
 * move together. Nothing changes until the commissioner taps it.
 */
export function StatCorrectionsCard({ leagueId, onApplied }: { leagueId: string; onApplied?: () => void }) {
  const [view, setView] = useState<StatCorrectionView | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

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
  const pending = latest?.matchups.filter((m) => !m.fullyApplied) ?? []
  return (
    <div className="lsh-field-card" data-testid="stat-corrections">
      <p className="lsh-field-label">Stat corrections</p>
      {!latest ? (
        <p className="lsh-help">
          After a week is final, AllFantasy re-checks its stats for six days and lists any correction here. Nothing to show yet.
        </p>
      ) : latest.changes.length === 0 ? (
        <p className="lsh-help" data-testid="stat-corrections-none">
          No corrections for week {latest.week}. Last checked {when(latest.checkedAt)}; checks stop {when(latest.windowClosesAt)}.
        </p>
      ) : (
        <>
          <p className="lsh-help">
            Week {latest.week}: the league office changed some stats after the week was final. Nothing changes until you apply
            it. Applying adds each team&apos;s correction as a score adjustment, which updates the result, the standings and the
            league log.
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
                ) : (
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
