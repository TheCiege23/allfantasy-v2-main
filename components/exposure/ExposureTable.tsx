'use client'

/**
 * 12b — the exposure audit table.
 *
 * ⚠ "OVEREXPOSED" IS A TWO-PART RULE AND IT IS STATED ON THE PAGE. Build rule 1:
 * a player counts only when he is in HALF OR MORE of your leagues AND you have
 * more than one league. The second clause is the one nobody guesses — owning
 * your only team's roster is not a choice you made, so a single-league user is
 * never told they are overexposed to anyone. The banner above the table says the
 * rule verbatim; `isOverexposed` below is the same rule in code, and the two must
 * not drift.
 *
 * ⚠ STATUS IS ADDITIVE, NOT AN ENUM. Build rule 3 — a player can be both
 * overexposed and injured, and collapsing that into one tag would hide whichever
 * lost. Barkley in the mock is the case: injured while below the exposure line.
 *
 * ⚠ THE SLOT SPLIT IS THREE SEGMENTS, NOT AN "OWNED" BAR. Build rule 2: exposure
 * to a player you START in four leagues is a completely different risk from a
 * bench stash in four, and a single bar cannot tell you which you have.
 */

/**
 * Mirrors the fields this table uses from `/api/player-portfolio`'s
 * `CrossLeaguePlayerPortfolioItem`. That endpoint already carries every column
 * 12b needs — the slot split, a real injury status with freshness, named league
 * appearances, and an `identityConfidence` that distinguishes a player we cannot
 * name from one we simply have not injured. Built on it rather than on
 * `/api/players/my-exposure`, which returns neither league names nor injuries.
 */
/*
 * ⚠ FROM `exposureThreshold`, NEVER FROM `crossLeaguePlayerPortfolio`. That
 * module holds the same constant but imports prisma, so pulling it in here would
 * ship the database client to the browser.
 */
import { OVEREXPOSED_THRESHOLD } from '@/lib/shared-services/league-hub/exposureThreshold'

export type ExposureRow = {
  playerId: string
  /** `null` when identity is unresolved — never a guessed name. */
  name: string | null
  position: string | null
  team: string | null
  leagueCount: number
  leagueNames: string[]
  startingCount: number
  benchCount: number
  irTaxiCount: number
  /** 0-1 share of the user's connected leagues. */
  exposurePercent: number
  injuryStatus: string | null
  identityResolved: boolean
}

export type ExposureFilter = 'all' | 'starting' | 'injured' | 'threshold'

/** Re-exported so the audit header can label the filter chip with the real number. */
export { OVEREXPOSED_THRESHOLD }

/**
 * Designations that mean "cannot or might not play". Compared case-insensitively
 * against the provider's own string. Anything else — `Active`, an empty value, a
 * word we have not seen — is NOT treated as an injury, because over-reporting an
 * injury is how a manager benches a healthy starter.
 */
const INJURY_WORDS = ['out', 'ir', 'injured reserve', 'doubtful', 'questionable', 'pup', 'susp', 'dnr']

export function isInjured(status: string | null): boolean {
  if (!status) return false
  const s = status.trim().toLowerCase()
  if (!s || s === 'active' || s === 'healthy') return false
  return INJURY_WORDS.some((w) => s.includes(w))
}

/**
 * Build rule 1, in code. Both clauses, or it is not overexposure.
 *
 * The threshold is imported from `crossLeaguePlayerPortfolio`, which already
 * applied this exact pair of conditions when assembling Chimmy's overexposed
 * list. One constant, so the sentence printed above the table and the number the
 * engine filters on can never drift apart.
 */
export function isOverexposed(row: ExposureRow, connectedLeagueCount: number): boolean {
  if (connectedLeagueCount <= 1) return false
  if (row.leagueCount <= 1) return false
  return row.leagueCount / connectedLeagueCount >= OVEREXPOSED_THRESHOLD
}

