import { defineMessages } from '@/lib/i18n/messages'

/**
 * The ✦ "Ask Chimmy" lineup check on a My Team row (components/core-app/LineupIntelligenceActions.tsx).
 * Every string is the one the button wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. 🛑 The prefills go in the user's own mouth: they must not name internal
 * systems (see the component).
 */
export const lineupIntelligenceActionsMessages = defineMessages({
  en: {
    prefillBestBall: (leagueName: string) =>
      `Review my ${leagueName} Best Ball roster using this league's scoring and my latest data. The provider selects my scoring starters automatically; focus on injuries, roster depth, potential free agents and missing data.`,
    prefillLineup: (leagueName: string) =>
      `Run a start/sit check for my ${leagueName} lineup using this league's scoring and my latest data. Compare eligible bench replacements under this league's scoring, check injuries and byes, exclude players whose games have started, and identify any missing data or platform locks I must verify.`,
    label: (leagueName: string, bestBall: boolean): string => `Ask Chimmy to check ${leagueName}'s ${bestBall ? 'Best Ball roster' : 'lineup'}`,
    words: (bestBall: boolean): string => ` Ask Chimmy · ${bestBall ? 'roster check' : 'lineup check'}`,
  },
  es: {
    prefillBestBall: (leagueName) =>
      `Revisa mi plantilla Best Ball de ${leagueName} con la puntuación de esta liga y mis datos más recientes. La plataforma elige automáticamente mis titulares; céntrate en lesiones, profundidad de la plantilla, posibles agentes libres y datos que falten.`,
    prefillLineup: (leagueName) =>
      `Revisa titulares y suplentes de mi alineación de ${leagueName} con la puntuación de esta liga y mis datos más recientes. Compara los reemplazos elegibles del banquillo con la puntuación de esta liga, revisa lesiones y semanas de descanso, excluye a los jugadores cuyos partidos ya empezaron e indica qué datos faltan o qué cierres de la plataforma debo confirmar.`,
    label: (leagueName, bestBall) => `Pedir a Chimmy que revise ${bestBall ? 'la plantilla Best Ball' : 'la alineación'} de ${leagueName}`,
    words: (bestBall) => ` Preguntar a Chimmy · ${bestBall ? 'revisar plantilla' : 'revisar alineación'}`,
  },
})
