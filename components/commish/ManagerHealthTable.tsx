'use client'

/**
 * 11b — the per-manager health table.
 *
 * ⚠ THE FRACTION'S COLOUR IS DERIVED FROM `status`, NOT RE-COMPUTED. Handoff
 * build rule 4 says the lineup completeness colour and the status tag must never
 * visually disagree. The only way to guarantee that is to have one of them read
 * the other, so `toneForStatus` is the single call both use. If you find
 * yourself writing a second threshold in this file, the rule is already broken —
 * the thresholds live in `lib/commissioner-hub/managerHealth.ts`.
 *
 * ⚠ AN UNREADABLE ROW IS A DASH, NOT A ZERO. `lineupsSet: null` means the
 * roster's shape could not be parsed. Rendering `0/11` would accuse a manager of
 * fielding nobody on the strength of our own parse failure.
 */

import type { ManagerHealthRow, ManagerHealthStatus } from '@/lib/commissioner-hub/managerHealth'

const STATUS_LABEL: Record<ManagerHealthStatus, string> = {
  active: 'Active',
  at_risk: 'At risk',
  inactive: 'Inactive',
  unknown: 'Unknown',
}

function toneForStatus(status: ManagerHealthStatus): 'good' | 'warn' | 'bad' | 'none' {
  if (status === 'active') return 'good'
  if (status === 'at_risk') return 'warn'
  if (status === 'inactive') return 'bad'
  return 'none'
}

/**
 * Relative time from a real timestamp. Coarse on purpose: "18 min ago" and
 * "4 days ago" are both actionable, "17 days, 4 hours" is noise in a table cell.
 */
function ago(iso: string | null): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '—'
  const mins = Math.floor((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} ago`
  return `${Math.round(days / 30)} months ago`
}

function initials(row: ManagerHealthRow): string {
  const source = row.managerName || row.teamName || ''
  const trimmed = source.replace(/^@/, '').trim()
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '·'
}

export function ManagerHealthTable({ rows }: { rows: ManagerHealthRow[] }) {
  if (rows.length === 0) {
    return <p className="af-cm-empty">No rosters found for this league yet.</p>
  }

  const inactive = rows.filter((r) => r.status === 'inactive').length
  const atRisk = rows.filter((r) => r.status === 'at_risk').length

  return (
    <div className="af-card" style={{ padding: 18 }} data-testid="manager-health-table">
      <div className="af-cm-section-head" style={{ marginBottom: 14 }}>
        <h2 className="af-cm-section-title" style={{ fontSize: 19 }}>
          Manager health
        </h2>
        <span className="af-cm-section-hint" style={{ marginLeft: 'auto' }}>
          {rows.length} manager{rows.length === 1 ? '' : 's'} &middot; {inactive} inactive &middot; {atRisk} at
          retention risk
        </span>
      </div>

      <div className="af-cm-table-wrap">
        <table className="af-cm-table">
          <thead>
            <tr>
              <th scope="col">Manager</th>
              <th scope="col">Lineups</th>
              <th scope="col">Moves</th>
              <th scope="col">Trades</th>
              <th scope="col">Last action</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = toneForStatus(row.status)
              const label =
                row.lineupsSet != null && row.expectedStarters != null
                  ? `${row.lineupsSet}/${row.expectedStarters}`
                  : '—'
              return (
                <tr key={row.rosterId}>
                  <td>
                    <span className="af-cm-mgr">
                      <span className="af-cm-badge" aria-hidden>
                        {row.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.avatarUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', borderRadius: 9, objectFit: 'cover' }}
                          />
                        ) : (
                          initials(row)
                        )}
                      </span>
                      <span className="af-cm-mgr-name">
                        {/*
                          Both names when both resolved, because a commissioner
                          thinks in team names and messages handles. Neither is
                          invented: an unclaimed team legally has no owner row.
                        */}
                        {row.managerName ? `@${row.managerName.replace(/^@/, '')}` : row.teamName || 'Unclaimed team'}
                        {row.managerName && row.teamName ? (
                          <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {row.teamName}</span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td className="af-cm-lineups af-num" data-tone={row.lineupsSet == null ? 'none' : tone}>
                    {label}
                  </td>
                  <td className="af-num">{row.moves}</td>
                  <td className="af-num">{row.trades}</td>
                  <td style={{ color: 'var(--muted)' }}>{ago(row.lastActionAt)}</td>
                  <td>
                    <span className="af-cm-mstatus af-num" data-tone={tone === 'none' ? undefined : tone}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ManagerHealthTable
