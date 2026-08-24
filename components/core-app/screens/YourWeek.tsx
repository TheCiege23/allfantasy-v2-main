'use client'

import Link from 'next/link'
import type { WeekBoard, WeekMatchup } from '@/lib/core-app/weekBoard'
/*
 * ⚠ THE VALUE COMES FROM `weekBoardRules`, THE TYPES FROM `weekBoard`. The types
 * are erased at build time so importing them from the `server-only` loader is
 * free; the constant is not, and importing it from there pulled prisma into this
 * client bundle and 500'd every screen on the /core route. See the header of
 * lib/core-app/weekBoardRules.ts.
 */
import { COIN_FLIP_POINTS } from '@/lib/core-app/weekBoardRules'
import '@/components/core-app/af-week.css'

/**
 * 24a — "Your Week, every matchup".
 *
 * ⚠ THE ORDER IS DECISION-RELEVANCE, NOT A FLAT LIST, AND IT IS NOT SORTED HERE.
 * The loader hands the two tiers over already ordered — coin flips closest-first,
 * the rest most-lopsided-first — and there is no `.sort()` in this file on
 * purpose. Same rule as MyLeaguesV4: a screen that re-sorts is a screen that can
 * silently disagree with the loader about what matters.
 *
 * ⚠ WIN PROBABILITY NEVER APPEARS WITHOUT ITS BASIS. The footer states the model
 * and prints n, and `WeekBoard.model` is a required field precisely so this
 * cannot be dropped. Both halves of a coin-flip card — the percentage AND the
 * point gap — are shown together, because a probability on its own hides how
 * close the game actually is.
 *
 * Mobile stacks the same two tiers; it is a media query on this markup, not a
 * second component, and never a horizontal scroller.
 */

