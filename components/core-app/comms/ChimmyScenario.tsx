'use client'

import type { ReadyTradeScenario, ScenarioPlayer } from '@/lib/chimmy/tradeScenarioTypes'

/**
 * A trade's before/after, rendered under the answer that discussed it.
 *
 * Chimmy item 8. The route computes this from the league's real rosters (`meta.scenario`); the
 * prose answer is the model's reading of it. Showing the numbers themselves means a reader can
 * check the answer against what it was built from, instead of trusting a paraphrase.
 *
 * ⚠ THREE ROWS, AND THE THIRD SAYS "NOT COMPUTED" ON PURPOSE. Playoff odds are the number people
 * most want from a trade question and the one nothing here can produce honestly for a hypothetical
 * trade. Leaving the row out would read as "not relevant"; a dash would read as "zero change".
 *
 * ⚠ SAME `af-cm-*` IDIOM AND TOKENS AS `ChimmyEvidence`, for the reason that file records: this
 * drawer has no Tailwind, and a delta's colour carries meaning, so every state is a token that the
 * light-mode clamp rewrites consistently — and each also differs in sign text, so the direction
 * survives a monochrome render.
 */

const names = (ps: ScenarioPlayer[]) => ps.map((p) => (p.position ? `${p.name} (${p.position})` : p.name)).join(', ')

function fmt(n: number | null, digits: number): string {
  return n == null ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function Delta({ value, digits }: { value: number | null; digits: number }) {
  if (value == null) return <span className="af-cm-scn-delta">—</span>
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const text = `${value > 0 ? '+' : ''}${fmt(value, digits)}`
  return (
    <span className="af-cm-scn-delta af-num" data-direction={direction}>
      {text}
    </span>
  )
}

export function ChimmyScenarioCard({ scenario }: { scenario: ReadyTradeScenario }) {
  const unit = scenario.lineup?.unit === 'projected_points_per_game' ? 'pts / game' : scenario.lineup?.unit.replace(/_/g, ' ')
  return (
    <div className="af-cm-scn" data-testid="chimmy-scenario">
      <div className="af-cm-scn-title">Trade scenario · with {scenario.partnerTeamName}</div>
      <div className="af-cm-scn-sides">
        <span className="af-cm-scn-side">
          <span className="af-cm-scn-label">You give</span> {names(scenario.give)}
        </span>
        <span className="af-cm-scn-side">
          <span className="af-cm-scn-label">You get</span> {names(scenario.get)}
        </span>
      </div>

      <table className="af-cm-scn-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr data-row="value">
            <th scope="row">
              Value{scenario.value.grade ? <span className="af-cm-scn-grade"> · {scenario.value.grade}</span> : null}
            </th>
            {/* "Before" is what you hold (and send); "after" is what you would hold instead. */}
            <td className="af-num">{fmt(scenario.value.given, 0)}</td>
            <td className="af-num">{fmt(scenario.value.received, 0)}</td>
            <td>
              <Delta value={scenario.value.delta} digits={0} />
            </td>
          </tr>
          <tr data-row="lineup">
            <th scope="row">Starting lineup{unit ? <span className="af-cm-scn-unit"> ({unit})</span> : null}</th>
            {scenario.lineup ? (
              <>
                <td className="af-num">{fmt(scenario.lineup.before, 1)}</td>
                <td className="af-num">{fmt(scenario.lineup.after, 1)}</td>
                <td>
                  <Delta value={scenario.lineup.delta} digits={1} />
                </td>
              </>
            ) : (
              <td colSpan={3} className="af-cm-scn-na" title={scenario.lineupUnavailable ?? undefined}>
                Not computed{scenario.lineupUnavailable ? ` — ${scenario.lineupUnavailable}` : ''}
              </td>
            )}
          </tr>
          <tr data-row="playoff">
            <th scope="row">Playoff odds</th>
            <td colSpan={3} className="af-cm-scn-na" title={scenario.playoffOdds.reason}>
              Not computed for a hypothetical trade
            </td>
          </tr>
        </tbody>
      </table>

      {scenario.value.coverageStatus !== 'complete' ? (
        <p className="af-cm-scn-note" data-testid="chimmy-scenario-coverage">
          Value is {scenario.value.coverageStatus}: only {Math.round(scenario.value.coveragePct)}% of the assets could be
          priced.
        </p>
      ) : null}
    </div>
  )
}
