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
    // chimmyAsk (lib/core-app/leagueCall.ts): the prefilled "Ask Chimmy" question, in the reader's language
    askHold: (leagueName: string, playerName: string, startName: string) =>
      `In ${leagueName}: ${playerName} is questionable — should I keep him in or start ${startName}?`,
    askStart: (leagueName: string, playerName: string, benchName: string) =>
      `In ${leagueName}: should I start ${playerName} over ${benchName} this week?`,
    askBench: (leagueName: string, playerName: string, startName: string) =>
      `In ${leagueName}: should I bench ${playerName} for ${startName} this week?`,
    askOpen: (leagueName: string, playerName: string) => `In ${leagueName}: what should I do with ${playerName} this week?`,
  },
  es: {
    title: 'Tu decisión, liga por liga',
    fixLineupIn: (platformLabel) => `Corregir la alineación en ${platformLabel}`,
    askChimmy: 'Preguntar a Chimmy',
    foot: 'Cada decisión compara las proyecciones con la puntuación de esa liga, su designación de lesión y los horarios de la semana; nada más. Haz el cambio donde vive la liga: «Corregir la alineación» en la decisión, o «Abrir la alineación» en la tabla de arriba.',
    askHold: (leagueName, playerName, startName) =>
      `En ${leagueName}: ${playerName} es dudoso. ¿Lo mantengo o alineo a ${startName}?`,
    askStart: (leagueName, playerName, benchName) =>
      `En ${leagueName}: ¿debería alinear a ${playerName} por delante de ${benchName} esta semana?`,
    askBench: (leagueName, playerName, startName) =>
      `En ${leagueName}: ¿debería sentar a ${playerName} y alinear a ${startName} esta semana?`,
    askOpen: (leagueName, playerName) => `En ${leagueName}: ¿qué debería hacer con ${playerName} esta semana?`,
  },
})
