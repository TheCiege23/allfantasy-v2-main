'use client'

import Link from 'next/link'

import '@/components/core-app/af-war-front.css'
import type { WarFront as WarFrontData, WarFrontCard, WarOrder, WarPosture } from '@/lib/core-app/warRoomFront'
import { pct } from '@/lib/core-app/outlookCopy'
import { seasonOutlookSentence } from '@/lib/core-app/outlookSpanish'
import { getLeagueTypeMedia } from '@/lib/league-media/leagueTypeMedia'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { warRoomFrontMessages } from '@/lib/core-app/messages/warRoomFront'
import { WarPlanAsk } from '@/components/core-app/WarPlanAsk'

/**
 * The Front — the War Room's strategist view: every team you run, where it stands, and the play it
 * calls for. The model and its rules are in lib/core-app/warRoomFront.ts; this only renders it.
 *
 * ⚠ A CLIENT COMPONENT, FOR THE LANGUAGE — the same reason WarRoomWeek is one. Its props are the
 * small `WarFront` result, never the outlook board.
 *
 * ⚠ UNPLACED TEAMS ARE GROUPED, NOT HIDDEN. Off-season, too few weeks or a format the outlook cannot
 * simulate leaves a team without odds; listing those as full cards would bury the teams that have a
 * decision to make, and dropping them is the "fewer leagues than I'm in" bug again. They sit in one
 * disclosure at the end, each with its reason.
 */

type Copy = ReturnType<typeof useCopy>['m']

function useCopy() {
  const { language } = useOptionalLanguage()
  return { m: useMessages(warRoomFrontMessages), language }
}

const POSTURES: WarPosture[] = ['bubble', 'contender', 'long_shot', 'clinched', 'eliminated', 'unplaced']

function orderText(o: WarOrder, m: Copy, language: string): string {
  switch (o.kind) {
    case 'swing_game':
      return m.orderSwingGame(o.week, o.opponent, pct(o.ifWin), pct(o.ifLose), o.clinchOnWin)
    case 'what_decides':
      return seasonOutlookSentence(o.text, language)
    case 'chase_bye':
      return m.orderChaseBye(pct(o.byePct))
    case 'title_odds':
      return m.orderTitleOdds(pct(o.titlePct))
    case 'priced_moves':
      return m.orderPricedMoves
    case 'trade_deadline':
      return o.intent === 'buy'
        ? m.orderDeadlineBuy(o.week, o.weeksLeft)
        : o.intent === 'consolidate'
          ? m.orderDeadlineConsolidate(o.week, o.weeksLeft)
          : m.orderDeadlineSell(o.week, o.weeksLeft)
    case 'build_next_season':
      return o.deadlineOpen ? m.orderBuildNextSeasonOpen : m.orderBuildNextSeasonClosed
    case 'redraft_nothing_carries':
      return m.orderRedraftNothingCarries
    case 'unplaced':
      return o.why === 'withheld' && o.reason
        ? m.orderUnplacedWithheld(seasonOutlookSentence(o.reason, language))
        : o.why === 'no_team'
          ? m.orderUnplacedNoTeam
          : o.why === 'too_few_weeks'
            ? m.orderUnplacedTooFewWeeks(o.weeksFitted)
            : m.orderUnplacedNotModelled
  }
}

function Odds({ card, m }: { card: WarFrontCard; m: Copy }) {
  if (!card.odds) return null
  const cells: Array<[string, number]> = [[m.playoffOdds, card.odds.playoff]]
  if (card.odds.bye != null) cells.push([m.byeOdds, card.odds.bye])
  cells.push([m.titleOdds, card.odds.title])
  return (
    <dl className="af-wf-odds">
      {cells.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="af-num">{pct(value)}%</dd>
        </div>
      ))}
    </dl>
  )
}

function Card({ card }: { card: WarFrontCard }) {
  const { m, language } = useCopy()
  const rec = card.record
  const meta = [
    rec ? `${rec.wins}–${rec.losses}${rec.ties ? `–${rec.ties}` : ''}` : null,
    card.seed != null && card.teams != null ? m.seedOf(card.seed, card.teams) : null,
    card.weeksRemaining != null ? m.weeksLeft(card.weeksRemaining) : null,
  ].filter(Boolean)
  const format = card.format ? getLeagueTypeMedia(card.format).label : null

  return (
    <li>
      <article className="af-wf-card" data-posture={card.posture}>
        <header className="af-wf-card-head">
          <span className="af-wf-posture" data-posture={card.posture}>
            {m.posture(card.posture)}
          </span>
          <h3 className="af-wf-league">{card.leagueName}</h3>
          <span className="af-wf-format">
            {[format, card.horizon === 'carries_over' ? m.carriesOver : null].filter(Boolean).join(' · ')}
          </span>
        </header>
        <div className="af-wf-standing">
          <Odds card={card} m={m} />
          {meta.length > 0 ? <p className="af-wf-meta af-num">{meta.join(' · ')}</p> : null}
        </div>
        {card.orders.length > 0 ? (
          <ol className="af-wf-orders">
            {card.orders.map((o, i) => (
              <li key={`${o.kind}-${i}`}>
                <Link href={o.href}>{orderText(o, m, language)}</Link>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="af-wf-actions">
          <Link className="af-wf-scout" href={card.scoutHref}>
            {m.scout} &rarr;
          </Link>
          {/*
            War Room phase 4: a war plan from Chimmy, prefilled with this card's own facts (never sent for
            the user). The home holds no trade ideas or brief — the league view's button carries those.
          */}
          <WarPlanAsk leagueId={card.leagueId} input={{ leagueName: card.leagueName, card, trades: null, format: null, nextSeason: null }} />
        </div>
      </article>
    </li>
  )
}

export function WarFront({ data }: { data: WarFrontData }) {
  const { m, language } = useCopy()
  const placed = data.cards.filter((c) => c.posture !== 'unplaced')
  const unplaced = data.cards.filter((c) => c.posture === 'unplaced')

  return (
    <section className="af-wf" aria-labelledby="af-wf-heading">
      <h2 id="af-wf-heading" className="af-label af-wf-heading">
        {m.heading}
      </h2>
      {!data.available ? (
        <p className="af-wf-note">
          {m.unavailable} <Link href="/core/season-outlook">{m.outlookLink} &rarr;</Link>
        </p>
      ) : (
        <>
          <p className="af-wf-note">{m.blurb}</p>
          <ul className="af-wf-counts" aria-label={m.countsLabel}>
            {POSTURES.filter((p) => data.counts[p] > 0).map((p) => (
              <li key={p} data-posture={p}>
                {m.count(data.counts[p], p)}
              </li>
            ))}
          </ul>
          {placed.length > 0 ? (
            <ul className="af-wf-cards">
              {placed.map((c) => (
                <Card key={c.leagueId} card={c} />
              ))}
            </ul>
          ) : null}
          {unplaced.length > 0 ? (
            <details className="af-wf-unplaced">
              <summary>{m.notPlacedSummary(unplaced.length)}</summary>
              <ul>
                {unplaced.map((c) => (
                  <li key={c.leagueId}>
                    <Link href={c.scoutHref}>{c.leagueName}</Link>
                    {' — '}
                    {c.orders[0] ? orderText(c.orders[0], m, language) : m.orderUnplacedNotModelled}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  )
}

export default WarFront
