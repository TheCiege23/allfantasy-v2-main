import { defineMessages } from '@/lib/i18n/messages'
import type { LetterVerdict } from '@/lib/chimmy-outcomes/engineRecord'

/**
 * AllFantasy's graded record, shown beside the call it grades (`lib/chimmy-outcomes/engineRecord.ts`): under a
 * trade grade in the Trade Center, and under the waiver panel's list. A trade is «intercambio» as on the rest
 * of /core; the pickup line says «recomendación», never «waiver».
 */

const abs1 = (n: number) => Math.abs(n).toFixed(1)

export const adviceRecordMessages = defineMessages({
  en: {
    tradeRecord: (letter: string, n: number, netPerWeek: number, aheadPct: number | null, verdict: LetterVerdict) =>
      `How ${letter} grades have held up: across ${n} graded redraft trades, the team we graded ${letter} scored ` +
      `${abs1(netPerWeek)} PPR a week ${netPerWeek >= 0 ? 'more' : 'less'} than the players it gave up` +
      `${aheadPct != null ? ` (ahead in ${aheadPct}%)` : ''}.` +
      (verdict === 'held_up' ? ' This letter has held up.' : verdict === 'not_held_up' ? ' This letter has not held up so far, so weigh it with care.' : ''),
    pickupRecord: (ratePct: number, graded: number) =>
      `How this panel’s #1 pickup has done this season: ${ratePct}% averaged 10+ PPR a week over the next three weeks (${graded} graded).`,
  },
  es: {
    tradeRecord: (letter: string, n: number, netPerWeek: number, aheadPct: number | null, verdict: LetterVerdict) =>
      `Cómo les ha ido a las notas ${letter}: en ${n} intercambios redraft evaluados, el equipo con nota ${letter} sumó ` +
      `${abs1(netPerWeek)} puntos PPR por semana ${netPerWeek >= 0 ? 'más' : 'menos'} que los jugadores que cedió` +
      `${aheadPct != null ? ` (por delante en el ${aheadPct}%)` : ''}.` +
      (verdict === 'held_up' ? ' Esta nota se ha sostenido.' : verdict === 'not_held_up' ? ' Esta nota no se ha sostenido hasta ahora: tómala con cautela.' : ''),
    pickupRecord: (ratePct: number, graded: number) =>
      `Cómo le ha ido a la primera recomendación de este panel esta temporada: el ${ratePct}% promedió 10+ puntos PPR por semana en las tres semanas siguientes (${graded} evaluadas).`,
  },
})
