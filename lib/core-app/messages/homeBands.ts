import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core home bands' own fixed words that lib/core-app/homeBandsCopy.ts chooses by language (the
 * coarse countdown, the brief's alert groups and a trade's status chip). Every string is the one the
 * module produced before the move, byte for byte. `alertGroup` and `tradeStatus` are handed the
 * loader's English and return it unchanged in English; Spanish looks the type / status code up and
 * falls back to that English. The Spanish rebuilds of loader sentences stay in that module.
 */

/** The brief's alert groups, keyed by notification TYPE (`ALERT_LABELS` in lib/core-app/sinceLastVisit.ts). */
const ALERT_LABEL_ES: Record<string, string> = {
  chimmy_alert: 'alertas de Chimmy',
  player_injury_update: 'novedades de lesiones',
  player_news_update: 'noticias de jugadores',
  live_score_swing: 'alertas de partidos en vivo',
  injury_update: 'novedades de lesiones',
  breaking_news: 'noticias de última hora',
  trade_proposed: 'ofertas de intercambio',
  trade_accepted: 'intercambios aceptados',
  trade_rejected: 'intercambios rechazados',
  trade_countered: 'contraofertas',
  waiver_processed: 'resultados de reclamos',
  waiver_claim: 'reclamos',
  draft_pick: 'selecciones del draft',
  draft_starting: 'drafts que empiezan',
  lineup_lock: 'bloqueos de alineación',
  commissioner_action: 'acciones del comisionado',
}

/** A trade's status chip. Keyed on the status CODE: a Spanish status agrees with "el intercambio". */
const TRADE_STATUS_ES: Record<string, string> = {
  pending: 'Propuesto',
  awaiting_votes: 'Esperando votos',
  awaiting_commissioner: coreUiCopy('Commissioner review', 'es'),
  accepted: 'Aceptado',
  scheduled: 'Programado',
  processed: 'Completado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  countered: 'Contraofertado',
  expired: 'Vencido',
  vetoed: 'Vetado',
  reversed: 'Revertido',
}

export const homeBandsMessages = defineMessages({
  en: {
    // coarseCountdownText
    underway: 'underway',
    inMinutes: (mins: number) => `in ${mins}m`,
    inHours: (hours: number) => `in ${hours}h`,
    inDaysHours: (days: number, rem: number) => `in ${days}d ${rem}h`,
    inDays: (days: number) => `in ${days}d`,
    // alertGroupText / tradeStatusText
    alertGroup: (_type: string, english: string): string => english,
    tradeStatus: (_status: string, english: string): string => english,
  },
  es: {
    underway: 'en curso',
    inMinutes: (mins) => `en ${mins} min`,
    inHours: (hours) => `en ${hours} h`,
    inDaysHours: (days, rem) => `en ${days} d ${rem} h`,
    inDays: (days) => `en ${days} d`,
    alertGroup: (type, english) => ALERT_LABEL_ES[type] ?? english,
    tradeStatus: (status, english) => TRADE_STATUS_ES[status] ?? english,
  },
})