function SlotSplit({ row }: { row: ExposureRow }) {
  const total = row.startingCount + row.benchCount + row.irTaxiCount
  if (total <= 0) return <span className="af-xp-slot-empty af-num">—</span>

  const pct = (n: number) => (n / total) * 100
  const label = [
    row.startingCount > 0 ? `${row.startingCount} start` : null,
    row.benchCount > 0 ? `${row.benchCount} bench` : null,
    row.irTaxiCount > 0 ? `${row.irTaxiCount} IR` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span className="af-xp-slot">
      <span className="af-xp-slot-bar" aria-hidden>
        {row.startingCount > 0 ? (
          <span className="af-xp-seg" data-slot="start" style={{ width: `${pct(row.startingCount)}%` }} />
        ) : null}
        {row.benchCount > 0 ? (
          <span className="af-xp-seg" data-slot="bench" style={{ width: `${pct(row.benchCount)}%` }} />
        ) : null}
        {row.irTaxiCount > 0 ? (
          <span className="af-xp-seg" data-slot="ir" style={{ width: `${pct(row.irTaxiCount)}%` }} />
        ) : null}
      </span>
      <span className="af-xp-slot-label af-num">{label}</span>
    </span>
  )
}

export function ExposureTable({
  rows,
  connectedLeagueCount,
  filter,
}: {
  rows: ExposureRow[]
  connectedLeagueCount: number
  filter: ExposureFilter
}) {
  /*
   * ⚠ FILTERS ARE SLICES, NEVER REDEFINITIONS. Build rule 5: switching to
   * "Injured" changes which rows you can see and nothing about what overexposed
   * means. The tag on a visible row is identical under every filter.
   */
  const visible = rows.filter((r) => {
    if (filter === 'starting') return r.startingCount > 0
    if (filter === 'injured') return isInjured(r.injuryStatus)
    if (filter === 'threshold')
      return connectedLeagueCount > 0 && r.leagueCount / connectedLeagueCount >= OVEREXPOSED_THRESHOLD
    return true
  })

  if (visible.length === 0) {
    return (
      <p className="af-cm-empty">
        {rows.length === 0
          ? 'No rostered players found across your connected leagues yet. This fills in once a league finishes syncing.'
          : 'No players match this filter.'}
      </p>
    )
  }

  return (
    <div className="af-cm-table-wrap">
      <table className="af-cm-table af-xp-table">
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Leagues</th>
            <th scope="col">Slot split</th>
            <th scope="col">Exposure</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const over = isOverexposed(row, connectedLeagueCount)
            const injured = isInjured(row.injuryStatus)
            const pct = Math.round(row.exposurePercent * 100)
            return (
              <tr key={row.playerId} className="af-xp-row" data-over={over ? 'true' : 'false'}>
                <td>
                  <span className="af-cm-mgr">
                    <span className="af-cm-badge">{row.position ?? '—'}</span>
                    <span style={{ minWidth: 0 }}>
                      {/*
                        ⚠ AN UNRESOLVED PLAYER KEEPS HIS SLOT AND LOSES HIS NAME.
                        Build rule 4. The exposure engine honestly returns a null
                        name for rosters that carry only a platform id, and the
                        footer commits to showing that rather than guessing —
                        a wrong name here would send someone to trade the wrong
                        player.
                      */}
                      <span className="af-cm-mgr-name" style={{ display: 'block' }}>
                        {row.identityResolved && row.name ? row.name : 'Unnamed roster slot'}
                      </span>
                      <span className={`af-xp-sub${injured ? ' is-injured' : ''}`}>
                        {[
                          row.team,
                          injured ? row.injuryStatus : null,
                          row.leagueNames.length > 0 ? row.leagueNames.join(', ') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Rostered — AllFantasy cannot name this player yet'}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="af-num">
                  {row.leagueCount} / {connectedLeagueCount}
                </td>
                <td>
                  <SlotSplit row={row} />
                </td>
                <td className="af-num af-xp-pct" data-over={over ? 'true' : 'false'}>
                  {pct}%
                </td>
                <td>
                  {/* Additive: both tags can appear on one row. */}
                  <span className="af-xp-tags">
                    {over ? (
                      <span className="af-cm-mstatus af-num" data-tone="warn">
                        Overexposed
                      </span>
                    ) : null}
                    {injured ? (
                      <span className="af-cm-mstatus af-num" data-tone="bad">
                        Injury risk
                      </span>
                    ) : null}
                    {!over && !injured ? <span className="af-xp-slot-empty af-num">–</span> : null}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default ExposureTable
