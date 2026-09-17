'use client'

import {
  LEAGUE_WEEK_UNIT,
  type ReadyChimmyScenario,
  type ReadyStartSitScenario,
  type ReadyTradeScenario,
  type ReadyWaiverScenario,
  type ScenarioPlayer,
} from '@/lib/chimmy/tradeScenarioTypes'

/**
 * A scenario's before/after, rendered under the answer that discussed it — a trade, a waiver
 * add/drop, or a start/sit.
 *
 * Chimmy item 8. The route computes these from the league's real rosters (`meta.scenario`); the
 * prose answer is the model's reading of it. Showing the numbers themselves means a reader can
 * check the answer against what it was built from, instead of trusting a paraphrase.
 *
 * ⚠ EVERY LINEUP ROW IS ONE WEEK UNDER THE LEAGUE'S OWN RULES, AND SAYS SO. The trade row was
 * AllFantasy points per game (full PPR in every league) until 2026-09-17; the old unit is still
 * labelled if an older scenario arrives, so a number is never shown under the wrong name.
 *
 * ⚠ THE LAST ROW SAYS "NOT COMPUTED" ON PURPOSE. Playoff odds are the number people most want and
 * the one nothing here can produce honestly for a hypothetical move. Leaving the row out would read
 * as "not relevant"; a dash would read as "zero change".
 *
 * ⚠ SAME `af-cm-*` IDIOM AND TOKENS AS `ChimmyEvidence`, for the reason that file records: this
 * drawer has no Tailwind, and a delta's colour carries meaning, so every state is a token that the
 * light-mode clamp rewrites consistently — and each also differs in sign text, so the direction
 * survives a monochrome render.
 */

const label = (p: ScenarioPlayer) => (p.position ? `${p.name} (${p.position})` : p.name)
const names = (ps: ScenarioPlayer[]) => ps.map(label).join(', ')