export type YourWeekProps = {
  data: WeekBoard
  /** Rivalry Radar lives on the same screen key behind ?view=rivalries. */
  rivalriesHref: string
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`
}

function OpponentName({ matchup }: { matchup: WeekMatchup }) {
  // Never invent a name. An unnamed roster says which roster it is.
  return <>{matchup.opponent.name ?? `Roster ${matchup.opponent.rosterId}`}</>
}

/** Large card — the coin-flip tier. */
function CoinFlipCard({ matchup }: { matchup: WeekMatchup }) {
  const p = matchup.projection!
  const gap = Math.abs(p.margin)
  const favoured = p.margin >= 0
  return (
    <Link href={matchup.href} className="af-wk-flip">
      <div className="af-wk-flip-head">
        <span className="af-wk-league" data-platform={matchup.platform}>
          {matchup.leagueName}
        </span>
        <span className="af-wk-gap af-num">{gap.toFixed(1)} pt gap</span>
      </div>

      <div className="af-wk-flip-prob">
        <span className="af-wk-prob af-num" data-favoured={favoured}>
          {pct(p.winProbability)}
        </span>
        <span className="af-wk-prob-label">to win</span>
      </div>

      <div className="af-wk-flip-line">
        <span className="af-wk-vs">vs</span>
        <span className="af-wk-opp">
          <OpponentName matchup={matchup} />
        </span>
      </div>

      <div className="af-wk-flip-score af-num">
        <b>{p.you.toFixed(1)}</b>
        <i>–</i>
        <b>{p.them.toFixed(1)}</b>
        <span className="af-wk-projtag">projected</span>
      </div>
    </Link>
  )
}

/** Compact card — the leaning tier. */
function LeaningCard({ matchup }: { matchup: WeekMatchup }) {
  const p = matchup.projection!
  const favoured = p.margin >= 0
  return (
    <Link href={matchup.href} className="af-wk-lean">
      <span className="af-wk-lean-league" data-platform={matchup.platform}>
        {matchup.leagueName}
      </span>
      <span className="af-wk-lean-prob af-num" data-favoured={favoured}>
        {pct(p.winProbability)}
      </span>
      <span className="af-wk-lean-score af-num">
        {p.you.toFixed(1)}–{p.them.toFixed(1)}
      </span>
    </Link>
  )
}

export function YourWeek({ data, rivalriesHref }: YourWeekProps) {
  const total = data.coinFlips.length + data.leaning.length + data.unprojected.length

  return (
    <div className="af-wk">
      <header className="af-wk-head">
        <div>
          <p className="af-wk-eyebrow af-label">
            {data.season && data.week ? `${data.season} · Week ${data.week}` : 'Your week'}
          </p>
          <h1 className="af-display af-wk-title">Your week, every matchup</h1>
          <p className="af-wk-sub">
            {total > 0
              ? `${total} ${total === 1 ? 'matchup' : 'matchups'}, ordered by what actually needs a decision — not alphabetically.`
              : 'No matchups are on file for this week.'}
          </p>
        </div>

        <div className="af-wk-headactions">
          <Link href={rivalriesHref} className="af-btn af-wk-btn">
            Rivalry Radar
          </Link>
          {/*
            "Open all 9" from the handoff. It opens the matchup screen for every
            league in the list, so the label counts the real list rather than
            hardcoding a number from the designer's own account.
          */}
          {total > 0 ? (
            <OpenAll matchups={[...data.coinFlips, ...data.leaning, ...data.unprojected]} />
          ) : null}
        </div>
      </header>

      {data.coinFlips.length > 0 ? (
        <section className="af-wk-section">
          <div className="af-wk-sectionhead">
            <h2 className="af-wk-sectiontitle">Coin flips</h2>
            <p className="af-wk-sectionnote">
              Projected within {COIN_FLIP_POINTS} points. These are the ones a lineup decision
              actually swings.
            </p>
          </div>
          <div className="af-wk-flips">
            {data.coinFlips.map((m) => (
              <CoinFlipCard key={`${m.leagueId}-${m.opponent.rosterId}`} matchup={m} />
            ))}
          </div>
        </section>
      ) : null}

      {data.leaning.length > 0 ? (
        <section className="af-wk-section">
          <div className="af-wk-sectionhead">
            <h2 className="af-wk-sectiontitle">The rest</h2>
            <p className="af-wk-sectionnote">
              Already leaning one way by more than {COIN_FLIP_POINTS} projected points.
            </p>
          </div>
          <div className="af-wk-leans">
            {data.leaning.map((m) => (
              <LeaningCard key={`${m.leagueId}-${m.opponent.rosterId}`} matchup={m} />
            ))}
          </div>
        </section>
      ) : null}

      {/*
        ⚠ NOT DEFAULTED TO 50%, AND NOT HIDDEN. A matchup we cannot project is a
        third state, and collapsing it into either tier would put a made-up
        probability on a game we know nothing about.
      */}
      {data.unprojected.length > 0 ? (
        <section className="af-wk-section">
          <div className="af-wk-sectionhead">
            <h2 className="af-wk-sectiontitle">Not enough history to call</h2>
            <p className="af-wk-sectionnote">
              These are on the schedule, but one or both teams have fewer than three completed
              weeks on file. A number here would be invented rather than computed.
            </p>
          </div>
          <div className="af-wk-leans">
            {data.unprojected.map((m) => (
              <Link
                key={`${m.leagueId}-${m.opponent.rosterId}`}
                href={m.href}
                className="af-wk-lean"
                data-unprojected="true"
              >
                <span className="af-wk-lean-league" data-platform={m.platform}>
                  {m.leagueName}
                </span>
                <span className="af-wk-lean-prob af-wk-lean-prob--none">—</span>
                <span className="af-wk-lean-score">
                  vs <OpponentName matchup={m} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {total === 0 ? (
        <div className="af-wk-empty">
          <p className="af-wk-empty-t">No schedule is on file for this week.</p>
          <p className="af-wk-empty-b">
            This screen is built from synced matchups. Nothing has been read for your leagues yet,
            so there is nothing to rank — that is a gap in what we have, not a week with no games.
          </p>
          <Link href="/import" className="af-btn af-wk-btn">
            Import or re-sync a league
          </Link>
        </div>
      ) : null}

      {/* The model basis. Always rendered when any probability was shown. */}
      {data.coinFlips.length + data.leaning.length > 0 ? (
        <footer className="af-wk-foot">
          <p>
            <b>How these are worked out.</b> {data.model.basis} Fitted on{' '}
            <span className="af-num">n={data.model.sampleSize}</span> completed roster-weeks across
            your leagues.
          </p>
          <p>
            Win probability is a pre-game model output, not an outcome. Once games start it sits
            alongside live points rather than replacing them.
          </p>
          {data.withoutSchedule > 0 ? (
            <p>
              <span className="af-num">{data.withoutSchedule}</span> of your leagues carry no
              schedule for this week at all and are not counted above.
            </p>
          ) : null}
        </footer>
      ) : null}
    </div>
  )
}

/**
 * "Open all" — one click, one tab per league.
 *
 * A plain button rather than N anchors because the point is the bulk action. It
 * opens real, existing matchup routes; nothing here is a placeholder.
 */
function OpenAll({ matchups }: { matchups: WeekMatchup[] }) {
  return (
    <button
      type="button"
      className="af-btn af-wk-btn af-wk-btn--ghost"
      onClick={() => {
        for (const m of matchups) window.open(m.href, '_blank', 'noopener,noreferrer')
      }}
    >
      Open all {matchups.length}
    </button>
  )
}

export default YourWeek
