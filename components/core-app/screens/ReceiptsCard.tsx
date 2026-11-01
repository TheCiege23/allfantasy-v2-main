'use client'

import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import type {
  ChimmyAddReceipt,
  ChimmyReceipt,
  DecisionReceiptsData,
  LineupReceipt,
  StartCallReceipt,
  TradeReceipt,
  WaiverReceipt,
} from '@/lib/core-app/decisionReceipts'
import { describeTrackRecord, readTrackRecordLine } from '@/lib/chimmy-outcomes/trackRecord'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { receiptsCardMessages } from '@/lib/core-app/messages/receiptsCard'
import { spanishFlag } from '@/lib/core-app/messages/coreLocale'
import { trackRecordText } from '@/lib/core-app/dashboard3aCopy'
import { AfSavedShare } from '@/components/core-app/screens/AfSavedShare'

/**
 * The home "Receipts" card — how your past moves turned out (retention item 6, user
 * decisions 2026-09-14). Trades, waiver adds, lineups, AutoCoach calls and Chimmy's advice (its
 * start/sit calls and the waiver claims its chat grounded on). Good and bad outcomes read the same
 * way: the points and which side of them you are on, never a letter and never softened.
 *
 * ⚠ NOT RENDERED WITH NOTHING TO SAY. `data` null, or no receipt of any kind AND nothing
 * too early, pending, unscored or unreadable to mention, renders nothing — an empty card on
 * the home is noise, not honesty.
 *
 * Spanish (2026-10-04): every line here is composed in this file from the receipt's numbers and
 * names, so each is written in both languages beside each other; Chimmy's record line goes through
 * dashboard3aCopy's `trackRecordText` (its English, `describeTrackRecord`, also feeds the chat model
 * and is left alone). The provider starts at English on server and client alike, so the first paint
 * agrees.
 */

/** 'AF' is the home triage card's rule-based "swap in X" tip — AllFantasy's, never Chimmy's. */
type Adviser = 'AutoCoach' | 'Chimmy' | 'AF'

type ReceiptsMessages = typeof receiptsCardMessages.en

