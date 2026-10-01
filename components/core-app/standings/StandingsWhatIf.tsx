'use client'

import { useMemo, useState } from 'react'

import { formatRecord, type StandingsBoard } from '@/lib/core-app/standingsModel'
import { applyWhatIf, whatIfSetup } from '@/lib/core-app/standingsWhatIf'
import { Move } from './StandingsBoardView'

/**
 * What if… — tap a winner for each of the next week's games and watch the table re-sort.
 *
 * The maths, and the reasons it is offered only for some leagues, are in `lib/core-app/standingsWhatIf.ts`.
 * Nothing here is stored or sent anywhere; it is a scratchpad over the board already on the page.
 *
 * ⚠ THE HEADLINE IS `aria-live`, AND ONLY THE HEADLINE. Announcing the whole re-sorted table on every tap
 * would read twelve rows aloud per pick; the one sentence about your seat is what changed for you.
 */

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function StandingsWhatIf({ board }: { board: StandingsBoard }) {
  const setup = useMemo(() => whatIfSetup(board), [board])
  const [picks, setPicks] = useState<Record<string, string>>({})
  const rows = useMemo(() => (setup ? applyWhatIf(board, setup, picks) : []), [board, setup, picks])

  if (!setup) return null

  const picked = Object.keys(picks).length
  const you = rows.find((r) => r.team.isYou) ?? null
  const yourGame = setup.games.find((g) => g.a.isYou || g.b.isYou) ?? null

  function pick(key: string, winner: string) {
    setPicks((p) => {
      if (p[key] === winner) {
        const { [key]: _, ...rest } = p
        return rest
      }
      return { ...p, [key]: winner }
    })
  }

  function favourites() {
    /* AF Power, not the table: who is actually scoring better is the fairer guess at a favourite. */
    setPicks(Object.fromEntries(setup!.games.map((g) => [g.key, g.a.powerRank <= g.b.powerRank ? g.a.rosterId : g.b.rosterId])))
  }

  function youWin() {
    if (!yourGame) return
    const me = yourGame.a.isYou ? yourGame.a : yourGame.b
    setPicks((p) => ({ ...p, [yourGame.key]: me.rosterId }))
  }

  let headline: string
  if (!you) headline = picked === 0 ? 'Pick winners to see the table move.' : `${picked} of ${setup.games.length} games picked.`
  else if (picked === 0) headline = `Pick winners to see where you would land. Today you are ${ordinal(you.seed)}.`
  else {
    const where = you.inField ? 'in a playoff spot' : 'outside the playoffs'
    headline =
      you.move === 0
        ? `You would stay ${ordinal(you.seed)} — ${where}.`
        : `You would be ${ordinal(you.seed)}, ${you.move > 0 ? 'up' : 'down'} ${Math.abs(you.move)} — ${where}.`
  }

  return (
    <section className="af-st-whatif" aria-labelledby="af-st-whatif-title">
      <div className="af-st-whatif-head">
        <h2 id="af-st-whatif-title" className="af-st-whatif-title">
          What if… <span className="af-num">week {setup.week}</span>
        </h2>
        <div className="af-st-whatif-actions">
          {yourGame ? (
            <button type="button" onClick={youWin}>
              I win
            </button>
          ) : null}
          <button type="button" onClick={favourites}>
            Favourites
          </button>
          <button type="button" onClick={() => setPicks({})} disabled={picked === 0}>
            Clear
          </button>
        </div>
      </div>
      <p className="af-st-whatif-lede">Tap a winner in each game. The table re-sorts by the league’s own rules.</p>
      {/*
        ⚠ ABOVE THE GAMES, NOT BESIDE THE TABLE. On a phone the table stacks under six games, so a headline
        kept with it changed out of sight on every tap — the payoff of the interaction was off-screen.
      */}
      <p className="af-st-whatif-headline" aria-live="polite">
        {headline}
      </p>

      <div className="af-st-whatif-body">
        <ul className="af-st-whatif-games">
          {setup.games.map((g) => (
            <li key={g.key} data-yours={g.a.isYou || g.b.isYou ? 'true' : undefined}>
              {[g.a, g.b].map((t, i) => (
                <span key={t.rosterId} className="af-st-whatif-side">
                  {i === 1 ? (
                    <span className="af-st-whatif-vs" aria-hidden>
                      vs
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="af-st-whatif-pick"
                    aria-pressed={picks[g.key] === t.rosterId}
                    data-lost={picks[g.key] && picks[g.key] !== t.rosterId ? 'true' : undefined}
                    onClick={() => pick(g.key, t.rosterId)}
                  >
                    <span className="af-st-whatif-pname">{t.name}</span>
                    <span className="af-st-whatif-prec af-num">
                      {ordinal(t.seed)} · {formatRecord(t.record)}
                      {t.isYou ? ' · you' : ''}
                    </span>
                  </button>
                </span>
              ))}
            </li>
          ))}
        </ul>

        <div className="af-st-whatif-result">
          <ol className="af-st-whatif-table" aria-label="The table with your picks">
            {rows.map((r) => (
              <li
                key={r.team.rosterId}
                data-you={r.team.isYou ? 'true' : undefined}
                data-field={r.inField ? 'true' : undefined}
                data-cut={r.seed === setup.field && setup.field < rows.length ? 'true' : undefined}
              >
                <span className="af-st-whatif-seed af-num">{r.seed}</span>
                <span className="af-st-whatif-move">
                  {/* Nothing before a pick: `Move`'s null reads "no earlier week", which is not what this means. */}
                  {picked === 0 ? null : <Move value={r.move} />}
                </span>
                <span className="af-st-whatif-name">{r.team.name}</span>
                <span className="af-st-whatif-rec af-num">{formatRecord(r.record)}</span>
              </li>
            ))}
          </ol>
          <p className="af-st-whatif-note">
            Points for stays at today’s totals, so a tie on record is broken on points already scored. A projection of a choice, not a
            result{setup.platformOrder ? '; the live table is the platform’s own order, which this rule may not match exactly' : ''}.
          </p>
        </div>
      </div>
    </section>
  )
}

export default StandingsWhatIf
