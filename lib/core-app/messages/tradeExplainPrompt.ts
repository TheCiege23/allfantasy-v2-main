import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Trade Center's "Explain with Chimmy" prefill (lib/core-app/tradeExplainPrompt.ts). It is a PROMPT
 * read by a model, so every string is the one the builder wrote before the move, byte for byte — a
 * relocation, not a rewrite.
 */
export const tradeExplainPromptMessages = defineMessages({
  en: {
    emptyTrade: (leagueName: string | null) => `Help me think about a trade${leagueName ? ` in ${leagueName}` : ''}.`,
    explainTrade: (leagueName: string | null, partner: string | null) =>
      `Explain this trade${leagueName ? ` in ${leagueName}` : ''}${partner ? ` with ${partner}` : ''}.`,
    screenValues: (give: string, get: string) =>
      `On the trade screen I give ${give} and get ${get} in league value — explain using those numbers.`,
    missing: 'What am I missing?',
  },
  es: {
    emptyTrade: (leagueName) => `Ayúdame a evaluar un intercambio${leagueName ? ` en ${leagueName}` : ''}. Responde en español.`,
    explainTrade: (leagueName, partner) =>
      `Explica este intercambio${leagueName ? ` en ${leagueName}` : ''}${partner ? ` con ${partner}` : ''}. Responde en español; conserva los nombres, las calificaciones y los valores.`,
    screenValues: (give, get) => `En el analizador envío ${give} y recibo ${get} en valor de liga. Explica usando esos valores.`,
    missing: '¿Qué riesgos o datos me faltan?',
  },
})
