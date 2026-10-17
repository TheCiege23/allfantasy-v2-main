import Link from 'next/link'
import SyncNowButton from '../SyncNowButton'
import SyncPauseButton from '../SyncPauseButton'
import RemoveLeagueButton from '../RemoveLeagueButton'
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
    rostersReadAt,
    consecutiveFailures,
    lastError,
    rows,
    coarse,
    orphanedRun,
    providerGone,
    canRemove,
  } = data
  const platformLabel = platformName(league.platform)

  return (
    <div className="af-sy">
      <header className="af-sy-head">
        <p className="af-label af-sy-eyebrow">{league.name}</p>
        <div className="af-sy-title-row">
          <h1 className="af-display af-sy-title">Sync</h1>
          <span className="af-sy-status af-label" data-status={status}>
            {status === 'paused'
              ? 'Account sync paused'
              : status === 'gone'
                ? `Gone from ${platformLabel}`
                : status === 'ok'
                  ? 'All synced'
                  : status === 'attention'
                    ? 'Needs attention'
                    : 'Never synced'}
          </span>
        </div>
        <p className="af-sy-sub">
          What AllFantasy reads from {league.platform === 'manual' ? 'your platform' : league.platform}{' '}
          for this league, and when we last read it.
        </p>
      </header>

      {data.syncKey ? <>
        {!data.syncPaused ? <SyncNowButton onlyKey={data.syncKey} eligibleCount={1} /> : null}
        <SyncPauseButton leagueId={league.id} paused={data.syncPaused === true} />
      </> : (
        <p className="af-sy-sub">This league has no supported external connection to refresh.</p>
      )}
      {/* ── The stuck-run warning ───────────────────────────────────── */}
      {orphanedRun && !data.syncPaused ? (
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

      {/*
        ── The provider no longer has this league ──────────────────────
        Not a failure and not a retry loop: the provider answered, and the answer was "no such
        league". Faster collection cannot fix that, so this says what happened and offers the three
        things that can — check now, import the league's new home, or remove this copy.
      */}
      {providerGone && !data.syncPaused ? (
        <div className="af-sy-alert" data-tone="warn" data-testid="league-sync-provider-gone">
          <span className="af-label">{platformLabel} no longer has this league</span>
          <p>
            When we last asked {platformLabel} ({new Date(providerGone.checkedAt).toLocaleString()}), it
            said this league does not exist. That usually means it was deleted, or the commissioner
            started a new season under a new league ID. Nothing on this page is being refreshed until
            that changes. We check again once a day on our own; "Sync this league" above checks now.
          </p>
          <p>Everything already imported — history, trades, standings — stays readable here.</p>
          <div className="af-sy-alert-actions">
            <Link href={manageHref} className="af-btn af-sy-alert-cta">
              Import the new league
            </Link>
            {canRemove ? (
              <RemoveLeagueButton leagueId={league.id} leagueName={league.name} platformLabel={platformLabel} />
            ) : null}
          </div>
        </div>
      ) : null}

      {consecutiveFailures > 0 && !data.syncPaused && !providerGone ? (
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

      {data.syncPaused && lastError ? <details className="af-sy-alert">
        <summary>Latest recorded sync error</summary><p>{lastError}</p>
      </details> : null}

      {/* ── Connection ──────────────────────────────────────────────── */}
      <section className="af-sy-conn" aria-label="Platform connection">
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
          <span className="af-label">{rostersReadAt ? 'Last full read' : 'Last read'}</span>
          {/*
            ⚠ "WE LAST READ", NOT "DATA IS N OLD". The stored value is our own
            collection time; the provider publishes no per-league data
            timestamp, and the column reserved for one is deliberately null.
          */}
          <span className="af-sy-conn-when af-num">{describeWhen(lastReadAt)}</span>
          {/*
            The five-minute lane's read of rosters and transactions, which runs far more often
            than the full read above. Shown only when it has completed here — a league outside
            the lane (offseason, an older season) has nothing honest to put on this line.
          */}
          {rostersReadAt ? (
            <span className="af-sy-conn-lane">
              Rosters &amp; transactions{' '}
              <span className="af-num">{describeWhen(rostersReadAt)}</span>
            </span>
          ) : null}
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

const PLATFORM_NAMES: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MyFantasyLeague',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? (platform === 'manual' ? 'your platform' : platform)
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
