'use client'

import Link from 'next/link'
import type { RivalryCard, RivalryRadar as RivalryRadarData } from '@/lib/core-app/weekBoard'
import '@/components/core-app/af-week.css'

/**
 * 24b — Rivalry Radar.
 *
 * ⚠ A SINGLE MEETING IS NEVER CALLED A RIVALRY. The loader sets
 * `sampleTooSmall` and this screen renders those in their own tier with the
 * sample size stated — "One meeting, one blowout. Not a rivalry yet." The
 * judgement is made once, in the loader, so two surfaces cannot disagree about
 * where the line is.
 *
 * ⚠ EVERY CARD PAIRS HISTORY WITH TODAY. The handoff's rationale is that one
 * without the other is an incomplete story, so a card with a series record but
 * no projection says so explicitly rather than leaving the space blank and
 * letting the reader assume the game is not on.
 *
 * ⚠ "CLOSEST EVER" ALWAYS CITES SEASON, WEEK AND MARGIN. Never summarised into
 * "a nail-biter" — the actual game is the evidence for the claim.
 */

export type RivalryRadarProps = {
  data: RivalryRadarData
  /** Back to the matchup list, which shares this screen key. */
  weekHref: string
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`
}

function opponentLabel(card: RivalryCard): string {
  return card.opponent.name ?? `Roster ${card.opponent.rosterId}`
}

function Card({ card, tone }: { card: RivalryCard; tone: 'bad' | 'good' | 'neutral' }) {
  const { series, closest, thisWeek } = card
  return (
    <article className="af-rr-card" data-tone={tone}>
      <header className="af-rr-cardhead">
        <div className="af-rr-who">
          <h3 className="af-rr-opp">{opponentLabel(card)}</h3>
          <p className="af-rr-league" data-platform={card.platform}>
            {card.leagueName}
          </p>
        </div>
        <div className="af-rr-record af-num" data-tone={tone}>
          {series.wins}–{series.losses}
          <span className="af-rr-record-label">all-time</span>
        </div>
      </header>

      {card.sampleTooSmall ? (
        <p className="af-rr-small">
          {series.meetings === 1
            ? 'One meeting. Not a rivalry yet — one game tells you almost nothing about the next one.'
            : 'No completed meetings yet. The series starts when they play.'}
        </p>
      ) : (
        <dl className="af-rr-stats">
          <div>
            <dt>Average margin</dt>
            <dd className="af-num" data-sign={card.averageMargin >= 0 ? 'pos' : 'neg'}>
              {card.averageMargin >= 0 ? '+' : ''}
              {card.averageMargin.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt>Meetings</dt>
            <dd className="af-num">{series.meetings}</dd>
          </div>
        </dl>
      )}

      {closest ? (
        <p className="af-rr-closest">
          <b>Closest ever</b> · {closest.season} week {closest.week} —{' '}
          {closest.won ? 'you won by' : 'you lost by'}{' '}
          <span className="af-num">{Math.abs(closest.margin).toFixed(1)}</span>
        </p>
      ) : null}

      {/* The live half. Present as its own row so its absence is visible. */}
      <footer className="af-rr-today">
        {thisWeek == null ? (
          <span className="af-rr-today-none">Not on your schedule this week.</span>
        ) : thisWeek.winProbability == null ? (
          <span className="af-rr-today-none">
            Playing this week — not enough completed weeks on either side to project it.
          </span>
        ) : (
          <>
            <span className="af-rr-today-label">This week</span>
            <span
              className="af-rr-today-prob af-num"
              data-favoured={thisWeek.winProbability >= 0.5}
            >
              {pct(thisWeek.winProbability)}
            </span>
            <span className="af-rr-today-gap af-num">
              {thisWeek.projectedMargin != null
                ? `${thisWeek.projectedMargin >= 0 ? '+' : ''}${thisWeek.projectedMargin.toFixed(1)} projected`
                : ''}
            </span>
          </>
        )}
      </footer>

      <Link href={`/core/matchup?league=${encodeURIComponent(card.leagueId)}`} className="af-rr-open">
        Open the matchup
      </Link>
    </article>
  )
}

function Tier({
  title,
  note,
  cards,
  tone,
}: {
  title: string
  note: string
  cards: RivalryCard[]
  tone: 'bad' | 'good' | 'neutral'
}) {
  if (cards.length === 0) return null
  return (
    <section className="af-rr-tier" data-tone={tone}>
      <div className="af-rr-tierhead">
        <h2 className="af-rr-tiertitle">{title}</h2>
        <p className="af-rr-tiernote">{note}</p>
      </div>
      <div className="af-rr-grid">
        {cards.map((c) => (
          <Card key={`${c.leagueId}-${c.opponent.rosterId}`} card={c} tone={tone} />
        ))}
      </div>
    </section>
  )
}

export function RivalryRadar({ data, weekHref }: RivalryRadarProps) {
  const anything = data.theyOwnYou.length + data.youOwnThem.length + data.even.length > 0

  return (
    <div className="af-wk af-rr">
      <header className="af-wk-head">
        <div>
          <p className="af-wk-eyebrow af-label">
            {data.season && data.week ? `${data.season} · Week ${data.week}` : 'Rivalry Radar'}
          </p>
          <h1 className="af-display af-wk-title">Rivalry Radar</h1>
          <p className="af-wk-sub">
            {anything ? (
              <>
                This week&apos;s opponents, read through every meeting we have on file —{' '}
                <span className="af-num">{data.totals.meetings}</span> completed{' '}
                {data.totals.meetings === 1 ? 'matchup' : 'matchups'} across{' '}
                <span className="af-num">{data.totals.seasons}</span>{' '}
                {data.totals.seasons === 1 ? 'season' : 'seasons'} and{' '}
                <span className="af-num">{data.totals.platforms}</span>{' '}
                {data.totals.platforms === 1 ? 'platform' : 'platforms'}.
              </>
            ) : (
              'No head-to-head history is on file yet.'
            )}
          </p>
        </div>
        <div className="af-wk-headactions">
          <Link href={weekHref} className="af-btn af-wk-btn af-wk-btn--ghost">
            All matchups
          </Link>
        </div>
      </header>

      {/*
        "The one to watch". The selection rule is stated in the panel rather than
        left implicit — the handoff asked for the exact logic to be pinned down,
        and a reader cannot check a rule they cannot see.
      */}
      {data.oneToWatch ? (
        <aside className="af-rr-watch">
          <p className="af-rr-watch-eyebrow af-label">The one to watch</p>
          <h2 className="af-rr-watch-title">
            {opponentLabel(data.oneToWatch)} · {data.oneToWatch.leagueName}
          </h2>
          <p className="af-rr-watch-body">
            {data.oneToWatch.series.wins}–{data.oneToWatch.series.losses} all-time at an average
            margin of {Math.abs(data.oneToWatch.averageMargin).toFixed(1)}
            {data.oneToWatch.thisWeek?.projectedMargin != null ? (
              <>
                , and projected within{' '}
                {Math.abs(data.oneToWatch.thisWeek.projectedMargin).toFixed(1)} today.
              </>
            ) : (
              '.'
            )}
          </p>
          <p className="af-rr-watch-rule">
            Picked as the smallest combined figure of average historical margin and projected margin
            today — close then <i>and</i> close now, not one or the other.
          </p>
        </aside>
      ) : null}

      <Tier
        tone="bad"
        title="They own you — statement week"
        note="Series you are behind in. The record is theirs until you change it."
        cards={data.theyOwnYou}
      />

      <Tier
        tone="good"
        title="You own this one"
        note="Series you lead, and are not projected to lose today."
        cards={data.youOwnThem}
      />

      <Tier
        tone="neutral"
        title="Too early, or too close to call"
        note="Level series, single meetings, and series where today's projection disagrees with the record."
        cards={data.even}
      />

      {!anything ? (
        <div className="af-wk-empty">
          <p className="af-wk-empty-t">No head-to-head history yet.</p>
          <p className="af-wk-empty-b">
            This view is computed from synced matchups across every season we hold. Nothing has been
            read for your leagues yet, so there are no series to compare — that is a gap in what we
            have, not a sign you have never played anybody.
          </p>
          <Link href="/import" className="af-btn af-wk-btn">
            Import or re-sync a league
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export default RivalryRadar
