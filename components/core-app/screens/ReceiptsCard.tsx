'use client'

import type { ReactNode } from 'react'
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
import { trackRecordText } from '@/lib/core-app/dashboard3aCopy'

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

const OUTCOME_TEXT: Record<TradeReceipt['outcome'], string> = {
  ahead: 'you’re ahead',
  behind: 'you’re behind',
  even: 'about even',
}

const OUTCOME_TEXT_ES: Record<TradeReceipt['outcome'], string> = {
  ahead: 'vas ganando',
  behind: 'vas perdiendo',
  even: 'más o menos parejo',
}

type Adviser = 'AutoCoach' | 'Chimmy'

function callText(who: Adviser, call: StartCallReceipt['call'], es: boolean): string {
  if (es) return call === 'same' ? 'más o menos igual' : call === 'right' ? `${who} acertó` : `${who} falló`
  return call === 'same' ? 'about the same' : `${who} was ${call}`
}

function signed(n: number): string {
  const r = Math.round(n * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`
}

function list(names: string[], es: boolean): string {
  if (names.length === 0) return es ? 'nada' : 'nothing'
  return names.length <= 2 ? names.join(es ? ' y ' : ' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

/** "titularidad" — a week he was in your starting lineup. */
function startsEs(n: number): string {
  return `${n} ${n === 1 ? 'titularidad' : 'titularidades'}`
}

function WaiverRow({ w, es }: { w: WaiverReceipt; es: boolean }) {
  if (es) {
    return (
      <li className="af3a-receipt" data-kind="waiver">
        <Link className="af3a-receipt-title" href={w.href}>
          Incorporaste a {w.playerName}
          {w.position ? ` (${w.position})` : ''}
        </Link>
        <span className="af3a-receipt-where af3a-mono">
          {w.leagueName} · {w.season} sem. {w.week}
          {w.faab != null ? ` · $${w.faab} FAAB` : ''}
        </span>
        <span className="af3a-receipt-result">
          <b className="af3a-mono">{w.points.toFixed(1)} pts</b> para ti · {startsEs(w.starts)}
          {w.leftWeek != null ? ` · se fue en la sem. ${w.leftWeek}` : ' (sigue en tu equipo)'}
        </span>
      </li>
    )
  }
  return (
    <li className="af3a-receipt" data-kind="waiver">
      <Link className="af3a-receipt-title" href={w.href}>
        You added {w.playerName}
        {w.position ? ` (${w.position})` : ''}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {w.leagueName} · {w.season} wk {w.week}
        {w.faab != null ? ` · $${w.faab} FAAB` : ''}
      </span>
      <span className="af3a-receipt-result">
        <b className="af3a-mono">{w.points.toFixed(1)} pts</b> for you ·{' '}
        {w.starts} start{w.starts === 1 ? '' : 's'}
        {w.leftWeek != null ? ` · gone wk ${w.leftWeek}` : ' (still yours)'}
      </span>
    </li>
  )
}

function LineupRow({ l, es }: { l: LineupReceipt; es: boolean }) {
  const describe = (players: Array<{ name: string; points: number }>) => {
    return players.map((p) => `${p.name} (${p.points.toFixed(1)})`).join(', ')
  }
  const changes = !l.perfect && l.lineupChanges && (l.lineupChanges.in.length > 0 || l.lineupChanges.out.length > 0)
    ? l.lineupChanges
    : null
  return (
    <li className="af3a-receipt" data-kind="lineup" data-outcome={l.perfect ? 'ahead' : undefined}>
      <Link className="af3a-receipt-title" href={l.href}>
        {es
          ? l.perfect
            ? `Alineación perfecta en la semana ${l.week}`
            : `Dejaste ${l.pointsLeft.toFixed(1)} pts en tu banca`
          : l.perfect
            ? `Perfect lineup in week ${l.week}`
            : `You left ${l.pointsLeft.toFixed(1)} pts on your bench`}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {l.leagueName} · {l.season} {es ? 'sem.' : 'wk'} {l.week}
      </span>
      {changes && es ? (
        <span className="af3a-receipt-swap">
          Mejor alineación válida: {changes.in.length > 0 ? `alinea a ${describe(changes.in)}` : ''}
          {changes.in.length > 0 && changes.out.length > 0 ? ' · ' : ''}
          {changes.out.length > 0 ? `sienta a ${describe(changes.out)}` : ''}
        </span>
      ) : changes ? (
        <span className="af3a-receipt-swap">
          Best legal lineup: {changes.in.length > 0 ? `starts ${describe(changes.in)}` : ''}
          {changes.in.length > 0 && changes.out.length > 0 ? ' · ' : ''}
          {changes.out.length > 0 ? `benches ${describe(changes.out)}` : ''}
        </span>
      ) : !l.perfect && l.benched ? (
        <span className="af3a-receipt-swap">
          {es
            ? `La mejor alineación válida incluye a ${l.benched.name} (${l.benched.points.toFixed(1)}).`
            : `Best legal lineup includes ${l.benched.name} (${l.benched.points.toFixed(1)}).`}
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
  es,
}: {
  c: StartCallReceipt
  who: Adviser
  confidencePct?: number | null
  es: boolean
}) {
  const outcome = c.call === 'right' ? 'ahead' : c.call === 'wrong' ? 'behind' : undefined
  return (
    <li className="af3a-receipt" data-kind={who === 'AutoCoach' ? 'autocoach' : 'chimmy'} data-outcome={outcome}>
      <Link className="af3a-receipt-title" href={c.href}>
        {es
          ? `${who} dijo que alinearas a ${c.recommended.name} en lugar de ${c.instead.name}`
          : `${who} said start ${c.recommended.name} over ${c.instead.name}`}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {c.leagueName} · {c.season} {es ? 'sem.' : 'wk'} {c.week}
        {c.slot ? ` · ${c.slot}` : ''}
        {confidencePct != null ? (es ? ` · ${confidencePct}% de confianza` : ` · ${confidencePct}% confident`) : ''}
      </span>
      <span className="af3a-receipt-result">
        <b className="af3a-mono">
          {c.recommended.name} {c.recommended.points.toFixed(1)}
        </b>{' '}
        · {c.instead.name} {c.instead.points.toFixed(1)} — {callText(who, c.call, es)}
      </span>
      <span className="af3a-receipt-note">
        {es
          ? c.followed === 'yes'
            ? `Alineaste a ${c.recommended.name} en Sleeper.`
            : c.followed === 'no'
              ? `Mantuviste a ${c.instead.name} en Sleeper.`
              : 'Tu alineación de Sleeper no coincidió con ninguna de las dos opciones.'
          : c.followed === 'yes'
            ? `You started ${c.recommended.name} on Sleeper.`
            : c.followed === 'no'
              ? `You kept ${c.instead.name} in on Sleeper.`
              : 'Your Sleeper lineup didn’t match either way.'}
      </span>
    </li>
  )
}

/**
 * "Chimmy said add X". Whether that was a good add is not judged here — the points he scored for
 * you are the receipt. A player you passed on gets no points: a free agent's are not on file.
 */
function AddCallRow({ a, es }: { a: ChimmyAddReceipt; es: boolean }) {
  return (
    <li className="af3a-receipt" data-kind="chimmy-add">
      <Link className="af3a-receipt-title" href={a.href}>
        {es ? `Chimmy dijo que incorporaras a ${a.playerName}` : `Chimmy said add ${a.playerName}`}
      </Link>
      <span className="af3a-receipt-where af3a-mono">
        {a.leagueName} · {a.season} {es ? 'sem.' : 'wk'} {a.week}
        {a.confidencePct != null ? (es ? ` · ${a.confidencePct}% de confianza` : ` · ${a.confidencePct}% confident`) : ''}
      </span>
      <span className="af3a-receipt-result">
        {a.added && es ? (
          <>
            <b className="af3a-mono">{a.added.points.toFixed(1)} pts</b> para ti · lo incorporaste en la sem. {a.added.week} ·{' '}
            {startsEs(a.added.starts)}
            {a.added.leftWeek != null ? ` · se fue en la sem. ${a.added.leftWeek}` : ' (sigue en tu equipo)'}
          </>
        ) : a.added ? (
          <>
            <b className="af3a-mono">{a.added.points.toFixed(1)} pts</b> for you · you added him wk {a.added.week} ·{' '}
            {a.added.starts} start{a.added.starts === 1 ? '' : 's'}
            {a.added.leftWeek != null ? ` · gone wk ${a.added.leftWeek}` : ' (still yours)'}
          </>
        ) : es ? (
          'No lo incorporaste.'
        ) : (
          'You didn’t add him.'
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
  es,
}: {
  who: Adviser
  pending: number
  unscored: number
  unreadable: number
  es: boolean
}) {
  if (es) {
    return (
      <>
        {pending > 0 ? (
          <p className="af3a-exp-note">
            {pending === 1 ? `1 consejo de ${who} es` : `${pending} consejos de ${who} son`} de una semana que aún se
            está jugando.
          </p>
        ) : null}
        {unscored > 0 ? (
          <p className="af3a-exp-note">
            {unscored === 1 ? '1 consejo aún no tiene' : `${unscored} consejos aún no tienen`} puntuaciones semanales
            registradas.
          </p>
        ) : null}
        {unreadable > 0 ? (
          <p className="af3a-exp-note">
            {unreadable === 1 ? '1 consejo no se pudo emparejar' : `${unreadable} consejos no se pudieron emparejar`} con
            una semana ni con tu plantilla de esa semana.
          </p>
        ) : null}
      </>
    )
  }
  return (
    <>
      {pending > 0 ? (
        <p className="af3a-exp-note">
          {pending} {who} call{pending === 1 ? ' is' : 's are'} for a week still being played.
        </p>
      ) : null}
      {unscored > 0 ? (
        <p className="af3a-exp-note">
          {unscored} call{unscored === 1 ? ' has' : 's have'} no weekly scores on file yet.
        </p>
      ) : null}
      {unreadable > 0 ? (
        <p className="af3a-exp-note">
          {unreadable} call{unreadable === 1 ? '' : 's'} couldn’t be matched to a week or to your roster that week.
        </p>
      ) : null}
    </>
  )
}

export function ReceiptsCard({ data, help }: { data: DecisionReceiptsData | null; help?: ReactNode }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
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
  const kinds = [hasTrades, hasWaivers, hasLineups, hasAutoCoach, hasChimmy].filter(Boolean).length
  if (kinds === 0) return null
  const headed = kinds > 1

  return (
    <section className="af3a-card af3a-receipts">
      <header className="af3a-cardhead">
        {/* "Resultados de tus decisiones" — the title of this card's own "?" (help-topics/home.ts `homeReceipts`). */}
        <span className="af3a-label">{es ? 'RESULTADOS DE TUS DECISIONES' : 'RECEIPTS'}</span>
        {help}
      </header>

      {hasTrades ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">{es ? 'Intercambios' : 'Trades'}</h3> : null}
          {data.trades.length > 0 ? (
            <ul className="af3a-receipt-list">
              {data.trades.map((t) => (
                <li key={`${t.leagueId}:${t.id}`} className="af3a-receipt" data-outcome={t.outcome}>
                  <Link className="af3a-receipt-title" href={t.href}>
                    {es
                      ? `Tu intercambio${t.counterparty ? ` con ${t.counterparty}` : ''}`
                      : `Your trade${t.counterparty ? ` with ${t.counterparty}` : ''}`}
                  </Link>
                  <span className="af3a-receipt-where af3a-mono">
                    {t.leagueName} · {t.season} {es ? 'sem.' : 'wk'} {t.week}
                  </span>
                  <span className="af3a-receipt-swap">
                    {es
                      ? `Diste ${list(t.gave, true)} · recibiste ${list(t.got, true)}`
                      : `Gave ${list(t.gave, false)} · got ${list(t.got, false)}`}
                  </span>
                  <span className="af3a-receipt-result">
                    <b className="af3a-mono">{signed(t.netPoints)} pts</b>{' '}
                    {es
                      ? `desde entonces: ${OUTCOME_TEXT_ES[t.outcome]}${t.ongoing ? ' (sigue contando)' : ''}`
                      : `since — ${OUTCOME_TEXT[t.outcome]}${t.ongoing ? ' (still counting)' : ''}`}
                  </span>
                  {t.unsettledPicks > 0 ? (
                    <span className="af3a-receipt-note">
                      {es
                        ? t.unsettledPicks === 1
                          ? '1 selección aún no se ha usado en un draft: no cuenta'
                          : `${t.unsettledPicks} selecciones aún no se han usado en un draft: no cuentan`
                        : `${t.unsettledPicks} pick${t.unsettledPicks === 1 ? '' : 's'} not drafted yet — not counted`}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {data.tooEarly > 0 ? (
            <p className="af3a-exp-note">
              {es
                ? `Es pronto para evaluar ${data.tooEarly === 1 ? '1 intercambio más reciente' : `${data.tooEarly} intercambios más recientes`}.`
                : `${data.tooEarly} newer trade${data.tooEarly === 1 ? ' is' : 's are'} too early to call.`}
            </p>
          ) : null}
        </>
      ) : null}

      {hasWaivers ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">{es ? 'Incorporaciones' : 'Waiver adds'}</h3> : null}
          {waivers.length > 0 ? (
            <ul className="af3a-receipt-list">
              {waivers.map((w) => (
                <WaiverRow key={w.id} w={w} es={es} />
              ))}
            </ul>
          ) : null}
          {waiversTooEarly > 0 ? (
            <p className="af3a-exp-note">
              {es
                ? `Es pronto para evaluar ${waiversTooEarly === 1 ? '1 incorporación reciente' : `${waiversTooEarly} incorporaciones recientes`}.`
                : `${waiversTooEarly} recent add${waiversTooEarly === 1 ? ' is' : 's are'} too early to call.`}
            </p>
          ) : null}
          {waiversUnscored > 0 ? (
            <p className="af3a-exp-note">
              {es
                ? `${waiversUnscored === 1 ? '1 incorporación aún no tiene' : `${waiversUnscored} incorporaciones aún no tienen`} puntuaciones semanales registradas.`
                : `${waiversUnscored} add${waiversUnscored === 1 ? ' has' : 's have'} no weekly scores on file yet.`}
            </p>
          ) : null}
        </>
      ) : null}

      {hasLineups ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">{es ? 'Alineaciones' : 'Lineups'}</h3> : null}
          {lineups.length > 0 ? (
            <ul className="af3a-receipt-list">
              {lineups.map((l) => (
                <LineupRow key={l.id} l={l} es={es} />
              ))}
            </ul>
          ) : null}
          {lineupsUnscored > 0 ? (
            <p className="af3a-exp-note">
              {es
                ? `${lineupsUnscored === 1 ? '1 semana reciente aún no tiene' : `${lineupsUnscored} semanas recientes aún no tienen`} puntuaciones semanales registradas.`
                : `${lineupsUnscored} recent week${lineupsUnscored === 1 ? ' has' : 's have'} no weekly scores on file yet.`}
            </p>
          ) : null}
          {lineupsUnreadable > 0 ? (
            es ? (
              <p className="af3a-exp-note">
                {lineupsUnreadable === 1 ? '1 semana no se pudo revisar' : `${lineupsUnreadable} semanas no se pudieron revisar`}:
                falta la posición de un titular o los puestos de alineación de la liga.
              </p>
            ) : (
              <p className="af3a-exp-note">
                {lineupsUnreadable} week{lineupsUnreadable === 1 ? '' : 's'} couldn’t be checked — a starter’s
                position or the league’s lineup slots aren’t on file.
              </p>
            )
          ) : null}
        </>
      ) : null}

      {hasAutoCoach ? (
        <>
          {headed ? <h3 className="af3a-receipt-group">AutoCoach</h3> : null}
          {autocoach.length > 0 ? (
            <ul className="af3a-receipt-list">
              {autocoach.map((a) => (
                <StartCallRow key={a.id} c={a} who="AutoCoach" es={es} />
              ))}
            </ul>
          ) : null}
          <CallNotes who="AutoCoach" pending={autocoachPending} unscored={autocoachUnscored} unreadable={autocoachUnreadable} es={es} />
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
              <b>{es ? 'Historial de Chimmy en tus decisiones de titular o banca:' : 'Chimmy’s record on your start/sit calls:'}</b>{' '}
              <span className="af3a-mono">{trackRecordText(chimmyRecord, describeTrackRecord(chimmyRecord), language)}</span>
            </p>
          ) : null}
          {chimmy.length > 0 ? (
            <ul className="af3a-receipt-list">
              {chimmy.map((c) => (
                <StartCallRow key={c.id} c={c} who="Chimmy" confidencePct={c.confidencePct} es={es} />
              ))}
            </ul>
          ) : null}
          <CallNotes who="Chimmy" pending={chimmyPending} unscored={chimmyUnscored} unreadable={chimmyUnreadable} es={es} />
          {chimmyAdds.length > 0 ? (
            <ul className="af3a-receipt-list">
              {chimmyAdds.map((a) => (
                <AddCallRow key={a.id} a={a} es={es} />
              ))}
            </ul>
          ) : null}
          {chimmyAddsTooEarly > 0 ? (
            <p className="af3a-exp-note">
              {es
                ? `Es pronto para evaluar ${chimmyAddsTooEarly === 1 ? '1 consejo de incorporación' : `${chimmyAddsTooEarly} consejos de incorporación`}.`
                : `${chimmyAddsTooEarly} add call${chimmyAddsTooEarly === 1 ? ' is' : 's are'} too early to call.`}
            </p>
          ) : null}
          {chimmyAddsUnscored > 0 ? (
            es ? (
              <p className="af3a-exp-note">
                {chimmyAddsUnscored === 1
                  ? '1 incorporación que hiciste por consejo de Chimmy aún no tiene'
                  : `${chimmyAddsUnscored} incorporaciones que hiciste por consejo de Chimmy aún no tienen`}{' '}
                puntuaciones semanales registradas.
              </p>
            ) : (
              <p className="af3a-exp-note">
                {chimmyAddsUnscored} add{chimmyAddsUnscored === 1 ? ' you made on Chimmy’s call has' : 's you made on Chimmy’s call have'} no
                weekly scores on file yet.
              </p>
            )
          ) : null}
          {chimmyAddsUnknown > 0 ? (
            es ? (
              <p className="af3a-exp-note">
                {chimmyAddsUnknown === 1
                  ? '1 consejo de incorporación aún no se pudo revisar'
                  : `${chimmyAddsUnknown} consejos de incorporación aún no se pudieron revisar`}
                : las transacciones de tu liga no se han sincronizado más allá de esa semana.
              </p>
            ) : (
              <p className="af3a-exp-note">
                {chimmyAddsUnknown} add call{chimmyAddsUnknown === 1 ? '' : 's'} couldn’t be checked yet — your league’s
                transactions haven’t synced past that week.
              </p>
            )
          ) : null}
        </>
      ) : null}

      {data.uncoveredLeagues > 0 ? (
        <p className="af3a-exp-note">
          {es ? 'Por ahora, estos resultados cubren tus ligas de Sleeper.' : 'Receipts cover your Sleeper leagues for now.'}
        </p>
      ) : null}
    </section>
  )
}

export default ReceiptsCard
