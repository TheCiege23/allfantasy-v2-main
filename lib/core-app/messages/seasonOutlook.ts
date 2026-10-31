import { ordinal } from '@/lib/core-app/outlookCopy'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * Season Outlook board (components/core-app/screens/SeasonOutlook.tsx). Every string is the one the
 * screen printed before the move, byte for byte, in both languages — this is a relocation, not a
 * rewrite. Strings already routed through `coreUiCopy` stay there.
 */
export const seasonOutlookMessages = defineMessages({
  en: {
    onTrack: (leagues: number) => `of ${leagues} on track for the playoffs`,
    bestTitleOdds: (leagueName: string) => `best title odds · ${leagueName}`,
    open: 'Open',
    against: (opponent: string) => `Against ${opponent}: `,
    winLose: (ifWin: string, ifLose: string) => `${ifWin}% with a win, ${ifLose}% with a loss.`,
    runsReused: (reused: number, total: number) =>
      `${reused} of ${total} league runs were reused because nothing they read had changed.`,
    topOf: (playoffTeams: number, teams: number) => `top ${playoffTeams} of ${teams}`,
    byes: (n: number) => `, ${n} bye${n === 1 ? '' : 's'}`,
    toPlay: (weeks: number) => `${weeks} to play`,
    hardestLeft: (rank: number) => ` · ${ordinal(rank)} hardest schedule left`,
    preseason: (kickoff: string) =>
      `Odds are simulated from each team's completed weeks, and none have been played this season. They start filling in as weeks are scored — first kickoff ${kickoff}.`,
    withheld: (n: number) => `${n} ${n === 1 ? 'league is' : 'leagues are'} not on this page`,
  },
  es: {
    onTrack: (leagues) => `de ${leagues} con opciones de playoffs`,
    bestTitleOdds: (leagueName) => `mejor probabilidad de título · ${leagueName}`,
    open: 'Abrir',
    against: (opponent) => `Contra ${opponent}: `,
    winLose: (ifWin, ifLose) => `${ifWin}% si ganas; ${ifLose}% si pierdes.`,
    runsReused: (reused, total) => `Se reutilizaron ${reused} de ${total} simulaciones porque sus datos no cambiaron.`,
    topOf: (playoffTeams, teams) => `primeros ${playoffTeams} de ${teams}`,
    byes: (n) => `, ${n} descansos`,
    toPlay: (weeks) => `${weeks} por jugar`,
    hardestLeft: (rank) => ` · ${rank}.º calendario más difícil restante`,
    preseason: (kickoff) =>
      `Las probabilidades se simulan a partir de las semanas completas de cada equipo. Aún no se ha jugado ninguna esta temporada. Empezarán a aparecer tras el primer partido: ${kickoff}.`,
    withheld: (n) => `${n} ${n === 1 ? 'liga no aparece' : 'ligas no aparecen'} en esta página`,
  },
})
