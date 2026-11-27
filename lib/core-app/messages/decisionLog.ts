import { defineMessages, messagesFor } from '@/lib/i18n/messages'

/**
 * The words of /core/decisions (components/core-app/screens/DecisionLogScreen.tsx) and its lock, English
 * and Spanish (2026-11-26). Words only: which viewer is locked is the server's paywall read, and which
 * letter a row shows is lib/core-app/decisionLogView.ts.
 *
 * ⚠ TWO GRADES, ALWAYS LABELLED. The trade grade is the deal's own letter from when it was asked about;
 * the outcome grade is how the roster moved N weeks later. Every string that prints a letter says which
 * one it is — an unlabelled "A" is exactly the ambiguity lib/decision-log-trade-grade.ts exists to end.
 */
export type DecisionLogCopy = {
  title: string
  sub: string
  lockSubject: string
  lockBenefit: string
  filterType: string
  filterLeague: string
  allTypes: string
  allLeagues: string
  typeLabel: (type: string) => string
  tradeGrade: (letter: string) => string
  tradeNotGraded: string
  tradeNotGradedWhy: (reason: string) => string
  tradeGradeNone: string
  outcomeAfter: (weeks: number | null, grade: string) => string
  outcomeAwaiting: string
  followed: string
  ignored: string
  pendingChoice: string
  summaryTitle: string
  summaryDecisions: (n: number) => string
  summaryTradeGrades: (graded: number, trades: number) => string
  summaryTradeGradesNote: string
  summaryOutcomes: (graded: number) => string
  summaryOutcomeRecord: string
  summaryNoOutcomes: string
  followedRecord: (rate: number) => string
  ignoredRecord: (rate: number) => string
  loading: string
  emptyTitle: string
  emptyBody: string
  emptyFiltered: string
  error: string
  retry: string
  unknownLeague: string
}

const TYPE_EN: Record<string, string> = {
  trade: 'Trade',
  trade_proposal: 'Trade proposals',
  trade_finder: 'Trade finder',
  waiver: 'Waiver',
  sit_start: 'Start / sit',
}

const TYPE_ES: Record<string, string> = {
  trade: 'Intercambio',
  trade_proposal: 'Propuestas de intercambio',
  trade_finder: 'Buscador de intercambios',
  waiver: 'Agentes libres',
  sit_start: 'Titular / banca',
}

const pct = (rate: number) => `${Math.round(Math.max(0, Math.min(1, rate)) * 100)}%`

