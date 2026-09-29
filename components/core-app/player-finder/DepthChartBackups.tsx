import { groupCells, slotLabel, type BackupCell, type DepthChartView } from '@/lib/core-app/depthChart'

/**
 * "Next man up" — his team's depth chart at his spot, and for each player around him, where that
 * player is in your leagues (lib/core-app/depthChart.ts, loaded by depthChartBackups.ts).
 *
 * Free: the chart and roster presence are facts, the same footing as the league strip. What is yours
 * and what you can claim are listed league by league, because those are the moves; leagues where
 * someone else has him, or whose rosters we could not read, collapse to a count with their names.
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function names(cells: readonly BackupCell[]): string {
  return cells.map((c) => c.leagueName).join(', ')
}

function Presence({ cells, last }: { cells: readonly BackupCell[]; last: string }) {
  const g = groupCells(cells)
  return (
    <ul className="af-pf-dc-where">
      {g.yours.map((c) => (
        <li key={c.leagueId} className="af-pf-dc-cell is-yours">
          <span className="af-pf-dc-tag">Yours</span> {c.leagueName}
          {c.detail ? <span className="af-pf-dc-detail"> · {c.detail}</span> : null}
        </li>
      ))}
      {g.free.map((c) => (
        <li key={c.leagueId} className="af-pf-dc-cell is-free">
          <span className="af-pf-dc-tag">Free</span> {c.leagueName}
          {c.claim ? (
            <a
              className="af-pf-dc-claim"
              href={c.claim.href}
              {...(c.claim.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              Claim {last} in {c.claim.platformLabel}
            </a>
          ) : null}
        </li>
      ))}
      {g.other.length > 0 ? (
        <li className="af-pf-dc-cell is-other">
          <span className="af-pf-dc-tag">Taken</span> in {g.other.length} {g.other.length === 1 ? 'league' : 'leagues'}:{' '}
          {g.other.map((c) => (c.detail ? `${c.leagueName} (${c.detail})` : c.leagueName)).join(', ')}
        </li>
      ) : null}
      {g.unknown.length > 0 ? (
        <li className="af-pf-dc-cell is-unknown">
          <span className="af-pf-dc-tag">Can&apos;t read</span> {names(g.unknown)}
        </li>
      ) : null}
    </ul>
  )
}

export function DepthChartBackups({
  data,
  playerName,
  hrefFor,
}: {
  data: DepthChartView | null
  playerName: string
  /** The finder link for a player ref, keeping the page's league scope. */
  hrefFor: (ref: string, name: string) => string
}) {
  if (!data || data.entries.length < 2) return null
  const last = (n: string) => n.trim().split(/\s+/).slice(-1)[0] || n
  const him = last(playerName)
  const asOf = DATE.format(new Date(data.asOfIso))
  return (
    <section className="af-card af-pf-dc" aria-labelledby="af-pf-dc-h">
      <h3 className="af-label" id="af-pf-dc-h">
        Next man up · {data.team} {slotLabel(data.slot)}
      </h3>
      <ol className="af-pf-dc-list">
        {data.entries.map((e) => {
          const cells = e.sleeperId && data.presence ? data.presence[e.sleeperId] : undefined
          return (
            <li key={`${e.depth}-${e.name}`} className={`af-pf-dc-row${e.isHim ? ' is-him' : ''}`}>
              <div className="af-pf-dc-head">
                <span className="af-pf-dc-depth af-num" aria-label={`Depth ${e.depth}`}>
                  {e.depth}
                </span>
                {e.ref && !e.isHim ? (
                  <a className="af-pf-dc-name" href={hrefFor(e.ref, e.name)}>
                    {e.name}
                  </a>
                ) : (
                  <span className="af-pf-dc-name">{e.name}</span>
                )}
                {e.isHim ? <span className="af-pf-dc-you">this player</span> : null}
              </div>
              {!e.isHim && cells ? <Presence cells={cells} last={last(e.name)} /> : null}
            </li>
          )
        })}
      </ol>
      <p className="af-pf-dc-foot">
        {data.hisDepth === 1
          ? `Who plays if ${him} misses time, in order. `
          : `${him} is number ${data.hisDepth} here. `}
        Depth chart as of {asOf}; injury status is on the card above, not from this chart.
      </p>
    </section>
  )
}
