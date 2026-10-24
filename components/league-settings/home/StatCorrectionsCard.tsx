'use client'

import { useEffect, useState } from 'react'
import type { StatCorrectionView } from '@/lib/stat-corrections/statCorrectionService'

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Stat corrections for the last sealed week (lib/stat-corrections): which scores would change if the
 * league office's corrected stats were applied, and whether a result would flip. Read-only — results
 * and standings stay as sealed; the commissioner decides, using the score adjustments below.
 */
export function StatCorrectionsCard({ leagueId }: { leagueId: string }) {
  const [view, setView] = useState<StatCorrectionView | null>(null)
  const [error, setError] = useState(false)

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
            Week {latest.week}: the league office changed some stats after the week was final. Results and standings have not
            changed. To apply a correction, add a score adjustment below.
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
