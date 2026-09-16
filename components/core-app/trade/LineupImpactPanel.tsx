'use client'

/**
 * What an offer does to the manager's starting lineup.
 *
 * ── THE RENDERING RULES, BECAUSE EVERY ONE OF THEM IS A WAY TO PRINT A CONFIDENT WRONG NUMBER ──
 *
 * - UNAVAILABLE and BLOCKED render their reason and NO NUMBER. The payload's reasons are written
 *   to be read by a manager ("you are not a party to this trade…"), and a delta beside a blocked
 *   reason would contradict itself.
 * - The delta always carries its UNIT. The projection table holds a per-game and a rest-of-season
 *   figure, and its own schema comment warns that confusing them understates a player by roughly
 *   the weeks remaining — silently. "+19" with no unit invites exactly that confusion.
 * - A zero delta is stated as "no change", not hidden. It is a real answer when the evaluation ran.
 * - `null` depth/replacement is "none", never "0". Zero points of cover and no cover at all are
 *   different facts about a roster.
 * - Unpriced players left out of the lineup are DISCLOSED. They change the answer only if they
 *   would have started, and only the manager can judge that.
 *
 * Pure presentation: it renders what `?include=rosterImpact` returned and fetches nothing itself.
 */

export type LineupDepthRow = {
  position: string
  rosteredBefore: number
  rosteredAfter: number
  rosteredDelta: number
  benchBefore: number
  benchAfter: number
  delta: number
}

export type LineupReplacementRow = { position: string; before: number | null; after: number | null }

export type LineupImpact = {
  startingPointsBefore: number | null
  startingPointsAfter: number | null
  startingPointsDelta: number | null
  blockedReason: string | null
  unpricedExcluded: number
  depth: LineupDepthRow[]
  replacement: LineupReplacementRow[]
  unit: 'projected_points_per_game'
}

export type LineupImpactResult =
  | { available: true; impact: LineupImpact }
  | { available: false; reason: string }

const UNIT_LABEL: Record<LineupImpact['unit'], string> = {
  projected_points_per_game: 'projected pts / game',
}

/** One decimal, signed. Exported so the sign convention is pinned by a test, not by eye. */
export function formatDelta(n: number): string {
  const r = Math.round(n * 10) / 10
  if (r === 0) return '±0.0'
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`
}

const pts = (n: number | null) => (n == null ? 'none' : n.toFixed(1))

export function LineupImpactPanel({ result }: { result: LineupImpactResult }) {
  if (!result.available) {
    return (
      <div className="af-tc-lineup-impact" data-state="unavailable">
        <span className="af-tc-nosignal">Lineup impact unavailable — {result.reason}.</span>
      </div>
    )
  }

  const { impact } = result
  const unit = UNIT_LABEL[impact.unit]

  if (impact.blockedReason || impact.startingPointsDelta == null) {
    return (
      <div className="af-tc-lineup-impact" data-state="blocked">
        <span className="af-tc-nosignal">
          Lineup impact not computed — {impact.blockedReason ?? 'the lineup could not be priced'}.
        </span>
      </div>
    )
  }

  const changedDepth = impact.depth.filter((d) => d.rosteredDelta !== 0)
  const changedPositions = new Set(changedDepth.map((d) => d.position))
  const changedReplacement = impact.replacement.filter(
    (r) => changedPositions.has(r.position) && r.before !== r.after,
  )
  const delta = impact.startingPointsDelta
  const tone = delta > 0 ? 'gain' : delta < 0 ? 'loss' : 'flat'

  return (
    <div className="af-tc-lineup-impact" data-state="ready" data-tone={tone}>
      <div className="af-label">Starting lineup</div>
      <p className="af-tc-lineup-delta">
        {delta === 0 ? (
          <>No change to your starting lineup</>
        ) : (
          <>
            <strong>{formatDelta(delta)}</strong> {unit}
          </>
        )}
        {impact.startingPointsBefore != null && impact.startingPointsAfter != null ? (
          <span className="af-tc-row-sub">
            {' '}
            ({impact.startingPointsBefore.toFixed(1)} → {impact.startingPointsAfter.toFixed(1)})
          </span>
        ) : null}
      </p>

      {changedDepth.length > 0 ? (
        <ul className="af-tc-lineup-depth">
          {changedDepth.map((d) => {
            const rep = changedReplacement.find((r) => r.position === d.position)
            return (
              <li key={d.position}>
                <span className="af-tc-lineup-pos">{d.position}</span>{' '}
                {d.rosteredBefore} → {d.rosteredAfter} rostered
                {rep ? (
                  <span className="af-tc-row-sub">
                    {' '}
                    · best backup {pts(rep.before)} → {pts(rep.after)}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {impact.unpricedExcluded > 0 ? (
        <p className="af-tc-row-sub">
          {impact.unpricedExcluded} rostered {impact.unpricedExcluded === 1 ? 'player has' : 'players have'} no
          projection and {impact.unpricedExcluded === 1 ? 'was' : 'were'} left out — this changes the answer only if
          they would have started.
        </p>
      ) : null}
    </div>
  )
}
