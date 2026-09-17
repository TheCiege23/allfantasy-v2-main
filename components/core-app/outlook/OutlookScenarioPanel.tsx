'use client'

import { useEffect, useMemo, useState } from 'react'
import { pctOf, simulateSeason } from '@/lib/core-app/outlookSim'
import {
  CLIENT_ITERATIONS,
  EMPTY_SCENARIO,
  scenarioEffect,
  scenarioIsEmpty,
  type Scenario,
  type ScenarioModel,
  type ScenarioPlayer,
} from '@/lib/core-app/outlookScenario'
import { pct, signedPts } from '@/lib/core-app/outlookCopy'

/**
 * Season Outlook — what-if controls, simulated in the browser.
 *
 * ⚠ THE SAME MODEL AS THE HEADLINE, RUN LOCALLY. `simulateSeason` and `scenarioEffect` are the exact
 * functions the server used; only the iteration count differs, so this panel compares the scenario
 * with a baseline it runs ITSELF at that same count and seed. Comparing against the headline would
 * put sampling noise between two differently-sized runs into the "effect" of the change.
 */

type Odds = { playoff: number; bye: number; title: number }

function runOdds(model: ScenarioModel, scenario: Scenario): { odds: Odds | null; lines: string[]; problems: string[] } {
  const you = model.youRosterId
  const effect = scenarioEffect(model, scenario)
  if (!you) return { odds: null, lines: effect.lines, problems: effect.problems }
  const t = simulateSeason(model.sim, {
    iterations: CLIENT_ITERATIONS,
    seed: model.seed,
    adjustments: effect.adjustments,
    forced: effect.forced,
  })
  const c = t.counts[you] ?? { playoff: 0, bye: 0, title: 0 }
  return {
    odds: { playoff: pctOf(c.playoff, t.iterations), bye: pctOf(c.bye, t.iterations), title: pctOf(c.title, t.iterations) },
    lines: effect.lines,
    problems: effect.problems,
  }
}

const label = (p: ScenarioPlayer) =>
  `${p.name}${p.position ? ` · ${p.position}` : ''}${p.points != null ? ` · ${p.points.toFixed(1)}` : ' · no projection'}`

