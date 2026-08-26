import Link from 'next/link'
import type { LeagueSyncResult, SyncDataRow } from '@/lib/core-app/leagueSync'
import '@/components/core-app/af-league-sync.css'

/**
 * Screen 38a·10 — is THIS league fresh, and what did we actually read.
 *
 * ⚠ EVERY FRESHNESS LINE HERE SAYS "WE READ", NEVER "THIS DATA IS". The schema
 * is explicit that `lastSuccessfulSyncAt` is AllFantasy's own collection time
 * and not a provider-reported data timestamp — Sleeper exposes no dependable
 * per-league mtime, and the column reserved for one is deliberately null. "We
 * last read this 2 minutes ago" is supported; "this data is 2 minutes old" is
 * not, and they look identical if you are careless about the verb.
 *
 * ⚠ GREEN IS EARNED, NOT ASSUMED. The orphaned-run banner fires on the
 * killed-mid-body signature even when every other indicator looks healthy,
 * because everything else looking healthy IS the failure mode a stuck telemetry
 * row produces.
 */

export type LeagueSyncProps = {
  data: LeagueSyncResult
  /** The account-wide connect/re-sync surface, which this does not replace. */
  manageHref: string
}

function fmtDate(d: Date | string | null): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export function LeagueSync({ data, manageHref }: LeagueSyncProps) {
  if (!data.available) {
    return (
      <div className="af-sy">
        <header className="af-sy-head">
          <p className="af-label af-sy-eyebrow">{data.leagueName}</p>
          <h1 className="af-display af-sy-title">Sync</h1>
        </header>
        <div className="af-sy-blocked">
          <span className="af-sy-blocked-mark af-num" aria-hidden>
            —
          </span>
          <p>{data.reason}</p>
        </div>
      </div>
    )
  }

  const {
    league,
    connectedSince,
    seasonsOnFile,
    status,
    lastReadAt,
    consecutiveFailures,
    lastError,
    rows,
    coarse,
    orphanedRun,
  } = data

  return (
    <div className="af-sy">
      <header className="af-sy-head">
        <p className="af-label af-sy-eyebrow">{league.name}</p>
        <div className="af-sy-title-row">
          <h1 className="af-display af-sy-title">Sync</h1>
          <span className="af-sy-status af-label" data-status={status}>
            {status === 'ok' ? 'All synced' : status === 'attention' ? 'Needs attention' : 'Never synced'}
          </span>
        </div>
        <p className="af-sy-sub">
          What AllFantasy reads from {league.platform === 'manual' ? 'your platform' : league.platform}{' '}
          for this league, and when we last read it.
        </p>
      </header>

      {/* ── The stuck-run warning ───────────────────────────────────── */}
      {orphanedRun ? (
        <div className="af-sy-alert" data-tone="bad">
          <span className="af-label">Last run never finished</span>
          <p>
            The collector started at {new Date(orphanedRun.startedAt).toLocaleString()} and never
            reported a result — no rows read, no rows written, no completion. That is a job that was
            killed mid-run, not one that ran and found nothing. Anything below dated before then is
            the last good read, not the current state.
          </p>
        </div>
      ) : null}

      {consecutiveFailures > 0 ? (
        <div className="af-sy-alert" data-tone="warn">
          <span className="af-label">
            {consecutiveFailures} failed {consecutiveFailures === 1 ? 'run' : 'runs'} in a row
          </span>
          <p>
            {lastError
              ? lastError
              : 'The collector has failed repeatedly for this league. Reconnecting the platform is usually what fixes it.'}
          </p>
          <Link href={manageHref} className="af-btn af-sy-alert-cta">
            Reconnect this platform
          </Link>
        </div>
      ) : null}

      {/* ── Connection ──────────────────────────────────────────────── */}
      <section className="af-sy-conn">
        <div className="af-sy-conn-main">
          <span className="af-sy-platform af-platform" data-platform={league.platform}>
            {league.platform.toUpperCase()}
          </span>
          <div className="af-sy-conn-text">
            <span className="af-sy-conn-name">{league.name}</span>
            <span className="af-sy-conn-meta">
              Connected {fmtDate(connectedSince)}
              {seasonsOnFile.available ? (
                <> · {seasonsOnFile.data} {seasonsOnFile.data === 1 ? 'season' : 'seasons'} of history</>
              ) : null}
            </span>
          </div>
        </div>

        <div className="af-sy-conn-read">
          <span className="af-label">Last read</span>
          {/*
            ⚠ "WE LAST READ", NOT "DATA IS N OLD". The stored value is our own
            collection time; the provider publishes no per-league data
            timestamp, and the column reserved for one is deliberately null.
          */}
          <span className="af-sy-conn-when af-num">{describeWhen(lastReadAt)}</span>
          {coarse ? (
            <span className="af-sy-conn-coarse">
              from the league record — no per-run history has been written for this connection, so
              this is coarser than the per-scope detail below
            </span>
          ) : null}
        </div>
      </section>

      {/* ── What we read ────────────────────────────────────────────── */}
      <section className="af-sy-panel">
        <header className="af-sy-panel-head">
          <h2 className="af-label">What we read</h2>
          <span className="af-sy-panel-note">Per data type</span>
        </header>
        <ul className="af-sy-rows">
          {rows.map((r) => (
            <DataRow key={r.key} row={r} />
          ))}
        </ul>
      </section>

      <p className="af-sy-foot">
        AllFantasy is read-only on {league.platform === 'manual' ? 'your platform' : league.platform}
        . We never change a lineup, accept a trade or post a message — every change is still made
        there. <Link href={manageHref}>Manage connections</Link>
      </p>
    </div>
  )
}

function DataRow({ row }: { row: SyncDataRow }) {
  return (
    <li className="af-sy-row" data-kind={row.state.kind}>
      <span className="af-sy-row-mark" aria-hidden>
        {row.state.kind === 'by-design' ? '×' : row.state.kind === 'never' ? '—' : '●'}
      </span>
      <span className="af-sy-row-text">
        <span className="af-sy-row-label">{row.label}</span>
        <span className="af-sy-row-note">{row.note}</span>
      </span>
      <span className="af-sy-row-state">{row.state.detail}</span>
    </li>
  )
}

function describeWhen(d: Date | string | null): string {
  if (!d) return 'never'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return 'never'
  const mins = Math.floor((Date.now() - date.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default LeagueSync
