import { defineMessages } from '@/lib/i18n/messages'

/**
 * Chimmy's moves card (components/core-app/ChimmyMovesCard.tsx). Every string is the one the card
 * printed before the move, byte for byte, in both languages — a relocation, not a rewrite. (The
 * English heading was JSX `&rsquo;`; it is the same rendered character, ’, here. The section's
 * aria-label always used a straight apostrophe, and still does.)
 *
 * A move's own title/detail/ask are not here: in English they are the composer's text as written
 * (lib/core-app/chimmyMoves.ts), and the Spanish is rebuilt from the move's parts in the card.
 * `checkAsk` likewise returns the composer's English ask unchanged; only Spanish rewrites it.
 */
export const chimmyMovesCardMessages = defineMessages({
  en: {
    sectionLabel: "Chimmy's moves",
    title: 'Chimmy’s moves',
    askAbout: (about: string) => `Ask Chimmy about ${about}`,
    allClear: (leagueName: string) =>
      `No remaining flagged starters to review before kickoff in ${leagueName}. Check individual locks and injury updates on your platform.`,
    canCheck: (leagueName: string) => `Chimmy can check your ${leagueName} lineup for you.`,
    checkAsk: (_leagueName: string, composerAsk: string): string => composerAsk,
    startSitCheck: 'Start/sit check',
  },
  es: {
    sectionLabel: 'Jugadas de Chimmy',
    title: 'Jugadas de Chimmy',
    askAbout: (about) => `Preguntar a Chimmy sobre ${about}`,
    allClear: (leagueName) =>
      `No quedan titulares señalados por revisar antes del inicio en ${leagueName}. Revisa cada bloqueo y las novedades de lesiones en tu plataforma.`,
    canCheck: (leagueName) => `Chimmy puede revisar tu alineación de ${leagueName}.`,
    checkAsk: (leagueName) => `Revisa mi alineación de ${leagueName} para esta semana: a quién alinear y a quién sentar.`,
    startSitCheck: 'Revisar titulares',
  },
})