function fmt(n: number | null | undefined, digits: number): string {
  return n == null ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

const unitLabel = (unit: string | undefined, week?: number) =>
  !unit
    ? null
    : unit === 'projected_points_per_game'
      ? 'pts / game'
      : unit === LEAGUE_WEEK_UNIT
        ? week != null
          ? `league pts, wk ${week}`
          : 'league pts, this week'
        : unit.replace(/_/g, ' ')

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

function UnfilledNote({ slots }: { slots: string[] }) {
  if (slots.length === 0) return null
  return (
    <p className="af-cm-scn-note" data-testid="chimmy-scenario-unfilled">
      Totals leave out {slots.join(', ')}: nobody who can fill {slots.length === 1 ? 'that slot' : 'those slots'} has a
      projection under your league’s scoring.
    </p>
  )
}

function PlayoffRow({ reason, what }: { reason: string; what: string }) {
  return (
    <tr data-row="playoff">
      <th scope="row">Playoff odds</th>
      <td colSpan={3} className="af-cm-scn-na" title={reason}>
        Not computed for a hypothetical {what}
      </td>
    </tr>
  )
}

export function ChimmyScenarioCard({ scenario }: { scenario: ReadyChimmyScenario }) {
  if (scenario.kind === 'waiver') return <WaiverScenarioCard scenario={scenario} />
  if (scenario.kind === 'start_sit') return <StartSitScenarioCard scenario={scenario} />
  return <TradeScenarioCard scenario={scenario} />
}

function TradeScenarioCard({ scenario }: { scenario: ReadyTradeScenario }) {
  const unit = unitLabel(scenario.lineup?.unit, scenario.lineupWeek ?? undefined)
  return (
    <div className="af-cm-scn" data-testid="chimmy-scenario" data-kind="trade">
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
          <LineupRow lineup={scenario.lineup} unavailable={scenario.lineupUnavailable} unit={unit} />
          <PlayoffRow reason={scenario.playoffOdds.reason} what="trade" />
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

function LineupRow({
  lineup,
  unavailable,
  unit,
}: {
  lineup: ReadyTradeScenario['lineup']
  unavailable: string | null
  unit: string | null
}) {
  return (
    <tr data-row="lineup">
      <th scope="row">Starting lineup{unit ? <span className="af-cm-scn-unit"> ({unit})</span> : null}</th>
      {lineup ? (
        <>
          <td className="af-num">{fmt(lineup.before, 1)}</td>
          <td className="af-num">{fmt(lineup.after, 1)}</td>
          <td>
            <Delta value={lineup.delta} digits={1} />
          </td>
        </>
      ) : (
        <td colSpan={3} className="af-cm-scn-na" title={unavailable ?? undefined}>
          Not computed{unavailable ? ` — ${unavailable}` : ''}
        </td>
      )}
    </tr>
  )
}

function WaiverScenarioCard({ scenario }: { scenario: ReadyWaiverScenario }) {
  const wk = scenario.week.week
  const unit = unitLabel(LEAGUE_WEEK_UNIT, wk)
  const pts = (p: { points: number | null }) => (p.points == null ? `no wk ${wk} projection` : `${fmt(p.points, 1)} wk ${wk}`)
  return (
    <div className="af-cm-scn" data-testid="chimmy-scenario" data-kind="waiver">
      <div className="af-cm-scn-title">
        Waiver scenario{scenario.source === 'engine_top_claim' ? ' · the waiver engine’s top claim' : ''}
      </div>
      <div className="af-cm-scn-sides">
        <span className="af-cm-scn-side">
          <span className="af-cm-scn-label">Add</span> {label(scenario.add)}
          <span className="af-cm-scn-unit af-num"> · {pts(scenario.add)}</span>
        </span>
        <span className="af-cm-scn-side">
          <span className="af-cm-scn-label">Drop</span>{' '}
          {scenario.drop ? (
            <>
              {label(scenario.drop)}
              <span className="af-cm-scn-unit af-num"> · {pts(scenario.drop)}</span>
            </>
          ) : (
            'nobody named'
          )}
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
          <LineupRow lineup={scenario.lineup} unavailable={scenario.lineupUnavailable} unit={unit} />
          <PlayoffRow reason={scenario.playoffOdds.reason} what="move" />
        </tbody>
      </table>

      <p className="af-cm-scn-note" data-testid="chimmy-scenario-one-week">
        Week {wk} only, under your league’s scoring — the weeks after it are not in these numbers.
      </p>
      <UnfilledNote slots={scenario.unfilledSlots} />
      {scenario.engine && (scenario.engine.compositeScore != null || scenario.engine.faabBid != null) ? (
        <p className="af-cm-scn-note" data-testid="chimmy-scenario-engine">
          Engine
          {scenario.engine.compositeScore != null ? ` score ${Math.round(scenario.engine.compositeScore)}/100` : ''}
          {scenario.engine.faabBid != null ? ` · suggested bid $${scenario.engine.faabBid}` : ''}. Whether the claim
          succeeds is not modelled.
        </p>
      ) : null}
      {scenario.rosterRoomUnchecked ? (
        <p className="af-cm-scn-note" data-testid="chimmy-scenario-room">
          No drop named, so whether your roster has room was not checked.
        </p>
      ) : null}
    </div>
  )
}

function StartSitScenarioCard({ scenario }: { scenario: ReadyStartSitScenario }) {
  const wk = scenario.week.week
  const unit = unitLabel(scenario.unit, wk)
  const [a, b] = scenario.options
  const pick = scenario.options.find((o) => o.playerId === scenario.startPlayerId) ?? null
  const verdict = scenario.contested
    ? `Start ${pick?.name}`
    : a.inBestLineup && b.inBestLineup
      ? 'Both are in your best lineup — start both'
      : 'Neither is in your best lineup'
  return (
    <div className="af-cm-scn" data-testid="chimmy-scenario" data-kind="start_sit">
      <div className="af-cm-scn-title">Start / sit · {verdict}</div>
      <table className="af-cm-scn-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Wk {wk} pts</th>
            <th scope="col">Best lineup</th>
            <th scope="col">Lineup if started{unit ? ` (${unit})` : ''}</th>
          </tr>
        </thead>
        <tbody>
          {scenario.options.map((o) => (
            <tr key={o.playerId} data-row="option" data-pick={o.playerId === scenario.startPlayerId ? 'true' : undefined}>
              <th scope="row">{label(o)}</th>
              <td className="af-num">{fmt(o.points, 1)}</td>
              <td>{o.inBestLineup ? 'In' : 'Out'}</td>
              <td className="af-num">{fmt(o.lineupIfStarted, 1)}</td>
            </tr>
          ))}
          {scenario.contested ? (
            <tr data-row="difference">
              <th scope="row">Difference</th>
              <td colSpan={2} />
              <td>
                <Delta value={scenario.delta} digits={1} />
              </td>
            </tr>
          ) : null}
          <PlayoffRow reason={scenario.playoffOdds.reason} what="lineup" />
        </tbody>
      </table>
      <p className="af-cm-scn-note" data-testid="chimmy-scenario-not-modelled">
        Week {wk} projections under your league’s scoring — weather, late injury news and game locks are not
        modelled.
      </p>
      <UnfilledNote slots={scenario.unfilledSlots} />
      {scenario.unpricedExcluded > 0 ? (
        <p className="af-cm-scn-note">
          {scenario.unpricedExcluded} active player{scenario.unpricedExcluded === 1 ? '' : 's'} with no week {wk}
          projection left out.
        </p>
      ) : null}
    </div>
  )
}