export function OutlookScenarioPanel({ model }: { model: ScenarioModel }) {
  const [scenario, setScenario] = useState<Scenario>(EMPTY_SCENARIO)
  const [result, setResult] = useState<ReturnType<typeof runOdds> | null>(null)
  const [running, setRunning] = useState(false)

  const baseline = useMemo(() => runOdds(model, EMPTY_SCENARIO).odds, [model])

  useEffect(() => {
    if (scenarioIsEmpty(scenario)) {
      setResult(null)
      return
    }
    setRunning(true)
    /* Yield a frame so "Running…" paints before the simulation holds the thread. */
    const id = window.setTimeout(() => {
      setResult(runOdds(model, scenario))
      setRunning(false)
    }, 16)
    return () => window.clearTimeout(id)
  }, [model, scenario])

  const teams = model.teams
  const you = teams.find((t) => t.isYou) ?? null
  const teamName = (rosterId: string) => teams.find((t) => t.rosterId === rosterId)?.name ?? `Team ${rosterId}`
  const nameOf = (rosterId: string) => (rosterId === model.youRosterId ? 'You' : teamName(rosterId))
  const priced = !model.refusal && you != null
  const mine = useMemo(
    () => [...(you?.players ?? [])].sort((a, b) => (b.points ?? -1) - (a.points ?? -1)),
    [you],
  )
  const starters = mine.filter((p) => p.slot === 'S')
  const bench = mine.filter((p) => p.slot === 'B' || p.slot === 'T')

  const byWeek = [...model.sim.remaining].sort((x, y) => x.week - y.week)
  const yourGames = byWeek.filter((g) => g.a === model.youRosterId || g.b === model.youRosterId)
  const otherGames = byWeek.filter((g) => g.a !== model.youRosterId && g.b !== model.youRosterId)
  const gameKey = (g: { week: number; a: string; b: string }) => `${g.week}|${g.a}|${g.b}`

  // Form state for each control.
  const [gamePick, setGamePick] = useState('')
  const [injPick, setInjPick] = useState('')
  const [injWeeks, setInjWeeks] = useState('1')
  const [luWeek, setLuWeek] = useState(String(model.weeks[0] ?? ''))
  const [luStart, setLuStart] = useState('')
  const [luSit, setLuSit] = useState('')
  const [partner, setPartner] = useState('')
  const [send, setSend] = useState(['', ''])
  const [receive, setReceive] = useState(['', ''])
  const [faPick, setFaPick] = useState('')
  const [dropPick, setDropPick] = useState('')

  const partnerTeam = teams.find((t) => t.rosterId === partner) ?? null
  const add = (patch: Partial<Scenario>) =>
    setScenario((s) => ({
      injuries: [...s.injuries, ...(patch.injuries ?? [])],
      lineup: [...s.lineup, ...(patch.lineup ?? [])],
      trades: [...s.trades, ...(patch.trades ?? [])],
      waivers: [...s.waivers, ...(patch.waivers ?? [])],
      results: [...s.results.filter((r) => !(patch.results ?? []).some((n) => n.week === r.week && n.a === r.a && n.b === r.b)), ...(patch.results ?? [])],
    }))

  const addResult = (winnerSide: 'a' | 'b') => {
    const g = model.sim.remaining.find((x) => gameKey(x) === gamePick)
    if (!g) return
    add({ results: [{ week: g.week, a: g.a, b: g.b, winner: winnerSide === 'a' ? g.a : g.b }] })
  }

  const remove = (kind: keyof Scenario, index: number) =>
    setScenario((s) => ({ ...s, [kind]: (s[kind] as unknown[]).filter((_, i) => i !== index) }))

  const active: Array<{ kind: keyof Scenario; index: number; text: string }> = [
    ...scenario.results.map((r, index) => ({
      kind: 'results' as const,
      index,
      text: `Wk ${r.week}: ${nameOf(r.winner)} ${r.winner === model.youRosterId ? 'beat' : 'beats'} ${nameOf(r.winner === r.a ? r.b : r.a)}`,
    })),
    ...scenario.injuries.map((i, index) => ({
      kind: 'injuries' as const,
      index,
      text: `${mine.find((p) => p.id === i.playerId)?.name ?? 'Player'} out ${i.weeks == null ? 'for the season' : `${i.weeks} wk`}`,
    })),
    ...scenario.lineup.map((l, index) => ({
      kind: 'lineup' as const,
      index,
      text: `Wk ${l.week}: start ${mine.find((p) => p.id === l.startId)?.name ?? '?'} over ${mine.find((p) => p.id === l.sitId)?.name ?? '?'}`,
    })),
    ...scenario.trades.map((t, index) => ({
      kind: 'trades' as const,
      index,
      text: `Trade with ${nameOf(t.partnerRosterId)}`,
    })),
    ...scenario.waivers.map((w, index) => ({
      kind: 'waivers' as const,
      index,
      text: `Add ${model.freeAgents.find((p) => p.id === w.addId)?.name ?? '?'}${w.dropId ? `, drop ${mine.find((p) => p.id === w.dropId)?.name ?? '?'}` : ''}`,
    })),
  ]

  const odds = result?.odds ?? null

  return (
    <div className="af-olk-scn">
      <p className="af-olk-note">
        Build a what-if and the season is re-simulated here, {CLIENT_ITERATIONS.toLocaleString('en-US')} times, against a
        baseline run the same way.
        {model.basisWeek
          ? ` Player changes are priced from week ${model.basisWeek.week} projections under this league's scoring, applied to every week they cover.`
          : ''}
      </p>
      {model.refusal ? <p className="af-olk-warn">{model.refusal} Schedule results still work.</p> : null}
      {!model.youRosterId ? (
        <p className="af-olk-warn">Your team is not identified in this league, so there is nothing to compare.</p>
      ) : null}

      <div className="af-olk-scn-result" aria-live="polite">
        {baseline ? (
          <>
            {(['playoff', 'bye', 'title'] as const)
              .filter((k) => k !== 'bye' || model.sim.byeTeams > 0)
              .map((k) => {
                const after = odds?.[k]
                const delta = after == null ? null : after - baseline[k]
                return (
                  <div key={k} className="af-olk-scn-odds">
                    <span className="af-label">{k === 'playoff' ? 'Playoffs' : k === 'bye' ? 'Bye' : 'Title'}</span>
                    <span className="af-olk-scn-v af-num">
                      {pct(baseline[k])}%
                      {after != null ? (
                        <>
                          {' → '}
                          <b>{pct(after)}%</b>
                        </>
                      ) : null}
                    </span>
                    {delta != null ? (
                      <span className="af-olk-move-delta af-olk-scn-delta af-num" data-dir={delta >= 0.05 ? 'up' : delta <= -0.05 ? 'down' : 'flat'}>
                        {signedPts(delta)} pts
                      </span>
                    ) : (
                      <span className="af-olk-g">baseline</span>
                    )}
                  </div>
                )
              })}
            <span className="af-olk-g">{running ? 'Running…' : scenarioIsEmpty(scenario) ? 'Add a change below.' : ''}</span>
          </>
        ) : null}
      </div>

      {active.length > 0 ? (
        <ul className="af-olk-chips" aria-label="Changes in this what-if">
          {active.map((a) => (
            <li key={`${a.kind}-${a.index}`} className="af-olk-chip">
              <span>{a.text}</span>
              <button type="button" className="af-olk-chip-x" onClick={() => remove(a.kind, a.index)} aria-label={`Remove: ${a.text}`}>
                ×
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="af-olk-link" onClick={() => setScenario(EMPTY_SCENARIO)}>
              Clear all
            </button>
          </li>
        </ul>
      ) : null}
      {result && (result.lines.length > 0 || result.problems.length > 0) ? (
        <ul className="af-olk-mini-list">
          {result.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
          {result.problems.map((p) => (
            <li key={p} className="af-olk-warn">
              {p}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="af-olk-scn-grid">
        <fieldset className="af-olk-ctl">
          <legend className="af-label">Game results</legend>
          <label className="af-olk-field">
            <span>Game</span>
            <select value={gamePick} onChange={(e) => setGamePick(e.target.value)}>
              <option value="">Pick a game</option>
              {yourGames.length > 0 ? (
                <optgroup label="Your games">
                  {yourGames.map((g) => (
                    <option key={gameKey(g)} value={gameKey(g)}>
                      Wk {g.week}: vs {nameOf(g.a === model.youRosterId ? g.b : g.a)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Other games">
                {otherGames.map((g) => (
                  <option key={gameKey(g)} value={gameKey(g)}>
                    Wk {g.week}: {nameOf(g.a)} vs {nameOf(g.b)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          {gamePick ? (
            <div className="af-olk-row">
              {(['a', 'b'] as const).map((side) => {
                const g = model.sim.remaining.find((x) => gameKey(x) === gamePick)!
                const id = side === 'a' ? g.a : g.b
                return (
                  <button key={side} type="button" className="af-olk-btn" onClick={() => addResult(side)}>
                    {id === model.youRosterId ? 'You win' : `${nameOf(id)} wins`}
                  </button>
                )
              })}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="af-olk-ctl" disabled={!priced}>
          <legend className="af-label">Injury</legend>
          <label className="af-olk-field">
            <span>Player</span>
            <select value={injPick} onChange={(e) => setInjPick(e.target.value)}>
              <option value="">Pick one of yours</option>
              {mine.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="af-olk-field">
            <span>Out for</span>
            <select value={injWeeks} onChange={(e) => setInjWeeks(e.target.value)}>
              {['1', '2', '3', '4', '6'].map((w) => (
                <option key={w} value={w}>
                  {w} week{w === '1' ? '' : 's'}
                </option>
              ))}
              <option value="season">the rest of the season</option>
            </select>
          </label>
          <button
            type="button"
            className="af-olk-btn"
            disabled={!injPick}
            onClick={() => {
              add({ injuries: [{ playerId: injPick, weeks: injWeeks === 'season' ? null : Number(injWeeks) }] })
              setInjPick('')
            }}
          >
            Add injury
          </button>
        </fieldset>

        <fieldset className="af-olk-ctl" disabled={!priced}>
          <legend className="af-label">Lineup call</legend>
          <label className="af-olk-field">
            <span>Week</span>
            <select value={luWeek} onChange={(e) => setLuWeek(e.target.value)}>
              {model.weeks.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </label>
          <label className="af-olk-field">
            <span>Start</span>
            <select value={luStart} onChange={(e) => setLuStart(e.target.value)}>
              <option value="">Bench player</option>
              {bench.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="af-olk-field">
            <span>Instead of</span>
            <select value={luSit} onChange={(e) => setLuSit(e.target.value)}>
              <option value="">Current starter</option>
              {starters.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="af-olk-btn"
            disabled={!luStart || !luSit || !luWeek}
            onClick={() => {
              add({ lineup: [{ startId: luStart, sitId: luSit, week: Number(luWeek) }] })
              setLuStart('')
              setLuSit('')
            }}
          >
            Add lineup call
          </button>
        </fieldset>

        <fieldset className="af-olk-ctl" disabled={!priced}>
          <legend className="af-label">Trade</legend>
          <label className="af-olk-field">
            <span>With</span>
            <select
              value={partner}
              onChange={(e) => {
                setPartner(e.target.value)
                setReceive(['', ''])
              }}
            >
              <option value="">Pick a team</option>
              {teams
                .filter((t) => !t.isYou)
                .map((t) => (
                  <option key={t.rosterId} value={t.rosterId}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          {[0, 1].map((i) => (
            <label key={`s${i}`} className="af-olk-field">
              <span>{i === 0 ? 'You send' : 'And'}</span>
              <select value={send[i]} onChange={(e) => setSend((v) => v.map((x, j) => (j === i ? e.target.value : x)))}>
                <option value="">{i === 0 ? 'Pick a player' : 'Nobody else'}</option>
                {mine.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {[0, 1].map((i) => (
            <label key={`r${i}`} className="af-olk-field">
              <span>{i === 0 ? 'You get' : 'And'}</span>
              <select
                value={receive[i]}
                disabled={!partnerTeam}
                onChange={(e) => setReceive((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
              >
                <option value="">{i === 0 ? 'Pick a player' : 'Nobody else'}</option>
                {[...(partnerTeam?.players ?? [])]
                  .sort((a, b) => (b.points ?? -1) - (a.points ?? -1))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {label(p)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            className="af-olk-btn"
            disabled={!partner || (!send.some(Boolean) && !receive.some(Boolean))}
            onClick={() => {
              add({
                trades: [
                  {
                    partnerRosterId: partner,
                    send: [...new Set(send.filter(Boolean))],
                    receive: [...new Set(receive.filter(Boolean))],
                  },
                ],
              })
              setSend(['', ''])
              setReceive(['', ''])
            }}
          >
            Add trade
          </button>
        </fieldset>

        <fieldset className="af-olk-ctl" disabled={!priced}>
          <legend className="af-label">Waiver claim</legend>
          <label className="af-olk-field">
            <span>Add</span>
            <select value={faPick} onChange={(e) => setFaPick(e.target.value)}>
              <option value="">{model.freeAgents.length ? 'Pick a free agent' : 'No priced free agents'}</option>
              {model.freeAgents.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="af-olk-field">
            <span>Drop</span>
            <select value={dropPick} onChange={(e) => setDropPick(e.target.value)}>
              <option value="">Nobody (open spot)</option>
              {mine.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="af-olk-btn"
            disabled={!faPick}
            onClick={() => {
              add({ waivers: [{ addId: faPick, dropId: dropPick || null }] })
              setFaPick('')
              setDropPick('')
            }}
          >
            Add claim
          </button>
          <p className="af-olk-note">
            Free agents are the best projected players on no roster in this league&apos;s last sync, five per position.
          </p>
        </fieldset>
      </div>
    </div>
  )
}

export default OutlookScenarioPanel
