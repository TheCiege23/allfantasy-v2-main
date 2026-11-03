import { defineMessages } from '@/lib/i18n/messages'

/**
 * Since your last visit (components/core-app/screens/DashSinceLastVisitView.tsx). Every string is the
 * one the brief printed before the move, byte for byte, in both languages — this is a relocation, not
 * a rewrite. Spans arrive already worded by the view's `spanText`; designations, trade summaries,
 * alert groups and handoffs still go through `coreUiCopy` / `homeBandsCopy`.
 */
export const dashSinceLastVisitMessages = defineMessages({
  en: {
    title: 'Since your last visit',
    lastWeek: 'last 7 days',
    /** A span of time, "5m" / "5 min" — fed to `since` and `reaches`. */
    span: (n: number, unit: 'm' | 'h' | 'd'): string => `${n}${unit}`,
    since: (span: string) => `since ${span} ago`,
    reaches: (span: string) => `reaches ${span} further back`,
    noDesignation: 'no designation',
    went: (won: number, lost: number, tie: string, record: string) => `went ${won}–${lost}${tie}, now ${record}`,
    moved: (up: boolean, rank: number, previousRank: number) => `${up ? 'up' : 'down'} to #${rank} (was #${previousRank})`,
    newTrade: 'new trade',
    newTrades: 'new trades',
    injuryChanges: (injuryCount: number, anyFollowedOnly: boolean) =>
      `${injuryCount} injury change${injuryCount === 1 ? '' : 's'} ${
        anyFollowedOnly ? 'on your rosters and players you follow' : 'on your rosters'
      }`,
    following: 'Following',
    ofYourLeagues: (n: number) => `${n} of your leagues`,
    more: (n: number) => `+${n} more`,
    results: (n: number) => `Results in ${n} league${n === 1 ? '' : 's'}`,
    unreadAlerts: (total: number) => `${total} unread alert${total === 1 ? '' : 's'}`,
    openAlerts: 'Open alerts',
    comparisonPending:
      'Injury and standings changes appear from your next visit — this is the first time we have a picture to compare against.',
    /** A trade's summary: the loader's English, or (Spanish) its rebuild from `parts` when there is one. */
    tradeSummary: (summary: string, _rebuilt: string | null): string => summary,
  },
  es: {
    title: 'Desde tu última visita',
    lastWeek: 'últimos 7 días',
    span: (n, unit) => `${n} ${unit === 'm' ? 'min' : unit}`,
    since: (span) => `desde hace ${span}`,
    reaches: (span) => `llega ${span} más atrás`,
    noDesignation: 'sin designación',
    went: (won, lost, tie, record) => `quedó ${won}–${lost}${tie}, ahora ${record}`,
    moved: (up, rank, previousRank) => `${up ? 'sube' : 'baja'} al #${rank} (antes #${previousRank})`,
    newTrade: 'intercambio nuevo',
    newTrades: 'intercambios nuevos',
    injuryChanges: (injuryCount, anyFollowedOnly) =>
      `${injuryCount} ${injuryCount === 1 ? 'cambio de lesión' : 'cambios de lesión'} ${
        anyFollowedOnly ? 'en tus plantillas y jugadores que sigues' : 'en tus plantillas'
      }`,
    following: 'Siguiendo',
    ofYourLeagues: (n) => `${n} de tus ligas`,
    more: (n) => `+${n} más`,
    results: (n) => `Resultados en ${n} ${n === 1 ? 'liga' : 'ligas'}`,
    unreadAlerts: (total) => `${total} ${total === 1 ? 'alerta sin leer' : 'alertas sin leer'}`,
    openAlerts: 'Abrir alertas',
    comparisonPending:
      'Los cambios de lesiones y clasificaciones aparecen desde tu próxima visita: es la primera vez que tenemos una referencia con la que comparar.',
    tradeSummary: (summary, rebuilt) => rebuilt ?? summary,
  },
})