function signed(n: number): string {
  const r = Math.round(n * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`
}

function list(names: string[], m: ReceiptsMessages): string {
  if (names.length === 0) return m.nothing
  return names.length <= 2 ? names.join(m.and) : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

function WaiverRow({ w }: { w: WaiverReceipt }) {
  const m = useMessages(receiptsCardMessages)
  return (
    <li className="af3a-receipt" data-kind="waiver">
      <Link className="af3a-receipt-title" href={w.href}>
        {m.youAdded(w.playerName)}
        {w.position ? ` (${w.position})` : ''}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {w.leagueName} · {w.season} {m.wk} {w.week}
        {w.faab != null ? ` · $${w.faab} FAAB` : ''}
      </span>
      <span className="af3a-receipt-result">
        <b className="af3a-mono">{w.points.toFixed(1)} pts</b>
        {m.forYou}
        {m.starts(w.starts)}
        {w.leftWeek != null ? m.goneWeek(w.leftWeek) : m.stillYours}
      </span>
    </li>
  )
}

function LineupRow({ l }: { l: LineupReceipt }) {
  const m = useMessages(receiptsCardMessages)
  const describe = (players: Array<{ name: string; points: number }>) => {
    return players.map((p) => `${p.name} (${p.points.toFixed(1)})`).join(', ')
  }
  const changes = !l.perfect && l.lineupChanges && (l.lineupChanges.in.length > 0 || l.lineupChanges.out.length > 0)
    ? l.lineupChanges
    : null
  return (
    <li className="af3a-receipt" data-kind="lineup" data-outcome={l.perfect ? 'ahead' : undefined}>
      <Link className="af3a-receipt-title" href={l.href}>
        {l.perfect ? m.perfectLineup(l.week) : m.leftOnBench(l.pointsLeft.toFixed(1))}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {l.leagueName} · {l.season} {m.wk} {l.week}
      </span>
      {changes ? (
        <span className="af3a-receipt-swap">
          {m.bestLegalLineup}
          {changes.in.length > 0 ? m.startsPlayers(describe(changes.in)) : ''}
          {changes.in.length > 0 && changes.out.length > 0 ? ' · ' : ''}
          {changes.out.length > 0 ? m.benchesPlayers(describe(changes.out)) : ''}
        </span>
      ) : !l.perfect && l.benched ? (
        <span className="af3a-receipt-swap">
          {m.includesBenched(l.benched.name, l.benched.points.toFixed(1))}
        </span>
      ) : null}
    </li>
  )
}

/**
 * "X said start A over B". Always SAID — neither AutoCoach on an imported league nor Chimmy
 * changes the lineup the platform scores, so whether you followed it is its own line.
 */
function StartCallRow({
  c,
  who,
  confidencePct,
}: {
  c: StartCallReceipt
  who: Adviser
  confidencePct?: number | null
}) {
  const m = useMessages(receiptsCardMessages)
  const outcome = c.call === 'right' ? 'ahead' : c.call === 'wrong' ? 'behind' : undefined
  return (
    <li className="af3a-receipt" data-kind={who === 'AutoCoach' ? 'autocoach' : who === 'AF' ? 'af-tip' : 'chimmy'} data-outcome={outcome}>
      <Link className="af3a-receipt-title" href={c.href}>
        {m.saidStart(who, c.recommended.name, c.instead.name)}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {c.leagueName} · {c.season} {m.wk} {c.week}
        {c.slot ? ` · ${c.slot}` : ''}
        {confidencePct != null ? m.confident(confidencePct) : ''}
      </span>
      <span className="af3a-receipt-result">
        <b className="af3a-mono">
          {c.recommended.name} {c.recommended.points.toFixed(1)}
        </b>{' '}
        · {c.instead.name} {c.instead.points.toFixed(1)} — {m.callResult(who, c.call)}
      </span>
      <span className="af3a-receipt-note">
        {c.followed === 'yes'
          ? m.followedYes(c.recommended.name)
          : c.followed === 'no'
            ? m.followedNo(c.instead.name)
            : m.followedUnclear}
      </span>
    </li>
  )
}

/**
 * "Chimmy said add X". Whether that was a good add is not judged here — the points he scored for
 * you are the receipt. A player you passed on gets no points: a free agent's are not on file.
 */
function AddCallRow({ a }: { a: ChimmyAddReceipt }) {
  const m = useMessages(receiptsCardMessages)
  return (
    <li className="af3a-receipt" data-kind="chimmy-add">
      <Link className="af3a-receipt-title" href={a.href}>
        {m.saidAdd(a.playerName)}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {a.leagueName} · {a.season} {m.wk} {a.week}
        {a.confidencePct != null ? m.confident(a.confidencePct) : ''}
      </span>
      <span className="af3a-receipt-result">
        {a.added ? (
          <>
            <b className="af3a-mono">{a.added.points.toFixed(1)} pts</b>
            {m.addedInWeek(a.added.week)}
            {m.starts(a.added.starts)}
            {a.added.leftWeek != null ? m.goneWeek(a.added.leftWeek) : m.stillYours}
          </>
        ) : (
          m.notAdded
        )}
      </span>
    </li>
  )
}

/** The counted-not-shown notes shared by the AutoCoach and Chimmy groups. */
function CallNotes({
  who,
  pending,
  unscored,
  unreadable,
}: {
  who: Adviser
  pending: number
  unscored: number
  unreadable: number
}) {
  const m = useMessages(receiptsCardMessages)
  return (
    <>
      {pending > 0 ? <p className="af3a-exp-note">{m.callsPending(pending, who)}</p> : null}
      {unscored > 0 ? <p className="af3a-exp-note">{m.callsUnscored(unscored)}</p> : null}
      {unreadable > 0 ? <p className="af3a-exp-note">{m.callsUnreadable(unreadable)}</p> : null}
    </>
  )
}

export function ReceiptsCard({ data, help }: { data: DecisionReceiptsData | null; help?: ReactNode }) {
  const { language } = useOptionalLanguage()
  const es = spanishFlag(language)
  const m = useMessages(receiptsCardMessages)
  if (!data) return null
  const waivers = data.waivers ?? []
  const waiversTooEarly = data.waiversTooEarly ?? 0
  const waiversUnscored = data.waiversUnscored ?? 0
  const lineups = data.lineups ?? []
  const lineupsUnscored = data.lineupsUnscored ?? 0
  const lineupsUnreadable = data.lineupsUnreadable ?? 0
  const autocoach = data.autocoach ?? []
  const autocoachPending = data.autocoachPending ?? 0
  const autocoachUnscored = data.autocoachUnscored ?? 0
  const autocoachUnreadable = data.autocoachUnreadable ?? 0
  const chimmyRecord = readTrackRecordLine(data.chimmyRecord)
  const chimmy: ChimmyReceipt[] = data.chimmy ?? []
  const chimmyPending = data.chimmyPending ?? 0
  const chimmyUnscored = data.chimmyUnscored ?? 0
  const chimmyUnreadable = data.chimmyUnreadable ?? 0
  const chimmyAdds: ChimmyAddReceipt[] = data.chimmyAdds ?? []
  const chimmyAddsTooEarly = data.chimmyAddsTooEarly ?? 0
  const chimmyAddsUnscored = data.chimmyAddsUnscored ?? 0
  const chimmyAddsUnknown = data.chimmyAddsUnknown ?? 0
  const hasTrades = data.trades.length > 0 || data.tooEarly > 0
  const hasWaivers = waivers.length > 0 || waiversTooEarly > 0 || waiversUnscored > 0
  const hasLineups = lineups.length > 0 || lineupsUnscored > 0 || lineupsUnreadable > 0
  const hasAutoCoach = autocoach.length > 0 || autocoachPending > 0 || autocoachUnscored > 0 || autocoachUnreadable > 0
  const hasChimmyAdds = chimmyAdds.length > 0 || chimmyAddsTooEarly > 0 || chimmyAddsUnscored > 0 || chimmyAddsUnknown > 0
  const hasChimmy =
    chimmyRecord != null || chimmy.length > 0 || chimmyPending > 0 || chimmyUnscored > 0 || chimmyUnreadable > 0 || hasChimmyAdds
  const afTips: ChimmyReceipt[] = data.afTips ?? []
  const hasAfTips = afTips.length > 0
  const kinds = [hasTrades, hasWaivers, hasLineups, hasAutoCoach, hasChimmy, hasAfTips].filter(Boolean).length
  if (kinds === 0) return null
  const headed = kinds > 1

  return (
    <section className="af3a-card af3a-receipts">
      <header className="af3a-cardhead">
        {/* "Resultados de tus decisiones" — the title of this card's own "?" (help-topics/home.ts `homeReceipts`). */}
        <span className="af3a-label">{m.label}</span>
        {help}
      </header>

      {hasTrades ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">{m.trades}</h3> : null}
          {data.trades.length > 0 ? (
            <ul className="af3a-receipt-list">
              {data.trades.map((t) => (
                <li key={`${t.leagueId}:${t.id}`} className="af3a-receipt" data-outcome={t.outcome}>
                  <Link className="af3a-receipt-title" href={t.href}>
                    {m.yourTrade(t.counterparty)}
                  </Link>
                  <span className="af3a-receipt-where af3a-mono">
                    {t.leagueName} · {t.season} {m.wk} {t.week}
                  </span>
                  <span className="af3a-receipt-swap">
                    {m.gaveGot(list(t.gave, m), list(t.got, m))}
                  </span>
                  <span className="af3a-receipt-result">
                    <b className="af3a-mono">{signed(t.netPoints)} pts</b>{' '}
                    {m.sinceOutcome(t.outcome, t.ongoing)}
                  </span>
                  {t.unsettledPicks > 0 ? (
                    <span className="af3a-receipt-note">
                      {m.unsettledPicks(t.unsettledPicks)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {data.tooEarly > 0 ? (
            <p className="af3a-exp-note">
              {m.tradesTooEarly(data.tooEarly)}
            </p>
          ) : null}
        </>
      ) : null}

      {hasWaivers ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">{m.waiverAdds}</h3> : null}
          {waivers.length > 0 ? (
            <ul className="af3a-receipt-list">
              {waivers.map((w) => (
                <WaiverRow key={w.id} w={w} />
              ))}
            </ul>
          ) : null}
          {waiversTooEarly > 0 ? (
            <p className="af3a-exp-note">
              {m.waiversTooEarly(waiversTooEarly)}
            </p>
          ) : null}
          {waiversUnscored > 0 ? (
            <p className="af3a-exp-note">
              {m.waiversUnscored(waiversUnscored)}
            </p>
          ) : null}
        </>
      ) : null}

      {hasLineups ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">{m.lineups}</h3> : null}
          {lineups.length > 0 ? (
            <ul className="af3a-receipt-list">
              {lineups.map((l) => (
                <LineupRow key={l.id} l={l} />
              ))}
            </ul>
          ) : null}
          {lineupsUnscored > 0 ? (
            <p className="af3a-exp-note">
              {m.lineupsUnscored(lineupsUnscored)}
            </p>
          ) : null}
          {lineupsUnreadable > 0 ? (
            <p className="af3a-exp-note">{m.lineupsUnreadable(lineupsUnreadable)}</p>
          ) : null}
        </>
      ) : null}

      {hasAutoCoach ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">AutoCoach</h3> : null}
          {autocoach.length > 0 ? (
            <ul className="af3a-receipt-list">
              {autocoach.map((a) => (
                <StartCallRow key={a.id} c={a} who="AutoCoach" />
              ))}
            </ul>
          ) : null}
          <CallNotes who="AutoCoach" pending={autocoachPending} unscored={autocoachUnscored} unreadable={autocoachUnreadable} />
        </>
      ) : null}

      {hasChimmy ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">Chimmy</h3> : null}
          {chimmyRecord ? (
            /*
             * The whole record, not just the rows below: every start/sit call Chimmy made you that has
             * been graded against the real scores. The percentage appears only once it means something.
             */
            <p className="af3a-receipt-record" data-kind="chimmy-record">
              <b>{m.chimmyRecord}</b>{' '}
              <span className="af3a-mono">{trackRecordText(chimmyRecord, describeTrackRecord(chimmyRecord), language)}</span>
            </p>
          ) : null}
          {chimmy.length > 0 ? (
            <ul className="af3a-receipt-list">
              {chimmy.map((c) => (
                <StartCallRow key={c.id} c={c} who="Chimmy" confidencePct={c.confidencePct} />
              ))}
            </ul>
          ) : null}
          <CallNotes who="Chimmy" pending={chimmyPending} unscored={chimmyUnscored} unreadable={chimmyUnreadable} />
          {chimmyAdds.length > 0 ? (
            <ul className="af3a-receipt-list">
              {chimmyAdds.map((a) => (
                <AddCallRow key={a.id} a={a} />
              ))}
            </ul>
          ) : null}
          {chimmyAddsTooEarly > 0 ? (
            <p className="af3a-exp-note">
              {m.addCallsTooEarly(chimmyAddsTooEarly)}
            </p>
          ) : null}
          {chimmyAddsUnscored > 0 ? (
            <p className="af3a-exp-note">{m.addCallsUnscored(chimmyAddsUnscored)}</p>
          ) : null}
          {chimmyAddsUnknown > 0 ? (
            <p className="af3a-exp-note">{m.addCallsUnknown(chimmyAddsUnknown)}</p>
          ) : null}
        </>
      ) : null}

      {hasAfTips ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">{m.afSwapTips}</h3> : null}
          <ul className="af3a-receipt-list">
            {afTips.map((t) => (
              <Fragment key={t.id}>
                <StartCallRow c={t} who="AF" />
                {/* A brag only when it is one: you followed the tip and it outscored the alternative. */}
                {t.call === 'right' && t.followed === 'yes' ? (
                  <li className="af3a-receipt-share-row">
                    <AfSavedShare
                      tip={{ recommended: t.recommended, instead: t.instead, leagueName: t.leagueName, week: t.week }}
                      es={es}
                    />
                  </li>
                ) : null}
              </Fragment>
            ))}
          </ul>
        </>
      ) : null}

      {data.uncoveredLeagues > 0 ? (
        <p className="af3a-exp-note">
          {m.sleeperOnly}
        </p>
      ) : null}
    </section>
  )
}

export default ReceiptsCard
