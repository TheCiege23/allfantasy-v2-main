import { defineMessages } from '@/lib/i18n/messages'

/**
 * "Your call, league by league" (components/core-app/player-finder/LeagueCalls.tsx). Every string is
 * the one the section printed before the move, byte for byte, in both languages — a relocation, not a
 * rewrite. The footnote was JSX text: here it is as rendered (`&apos;` is ', `&ldquo;`/`&rdquo;` are
 * “ ”, and each line break was one space).
 */
export const leagueCallsMessages = defineMessages({
  en: {
    title: 'Your call, league by league',
    fixLineupIn: (platformLabel: string) => `Fix lineup in ${platformLabel}`,
    askChimmy: 'Ask Chimmy',
    foot: 'Each call compares projections under that league\'s own scoring, his injury designation and the week\'s kickoffs — nothing else. Make the change where the league lives — “Fix lineup” on the call, or the table\'s “Open lineup” above.',
  },
  es: {
    title: 'Tu decisión, liga por liga',
    fixLineupIn: (platformLabel) => `Corregir la alineación en ${platformLabel}`,
    askChimmy: 'Preguntar a Chimmy',
    foot: 'Cada decisión compara las proyecciones con la puntuación de esa liga, su designación de lesión y los horarios de la semana; nada más. Haz el cambio donde vive la liga: «Corregir la alineación» en la decisión, o «Abrir la alineación» en la tabla de arriba.',
  },
})
