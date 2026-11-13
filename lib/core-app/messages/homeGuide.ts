import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core home as a guide (2026-11-12): the status headline, the decision tiers and their
 * "why it matters" lines, the season pulse, and the leagues-you-run card. See lib/core-app/homeGuide.ts.
 *
 * ⚠ THE TEACHING LINES MAKE CLAIMS ABOUT HOW FANTASY PLATFORMS BEHAVE. Each is worded to hold on
 * every platform we read (Sleeper, ESPN, Yahoo, Fantrax, MFL, Fleaflicker, AllFantasy): "most
 * platforms", never "Sleeper does X", unless the line is about the one platform it names.
 */
export const homeGuideMessages = defineMessages({
  en: {
    /* Headline */
    eyebrow: (week: string | null, leagues: number) =>
      `${week ? `${week} · ` : ''}${leagues} ${leagues === 1 ? 'league' : 'leagues'}`,
    needsYou: (n: number) => (n === 1 ? '1 thing needs you' : `${n} things need you`),
    allClear: 'Nothing needs you right now',
    intro:
      'Home reads every league you’ve connected, on every platform, and puts what costs you points first. Changes happen on the league’s own platform — each button takes you there.',
    introShort: 'Every league, every platform, most urgent first.',
    chipLineups: 'Lineups to fix',
    chipInjuries: 'Injured starters',
    chipTrades: 'Trades today',
    /* A count of the Hub's open tasks, not of leagues — one league can have several. */
    chipRun: 'Commissioner tasks',
    streak: (days: number) => `${days}-day streak`,

    /* Tiers */
    tierNow: 'Costs points now',
    tierNowHint: 'Each of these is losing points or a pick until it’s fixed.',
    tierWeek: 'Before this week’s games',
    tierWeekHint: 'Costs points if nothing changes before kickoff.',
    tierFyi: 'Good to know',
    tierFyiHint: 'Nothing is lost by waiting.',
    why: 'Why it matters',

    /* Teaching lines */
    teachEmptySlot: 'An empty starting slot scores zero, and no platform fills it for you. Any healthy player beats nobody.',
    teachStarterOut: 'A player listed Out won’t play, so every point that slot could score is lost unless you start someone else before their game.',
    teachInjurySummary: 'Out means the player won’t play. Swap each one before their game kicks off — the report below shows the best healthy option on your bench or waivers.',
    teachDrafting: 'If your pick timer runs out, most platforms auto-pick for you from their own rankings.',
    teachDraftUpcoming: 'Set your queue before the draft starts, so an auto-pick takes players you actually want.',
    teachBestBall: 'Best ball starts your top scorers automatically, but only from healthy players. A thin position can leave a slot scoring zero.',
    teachStale: (platform: string | null) =>
      `We read this league from ${platform ?? 'its platform'}. Until it syncs again, its alerts may be out of date.`,

    /* Season pulse */
    pulseTitle: 'How your season is going',
    pulseSub: 'Your rank in every league with games played.',
    pulseTopHalf: 'Top half',
    pulseBubble: 'On the bubble',
    pulseBottomHalf: 'Bottom half',
    pulseFirst: 'In first',
    pulseRecord: 'Overall record',
    pulseBest: 'Strongest',
    pulseWorst: 'Needs a look',
    pulseRank: (rank: number, teams: number) => `${rank} of ${teams}`,
    pulseTeach:
      'Top half usually means a playoff spot, but playoff size is set league by league — check each league’s settings. Bubble teams are one place from the line, where one week moves you in or out.',
    pulseUnranked: (n: number) => `${n} more ${n === 1 ? 'league has' : 'leagues have'} no games on record yet.`,
    pulseNone: 'No league has games on record yet. Standings appear here after week 1.',
    pulseStandings: 'All standings',

    /* Leagues you run */
    runTitle: 'Leagues you run',
    runSub: (n: number) => `League health across the ${n} ${n === 1 ? 'league' : 'leagues'} you commission.`,
    runRisks: 'Biggest risks',
    runNoRisks: 'Nothing needs a commissioner right now.',
    runOpen: 'Open Commissioner Hub',
    runTeach:
      'A healthy league is one where every team sets a lineup — an inactive manager hands free wins to whoever plays them. The ladder: one quiet week gets a nudge, two a warning, three means line up a replacement before your trade deadline.',
    runPartial: 'Some leagues couldn’t be read this time, so these counts may be low.',
  },
  es: {
    eyebrow: (week, leagues) => `${week ? `${week} · ` : ''}${leagues} ${leagues === 1 ? 'liga' : 'ligas'}`,
    needsYou: (n) => (n === 1 ? '1 cosa te necesita' : `${n} cosas te necesitan`),
    allClear: 'Nada te necesita ahora mismo',
    intro:
      'Inicio lee cada liga que conectaste, en cada plataforma, y pone primero lo que te cuesta puntos. Los cambios se hacen en la plataforma de la liga: cada botón te lleva allí.',
    introShort: 'Cada liga, cada plataforma, lo más urgente primero.',
    chipLineups: 'Alineaciones por corregir',
    chipInjuries: 'Titulares lesionados',
    chipTrades: 'Intercambios hoy',
    chipRun: 'Tareas de comisionado',
    streak: (days) => `Racha de ${days} días`,

    tierNow: 'Te cuesta puntos ahora',
    tierNowHint: 'Cada una pierde puntos o una selección hasta que la corrijas.',
    tierWeek: 'Antes de los partidos de esta semana',
    tierWeekHint: 'Te cuesta puntos si nada cambia antes del inicio.',
    tierFyi: 'Para tener en cuenta',
    tierFyiHint: 'No pierdes nada por esperar.',
    why: 'Por qué importa',

    teachEmptySlot: 'Un puesto titular vacío anota cero y ninguna plataforma lo llena por ti. Cualquier jugador sano es mejor que nadie.',
    teachStarterOut: 'Un jugador marcado como Out no jugará, así que pierdes todos sus puntos a menos que alinees a otro antes de su partido.',
    teachInjurySummary: 'Out significa que no jugará. Cambia a cada uno antes de su partido: el informe de abajo muestra la mejor opción sana en tu banca o entre los agentes libres.',
    teachDrafting: 'Si se acaba el tiempo de tu turno, la mayoría de las plataformas eligen por ti según su propio ranking.',
    teachDraftUpcoming: 'Prepara tu cola antes del draft para que una selección automática tome jugadores que de verdad quieres.',
    teachBestBall: 'Best ball alinea automáticamente a tus mejores anotadores, pero solo entre jugadores sanos. Una posición corta puede dejar un puesto en cero.',
    teachStale: (platform) =>
      `Leemos esta liga desde ${platform ?? 'su plataforma'}. Hasta que se sincronice de nuevo, sus alertas pueden estar desactualizadas.`,

    pulseTitle: 'Cómo va tu temporada',
    pulseSub: 'Tu posición en cada liga con partidos jugados.',
    pulseTopHalf: 'Mitad superior',
    pulseBubble: 'En la burbuja',
    pulseBottomHalf: 'Mitad inferior',
    pulseFirst: 'En primer lugar',
    pulseRecord: 'Récord total',
    pulseBest: 'Las más fuertes',
    pulseWorst: 'Para revisar',
    pulseRank: (rank, teams) => `${rank} de ${teams}`,
    pulseTeach:
      'La mitad superior suele dar un puesto de playoffs, pero el tamaño de los playoffs se define en cada liga: revisa su configuración. Los equipos en la burbuja están a un puesto de la línea, donde una semana te mete o te saca.',
    pulseUnranked: (n) => `${n} ${n === 1 ? 'liga más no tiene' : 'ligas más no tienen'} partidos registrados todavía.`,
    pulseNone: 'Ninguna liga tiene partidos registrados todavía. Las posiciones aparecen aquí después de la semana 1.',
    pulseStandings: 'Todas las posiciones',

    runTitle: 'Ligas que diriges',
    runSub: (n) => `Salud de las ${n} ${n === 1 ? 'liga' : 'ligas'} que comisionas.`,
    runRisks: 'Mayores riesgos',
    runNoRisks: 'Nada necesita a un comisionado ahora mismo.',
    runOpen: 'Abrir el Centro del Comisionado',
    runTeach:
      'Una liga sana es una donde cada equipo alinea: un mánager inactivo regala victorias a quien juega contra él. La escalera: una semana sin movimientos merece un recordatorio, dos una advertencia y tres significa buscar un reemplazo antes de la fecha límite de intercambios.',
    runPartial: 'Algunas ligas no se pudieron leer esta vez, así que estos números pueden quedarse cortos.',
  },
})
