import { defineMessages } from '@/lib/i18n/messages'
import type { LetterVerdict } from '@/lib/chimmy-outcomes/engineRecord'
import type { TradeConfidenceLevel } from '@/lib/decision-os/trade/letterCalibration'

/**
 * AllFantasy's graded record, shown beside the call it grades (`lib/chimmy-outcomes/engineRecord.ts`): under a
 * trade grade in the Trade Center, and under the waiver panel's list. A trade is «intercambio» as on the rest
 * of /core; the pickup line says «recomendación», never «waiver».
 *
 * `tradeConfidence` is how sure a letter is, from its graded deals (`lib/decision-os/trade/letterCalibration.ts`): it is
 * said BESIDE the letter and never changes it.
 */

const LEVEL_EN: Record<TradeConfidenceLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' }
const LEVEL_ES: Record<TradeConfidenceLevel, string> = { high: 'Alta', medium: 'Media', low: 'Baja' }

const abs1 = (n: number) => Math.abs(n).toFixed(1)

export const adviceRecordMessages = defineMessages({
  en: {
    /** The small label over every measured line (`components/core-app/primitives/EvidenceLine.tsx`). */
    recordLabel: 'Track record',
    tradeRecord: (letter: string, n: number, netPerWeek: number, aheadPct: number | null, verdict: LetterVerdict) =>
      `How ${letter} grades have held up: across ${n} graded redraft trades, the team we graded ${letter} scored ` +
      `${abs1(netPerWeek)} PPR a week ${netPerWeek >= 0 ? 'more' : 'less'} than the players it gave up` +
      `${aheadPct != null ? ` (ahead in ${aheadPct}%)` : ''}.` +
      (verdict === 'held_up' ? ' This letter has held up.' : verdict === 'not_held_up' ? ' This letter has not held up so far, so weigh it with care.' : ''),
    pickupRecord: (ratePct: number, graded: number) =>
      `How this panel’s #1 pickup has done this season: ${ratePct}% averaged 10+ PPR a week over the next three weeks (${graded} graded).`,
    /** The trade review's line. `commissioner` = over trades commissioners reviewed; otherwise over every graded deal. */
    commissionerTradeRecord: (scope: 'commissioner' | 'everyone', letter: string, n: number, netPerWeek: number, verdict: LetterVerdict) =>
      `${scope === 'commissioner' ? `Trades commissioners reviewed at ${letter}` : `Trades graded ${letter}`}: across ${n} graded redraft deals, ` +
      `the side graded ${letter} scored ${abs1(netPerWeek)} PPR a week ${netPerWeek >= 0 ? 'more' : 'less'} than it gave up.` +
      (verdict === 'held_up' ? ' The letter has held up.' : verdict === 'not_held_up' ? ' The letter has not held up so far, so weigh it with care.' : ''),
    /** Another sport or league type (`engineRecord.tradeOutcomeRecordFor`): its own measure, said plainly. */
    tradeOutcomeRecord: (kind: 'points' | 'value' | 'categories', sport: string, letter: string, n: number, net: number, aheadPct: number | null, verdict: LetterVerdict) =>
      (kind === 'value'
        ? `How ${letter} grades have held up in dynasty-style leagues: across ${n} graded trades, the team we graded ${letter} held ` +
          `${abs1(net)} points ${net >= 0 ? 'more' : 'less'} of the deal's dynasty value than it gave up, a month or more later`
        : kind === 'categories'
        ? `How ${letter} grades have held up in ${sport} category leagues: across ${n} graded trades, the team we graded ${letter} won ` +
          `${abs1(net)} ${net >= 0 ? 'more' : 'fewer'} of the league's categories than it lost over the weeks after`
        : `How ${letter} grades have held up in ${sport} leagues like this one: across ${n} graded trades, the team we graded ${letter} scored ` +
          `${abs1(net)} points a week ${net >= 0 ? 'more' : 'less'} than the players it gave up, under each league's own scoring`) +
      `${aheadPct != null ? ` (ahead in ${aheadPct}%)` : ''}.` +
      (verdict === 'held_up' ? ' This letter has held up.' : verdict === 'not_held_up' ? ' This letter has not held up so far, so weigh it with care.' : ''),
    tradeConfidence: (letter: string, level: TradeConfidenceLevel, heldPct: number, decided: number) =>
      `How sure this ${letter} is: ${LEVEL_EN[level]}. About ${heldPct}% of our ${letter} grades on redraft trades have held up ` +
      `(${decided} decided, recent ones weighted more).` +
      (level === 'low' ? ' Treat this deal as closer than the letter suggests.' : ''),
  },
  es: {
    recordLabel: 'Historial',
    tradeRecord: (letter: string, n: number, netPerWeek: number, aheadPct: number | null, verdict: LetterVerdict) =>
      `Cómo les ha ido a las notas ${letter}: en ${n} intercambios redraft evaluados, el equipo con nota ${letter} sumó ` +
      `${abs1(netPerWeek)} puntos PPR por semana ${netPerWeek >= 0 ? 'más' : 'menos'} que los jugadores que cedió` +
      `${aheadPct != null ? ` (por delante en el ${aheadPct}%)` : ''}.` +
      (verdict === 'held_up' ? ' Esta nota se ha sostenido.' : verdict === 'not_held_up' ? ' Esta nota no se ha sostenido hasta ahora: tómala con cautela.' : ''),
    pickupRecord: (ratePct: number, graded: number) =>
      `Cómo le ha ido a la primera recomendación de este panel esta temporada: el ${ratePct}% promedió 10+ puntos PPR por semana en las tres semanas siguientes (${graded} evaluadas).`,
    commissionerTradeRecord: (scope: 'commissioner' | 'everyone', letter: string, n: number, netPerWeek: number, verdict: LetterVerdict) =>
      `${scope === 'commissioner' ? `Intercambios que los comisionados revisaron con nota ${letter}` : `Intercambios con nota ${letter}`}: en ${n} intercambios redraft evaluados, ` +
      `el lado con nota ${letter} sumó ${abs1(netPerWeek)} puntos PPR por semana ${netPerWeek >= 0 ? 'más' : 'menos'} que lo que cedió.` +
      (verdict === 'held_up' ? ' La nota se ha sostenido.' : verdict === 'not_held_up' ? ' La nota no se ha sostenido hasta ahora: tómala con cautela.' : ''),
    tradeOutcomeRecord: (kind: 'points' | 'value' | 'categories', sport: string, letter: string, n: number, net: number, aheadPct: number | null, verdict: LetterVerdict) =>
      (kind === 'value'
        ? `Cómo les ha ido a las notas ${letter} en ligas tipo dynasty: en ${n} intercambios evaluados, el equipo con nota ${letter} conservó ` +
          `${abs1(net)} puntos ${net >= 0 ? 'más' : 'menos'} del valor dynasty del intercambio que lo que cedió, un mes o más después`
        : kind === 'categories'
        ? `Cómo les ha ido a las notas ${letter} en ligas de categorías de ${sport}: en ${n} intercambios evaluados, el equipo con nota ${letter} ganó ` +
          `${abs1(net)} categorías de la liga ${net >= 0 ? 'más' : 'menos'} de las que perdió en las semanas siguientes`
        : `Cómo les ha ido a las notas ${letter} en ligas de ${sport} como esta: en ${n} intercambios evaluados, el equipo con nota ${letter} sumó ` +
          `${abs1(net)} puntos por semana ${net >= 0 ? 'más' : 'menos'} que los jugadores que cedió, con la puntuación de cada liga`) +
      `${aheadPct != null ? ` (por delante en el ${aheadPct}%)` : ''}.` +
      (verdict === 'held_up' ? ' Esta nota se ha sostenido.' : verdict === 'not_held_up' ? ' Esta nota no se ha sostenido hasta ahora: tómala con cautela.' : ''),
    tradeConfidence: (letter: string, level: TradeConfidenceLevel, heldPct: number, decided: number) =>
      `Qué tan segura es esta ${letter}: ${LEVEL_ES[level]}. Cerca del ${heldPct}% de nuestras notas ${letter} en intercambios redraft se han sostenido ` +
      `(${decided} decididos, los recientes pesan más).` +
      (level === 'low' ? ' Toma este intercambio como más parejo de lo que sugiere la nota.' : ''),
  },
})
