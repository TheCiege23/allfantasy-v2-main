import { Dash34Time } from '@/components/core-app/screens/Dashboard34Live'
import { PlayerSearch } from '@/components/core-app/dash-v2/PlayerSearch'

/**
 * Dashboard v2 top bar.
 *
 * ⚠ EVERY FIELD HERE IS PASSED IN, NONE INVENTED. The handoff's bar reads
 * "Sunday, 11:56 AM · Week 11 · 7 teams live today · ALL-PRO PLAN · 238/500
 * Chimmy tokens · SYNCED 40s". Three of those cannot be produced on this data:
 *
 *   - "7 teams live today" needs live scoring. No league has ever synced.
 *   - "SYNCED 40s" needs a sync timestamp. `lastSyncedAt` is null on all 98
 *     leagues, so the bar says never synced rather than inventing an age.
 *   - a token BALANCE needs a metered account. What the resolver exposes is the
 *     plan and whether Chimmy is available, so that is what is shown.
 *
 * The clock goes through Dash34Time for the same reason the feed does: the
 * server's instant and the reader's time zone cannot agree at first paint.
 */
export function TopBar({
  nowIso,
  weekLabel = null,
  planName = null,
  syncedLabel = null,
  leagueCount = null,
}: {
  /** Server instant; localised after hydration. */
  nowIso: string
  weekLabel?: string | null
  planName?: string | null
  /** Null when nothing has ever synced — rendered as an explicit state. */
  syncedLabel?: string | null
  leagueCount?: number | null
}) {
  return (
    <header className="af-d2-topbar">
      <div className="af-d2-topbar-when">
        <span className="af-d2-topbar-time af-num">
          <Dash34Time iso={nowIso} />
        </span>
        <span className="af-d2-topbar-sub af-num">
          {[weekLabel, leagueCount != null ? `${leagueCount} leagues` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {/*
        Real autocomplete now, but it kept the property the old link had: the
        control is a <form> whose action is the full search page, so it still
        works before hydration and without JavaScript. The suggestion list is an
        enhancement on top of that, not a replacement for it. See PlayerSearch.
      */}
      <PlayerSearch leagueCount={leagueCount} />

      <div className="af-d2-topbar-right">
        {planName ? <span className="af-d2-topbar-plan af-num">{planName}</span> : null}
        <span
          className={`af-d2-topbar-sync af-num${syncedLabel ? '' : ' is-never'}`}
          title={syncedLabel ? undefined : 'No league has ever synced'}
        >
          {syncedLabel ?? 'NEVER SYNCED'}
        </span>
      </div>
    </header>
  )
}

export default TopBar