export const decisionLogMessages = defineMessages<DecisionLogCopy>({
  en: {
    title: 'My decisions',
    sub: 'Every trade, waiver and lineup call you asked AllFantasy about — the trade grade the deal got at the time, and how it turned out weeks later.',
    lockSubject: 'Your decision history',
    lockBenefit: 'See every call you asked about, the trade grade it got at the time, and how each one turned out.',
    filterType: 'Decision type',
    filterLeague: 'League',
    allTypes: 'All types',
    allLeagues: 'All leagues',
    typeLabel: (type) => TYPE_EN[type] ?? type.replaceAll('_', ' '),
    tradeGrade: (letter) => `Trade grade ${letter}`,
    tradeNotGraded: 'Trade grade: not graded',
    tradeNotGradedWhy: (reason) => `Not graded: ${reason}`,
    tradeGradeNone: 'Trade grade: not recorded',
    outcomeAfter: (weeks, grade) =>
      weeks && weeks > 0 ? `Outcome after ${weeks} week${weeks === 1 ? '' : 's'}: ${grade}` : `Outcome: ${grade}`,
    outcomeAwaiting: 'Outcome: awaiting',
    followed: 'You followed it',
    ignored: 'You went another way',
    pendingChoice: 'Not marked yet',
    summaryTitle: 'Your record',
    summaryDecisions: (n) => `decision${n === 1 ? '' : 's'} logged`,
    summaryTradeGrades: (graded, trades) => `of ${trades} trade${trades === 1 ? '' : 's'} carry a trade grade`,
    summaryTradeGradesNote: 'Only trades analyzed since the grade was recorded carry one; older ones say "not recorded".',
    summaryOutcomes: (graded) => `outcome${graded === 1 ? '' : 's'} graded`,
    summaryOutcomeRecord: 'Outcome grades',
    summaryNoOutcomes: 'No outcomes graded yet — they arrive a few weeks after a decision.',
    followedRecord: (rate) => `When you followed: ${pct(rate)} improved your roster`,
    ignoredRecord: (rate) => `When you went another way: ${pct(rate)} improved it`,
    loading: 'Loading your decisions…',
    emptyTitle: 'No decisions logged yet',
    emptyBody: 'Analyze a trade, run waiver suggestions or ask for a start/sit call and it lands here, graded as the weeks go by.',
    emptyFiltered: 'No decisions match these filters.',
    error: 'We could not read your decisions just now. This is a read failure on our side, not an empty history.',
    retry: 'Try again',
    unknownLeague: 'League',
  },
  es: {
    title: 'Mis decisiones',
    sub: 'Cada intercambio, agente libre y alineación que consultaste en AllFantasy: la calificación que recibió el intercambio en su momento y cómo resultó semanas después.',
    lockSubject: 'Tu historial de decisiones',
    lockBenefit: 'Consulta cada decisión que pediste, la calificación del intercambio en su momento y cómo resultó cada una.',
    filterType: 'Tipo de decisión',
    filterLeague: 'Liga',
    allTypes: 'Todos los tipos',
    allLeagues: 'Todas las ligas',
    typeLabel: (type) => TYPE_ES[type] ?? type.replaceAll('_', ' '),
    tradeGrade: (letter) => `Calificación del intercambio: ${letter}`,
    tradeNotGraded: 'Calificación del intercambio: sin calificar',
    tradeNotGradedWhy: (reason) => `Sin calificar: ${reason}`,
    tradeGradeNone: 'Calificación del intercambio: no registrada',
    outcomeAfter: (weeks, grade) =>
      weeks && weeks > 0 ? `Resultado tras ${weeks} semana${weeks === 1 ? '' : 's'}: ${grade}` : `Resultado: ${grade}`,
    outcomeAwaiting: 'Resultado: pendiente',
    followed: 'Lo seguiste',
    ignored: 'Elegiste otra opción',
    pendingChoice: 'Sin marcar todavía',
    summaryTitle: 'Tu récord',
    summaryDecisions: (n) => `decisi${n === 1 ? 'ón registrada' : 'ones registradas'}`,
    summaryTradeGrades: (graded, trades) => `de ${trades} intercambio${trades === 1 ? '' : 's'} tienen calificación`,
    summaryTradeGradesNote: 'Solo los intercambios analizados desde que se guarda la calificación la tienen; los anteriores dicen «no registrada».',
    summaryOutcomes: (graded) => `resultado${graded === 1 ? '' : 's'} calificado${graded === 1 ? '' : 's'}`,
    summaryOutcomeRecord: 'Calificaciones de resultado',
    summaryNoOutcomes: 'Aún no hay resultados calificados: llegan unas semanas después de cada decisión.',
    followedRecord: (rate) => `Cuando lo seguiste: ${pct(rate)} mejoró tu plantilla`,
    ignoredRecord: (rate) => `Cuando elegiste otra opción: ${pct(rate)} la mejoró`,
    loading: 'Cargando tus decisiones…',
    emptyTitle: 'Aún no hay decisiones registradas',
    emptyBody: 'Analiza un intercambio, pide sugerencias de agentes libres o una alineación y aparecerá aquí, calificada con el paso de las semanas.',
    emptyFiltered: 'Ninguna decisión coincide con estos filtros.',
    error: 'No pudimos leer tus decisiones ahora. Es un fallo de lectura nuestro, no un historial vacío.',
    retry: 'Reintentar',
    unknownLeague: 'Liga',
  },
})

/** The copy in the reader's language; anything that is not Spanish reads English. */
export function decisionLogCopy(language: string | null | undefined): DecisionLogCopy {
  return messagesFor(decisionLogMessages, language)
}
