'use client'

/**
 * Standings 9a — the standings table.
 *
 * Rebuilt to the 9a handoff (rank · team · W-L · PF · PA · streak · all-play, with a full-width
 * playoff-cut divider row and an accent highlight on the viewer's own row).
 *
 * ⚠ THREE BEHAVIOURS PREDATE THE HANDOFF AND ARE DELIBERATELY KEPT. The handoff is silent on
 * them rather than rejecting them, and each is live functionality:
 *
 *   CAT W-L-T   In `h2h_category`/`roto` leagues this is the PRIMARY STANDINGS SORT KEY. The
 *               handoff's column list has no equivalent, and dropping it would leave category
 *               leagues showing an order their own scoring does not produce.
 *   ties        The handoff renders records as "9–2". Real leagues have ties, so the record
 *               stays W-L-T and collapses to W-L only when there are none.
 *   test ids    `standings-table`, `standings-row-{rosterId}`, `standings-header-cat`,
 *               `standings-cat-{rosterId}` and `data-scoring-mode` are a Playwright contract.
 *               PricingV4 dropped its testids in #501 and #506 had to restore them.
 *
 * ⚠ NO PLAYOFF ODDS. The handoff's odds bar/percentage, "eliminated" state and clinch language
 * are Monte Carlo output ("3% of sims") and no such engine exists in this repo. Rendering a
 * plausible-looking percentage would be the trade-grade "C" failure — a number that reads as
 * knowledge while meaning nothing. The column is omitted until a real simulation backs it.
 */

export type StandingsRow = {
  rosterId: string
  teamName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  rank: number | null
  /** H2H-category mode only; 0 for points-mode leagues. */
  categoryWinsFor?: number
  categoryLossesFor?: number
  categoryTiesFor?: number
  /** Derived from TeamWeekResult by the API. "—" when no week has been played. */
  streak?: string
  allPlay?: string
}

type Props = {
  rows: StandingsRow[]
  /**
   * Scoring mode drives which columns render. `h2h_category` (and `roto`)
   * add a "CAT" column showing cumulative category wins-losses-ties; the
   * primary sort key in category-mode leagues.
   */
  scoringMode?: 'points' | 'h2h_category' | 'roto'
  /** The viewer's own roster, highlighted per the handoff. Null highlights nothing. */
  viewerRosterId?: string | null
  /** Teams making the playoffs; draws the cut divider after that rank. Null omits the divider. */
  playoffCut?: number | null
}

/** Two-letter tile standing in for a team logo, as drawn in the handoff. */
function TeamMark({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.07] font-mono text-[11px] font-bold text-white/70"
    >
      {initials || '—'}
    </span>
  )
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`
}

export default function StandingsTable({
  rows,
  scoringMode = 'points',
  viewerRosterId = null,
  playoffCut = null,
}: Props) {
  const showCategories = scoringMode === 'h2h_category' || scoringMode === 'roto'
  const gridCols = showCategories
    ? 'grid-cols-[40px_minmax(0,1fr)_repeat(6,minmax(0,84px))]'
    : 'grid-cols-[40px_minmax(0,1fr)_repeat(5,minmax(0,84px))]'

  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a1228]/90"
      data-testid="standings-table"
      data-scoring-mode={scoringMode}
    >
      <div
        className={`grid ${gridCols} gap-2 border-b border-white/10 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white/40`}
      >
        <div>#</div>
        <div>Team</div>
        <div className="text-right">W-L</div>
        {showCategories ? (
          <div
            className="text-right text-cyan-200/80"
            title="Cumulative category wins-losses-ties (primary standings sort key)"
            data-testid="standings-header-cat"
          >
            CAT
          </div>
        ) : null}
        <div className="text-right">PF</div>
        <div className="text-right">PA</div>
        <div className="text-right">Strk</div>
        <div className="text-right" title="Record against every other team, every week">
          All-play
        </div>
      </div>

      <ul>
        {rows.map((r, i) => {
          const isViewer = viewerRosterId != null && r.rosterId === viewerRosterId
          /*
           * PA turns --bad only when it materially explains an underperforming record (handoff
           * rule 4) — a team conceding more than it scores. Never applied uniformly, or the
           * colour stops carrying information.
           */
          const paIsBadLuck = r.pointsAgainst > r.pointsFor
          const showCutAfter =
            playoffCut != null && r.rank != null && r.rank === playoffCut && i < rows.length - 1

          return (
            <li key={r.rosterId} className="contents">
              <div
                className={`grid ${gridCols} items-center gap-2 border-b border-white/5 px-4 py-3 text-sm ${
                  isViewer ? 'bg-cyan-400/[0.09]' : ''
                }`}
                data-testid={`standings-row-${r.rosterId}`}
                data-viewer={isViewer ? 'true' : undefined}
              >
                <span className={`font-mono text-xs ${isViewer ? 'text-cyan-300' : 'text-white/45'}`}>
                  {r.rank ?? '—'}
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  <TeamMark name={r.teamName} />
                  <span className="min-w-0">
                    <span
                      className={`block truncate font-bold ${isViewer ? 'text-cyan-300' : 'text-white'}`}
                    >
                      {r.teamName}
                    </span>
                    {isViewer ? (
                      <span className="block text-[11px] text-white/45">you</span>
                    ) : null}
                  </span>
                </span>
                <span className="text-right font-mono tabular-nums text-white/85">
                  {formatRecord(r.wins, r.losses, r.ties)}
                </span>
                {showCategories ? (
                  <span
                    className="text-right font-mono tabular-nums font-semibold text-cyan-200"
                    data-testid={`standings-cat-${r.rosterId}`}
                  >
                    {r.categoryWinsFor ?? 0}-{r.categoryLossesFor ?? 0}-{r.categoryTiesFor ?? 0}
                  </span>
                ) : null}
                <span className="text-right font-mono tabular-nums text-white/85">
                  {r.pointsFor.toFixed(1)}
                </span>
                <span
                  className={`text-right font-mono tabular-nums ${
                    paIsBadLuck ? 'text-rose-400' : 'text-white/60'
                  }`}
                  title={paIsBadLuck ? 'Conceding more than they score' : undefined}
                >
                  {r.pointsAgainst.toFixed(1)}
                </span>
                <span
                  className={`text-right font-mono tabular-nums ${
                    r.streak?.startsWith('W')
                      ? 'text-emerald-400'
                      : r.streak?.startsWith('L')
                        ? 'text-rose-400'
                        : 'text-white/50'
                  }`}
                >
                  {r.streak ?? '—'}
                </span>
                <span className="text-right font-mono tabular-nums text-white/70">
                  {r.allPlay ?? '—'}
                </span>
              </div>

              {showCutAfter ? (
                <div
                  className="flex items-center gap-3 px-4 py-2"
                  data-testid="standings-playoff-cut"
                >
                  <span className="h-px flex-1 bg-amber-400/40" />
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-400">
                    Playoff cut · top {playoffCut}
                  </span>
                  <span className="h-px flex-1 bg-amber-400/40" />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
