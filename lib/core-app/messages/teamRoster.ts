import { defineMessages } from '@/lib/i18n/messages'

/**
 * Team roster workspace (components/core-app/TeamRosterWorkspace.tsx). Every string is the one the
 * screen printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const teamRosterMessages = defineMessages({
  en: {
    askPrefill: (league: string, starter: string | null | undefined, slotLabel: string | undefined, bench: string | null | undefined) =>
      `In ${league}, compare ${starter ?? 'the empty ' + slotLabel + ' slot'} with ${bench ?? 'eligible bench players'}. Use this league’s scoring, injury status, and individual kickoff evidence. Explain missing data and provider eligibility.`,
    rosterHealth: (n: number) => `Roster health · ${n} checks to review`,
    projected: 'Projected: ',
    projectedUnder: 'projected points under this league’s scoring.',
    estimates: 'Projections are estimates.',
    saveIn: (player: string, slot: string) => `Save ${player} in ${slot}`,
    reviewIn: 'Review roster and substitutes in ',
    week: 'Week',
  },
  es: {
    askPrefill: (league, starter, slotLabel, bench) =>
      `En ${league}, compara ${starter ?? 'la plaza vacía ' + slotLabel} con ${bench ?? 'suplentes elegibles'}. Usa la puntuación de esta liga, el estado de lesión y el inicio de cada partido. Explica los datos faltantes y la elegibilidad en la plataforma.`,
    rosterHealth: (n) => `Estado de plantilla · ${n} revisiones pendientes`,
    projected: 'Proyección: ',
    projectedUnder: 'puntos proyectados según la puntuación de esta liga.',
    estimates: 'Las proyecciones son estimaciones.',
    saveIn: (player, slot) => `Guardar a ${player} en ${slot}`,
    reviewIn: 'Revisar plantilla y sustitutos en ',
    week: 'Semana',
  },
})
