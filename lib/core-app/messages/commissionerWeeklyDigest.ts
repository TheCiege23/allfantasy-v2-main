import { defineMessages } from '@/lib/i18n/messages'

/**
 * The weekly commissioner digest (lib/commissioner-workspace/weeklyDigest.ts), in each commissioner's
 * own language (`UserProfile.preferredLanguage`). Every line takes its count, so each language words its
 * own singular and plural rather than gluing English fragments together.
 */
export const commissionerWeeklyDigestMessages = defineMessages({
  en: {
    title: (league: string | null) => (league ? `This week in ${league}` : 'Your league this week'),
    action: 'Open the Commissioner Hub',
    openCases: (n: number) => (n === 1 ? '1 integrity case is open for review.' : `${n} integrity cases are open for review.`),
    ruleChanges: (n: number) => (n === 1 ? '1 rule change is waiting for your approval.' : `${n} rule changes are waiting for your approval.`),
    duesClaims: (n: number) => (n === 1 ? '1 manager says they paid dues. Confirm or follow up.' : `${n} managers say they paid dues. Confirm or follow up.`),
    draftPoll: 'A draft-time poll is open. Lock a time once the league has voted.',
    tradesAudited: (n: number) => (n === 1 ? '1 trade was audited this week.' : `${n} trades were audited this week.`),
    widestGap: (pct: number) => ` The widest value gap was ${pct}%.`,
  },
  es: {
    title: (league) => (league ? `Esta semana en ${league}` : 'Tu liga esta semana'),
    action: 'Abrir el Centro del Comisionado',
    openCases: (n) => (n === 1 ? 'Hay 1 caso de integridad abierto para revisar.' : `Hay ${n} casos de integridad abiertos para revisar.`),
    ruleChanges: (n) => (n === 1 ? '1 cambio de reglas espera tu aprobación.' : `${n} cambios de reglas esperan tu aprobación.`),
    duesClaims: (n) => (n === 1 ? '1 mánager dice que pagó la cuota. Confírmalo o haz seguimiento.' : `${n} mánagers dicen que pagaron la cuota. Confírmalo o haz seguimiento.`),
    draftPoll: 'Hay una encuesta abierta para la hora del draft. Fija una hora cuando la liga haya votado.',
    tradesAudited: (n) => (n === 1 ? 'Se auditó 1 intercambio esta semana.' : `Se auditaron ${n} intercambios esta semana.`),
    widestGap: (pct) => ` La mayor diferencia de valor fue de ${pct}%.`,
  },
})

export type DigestLanguage = 'en' | 'es'

/** `preferredLanguage` → a language this catalog has. Anything Spanish ('es', 'es-MX') is Spanish. */
export function digestLanguage(preferred: string | null | undefined): DigestLanguage {
  return String(preferred ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}
