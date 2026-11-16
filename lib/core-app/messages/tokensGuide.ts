import { defineMessages } from '@/lib/i18n/messages'

/**
 * /tokens guide copy (2026-11-14): the balance as an answer, one line on what tokens are for, the fold
 * for what they do not cover, and history rows in plain words. Numbers come from the viewer's balance
 * and the live Chimmy price, never from here.
 */
export const tokensGuideMessages = defineMessages({
  en: {
    eyebrow: 'Tokens',
    headBalance: (n: string, questions: string | null): string =>
      `You have ${n} ${n === '1' ? 'token' : 'tokens'}` + (questions != null ? `: about ${questions} Chimmy ${questions === '1' ? 'question' : 'questions'}` : ''),
    headLoading: 'Your tokens',
    headUnavailable: 'We couldn’t load your balance',
    unavailableHint: 'Refresh the page to try again.',
    intro: 'Tokens pay for written analysis: Chimmy answers, trade reviews and write-ups. Scores, standings and lineup checks never cost tokens.',
    topUpRule: (n: number) =>
      `If you drop below ${n} Chimmy answers’ worth, Chimmy tops you back up to ${n} once a day. Tokens you buy never expire.`,
    backToApp: 'Back to app',
    seePlans: 'See plans',
    packsTitle: 'Top up',
    dontCoverTitle: 'What tokens don’t cover',
    neverCosts: 'Anything worked out from your league data without a written judgement: scores, standings, rosters, matchups, deadlines and lineup checks. That never costs tokens.',
    activityTitle: 'Recent activity',
    activityEmpty: 'No token activity yet.',
    dailyTopUp: 'Daily free top-up',
    bought: (n: string) => `Bought ${n} tokens`,
    refund: (label: string | null): string => (label ? `Refund: ${label}` : 'Refund'),
  },
  es: {
    eyebrow: 'Tokens',
    headBalance: (n: string, questions: string | null): string =>
      `Tienes ${n} ${n === '1' ? 'token' : 'tokens'}` + (questions != null ? `: unas ${questions} ${questions === '1' ? 'pregunta' : 'preguntas'} a Chimmy` : ''),
    headLoading: 'Tus tokens',
    headUnavailable: 'No pudimos cargar tu saldo',
    unavailableHint: 'Recarga la página para intentarlo de nuevo.',
    intro: 'Los tokens pagan análisis escritos: respuestas de Chimmy, revisiones de cambios y redacciones. Puntos, clasificación y revisión de alineaciones nunca cuestan tokens.',
    topUpRule: (n: number) =>
      `Si bajas de ${n} respuestas de Chimmy, Chimmy te recarga hasta ${n} una vez al día. Los tokens que compras no caducan.`,
    backToApp: 'Volver a la app',
    seePlans: 'Ver planes',
    packsTitle: 'Recargar',
    dontCoverTitle: 'Lo que los tokens no cubren',
    neverCosts: 'Todo lo que sale de los datos de tu liga sin un juicio escrito: puntos, clasificación, plantillas, enfrentamientos, plazos y revisión de alineaciones. Eso nunca cuesta tokens.',
    activityTitle: 'Actividad reciente',
    activityEmpty: 'Todavía no hay actividad de tokens.',
    dailyTopUp: 'Recarga diaria gratis',
    bought: (n: string) => `Compraste ${n} tokens`,
    refund: (label: string | null): string => (label ? `Reembolso: ${label}` : 'Reembolso'),
  },
})
