import { defineMessages } from '@/lib/i18n/messages'

/**
 * The cross-league My Team board (components/core-app/MyTeamBoard.tsx): its reading tip, the
 * lineup-reminder line, each row's lock, sync and score stamps, the cross-league strip, the "Before
 * lock" queue counts, the section label and every note under the rows, and the footer's quiet line.
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. Numbers arrive already formatted where the component formatted them.
 */
export const myTeamBoardMessages = defineMessages({
  en: {
    // BoardReadingTip
    readingTipTitle: 'How to read this list',
    readingTipOrder: 'Lineups with problems you can still fix come first — an empty slot, a starter ruled out or on bye — the most first, then the soonest kickoff. T4 means tied for 4th.',
    readingTipCounts: 'Red counts are points you will lose unless you act. An amber “questionable” count is a risk, not a loss: he probably plays, so it never moves a league up. “Unidentified” is a starter we could not look up — our gap, not yours. SET means we checked and nothing is missing.',
    readingTipClock: 'The clock counts to the kickoff of the next starter with a problem — otherwise the next starter — in Eastern time. Each player locks at his own kickoff; confirm locks and AutoSubs on your platform.',
    readingTipSynced: '“synced 3h ago”: each row reads your roster as stored at the last sync. Opening a league checks its live lineup.',
    readingTipScore: '“ahead 88.4–71.2” is this week’s score so far; in an elimination league it is your distance from the cut.',

    // ReminderLine
    reminderWhen: (opensHoursBefore: number, closesHoursBefore: number) =>
      `once a week, ${closesHoursBefore}–${opensHoursBefore} hours before the main NFL slate`,
    reminderOn: (when: string) =>
      `Lineup reminder is on: ${when}, Chimmy checks every lineup and messages you only if one needs fixing. `,
    reminderMuted: 'Chimmy’s lineup alerts are muted, so nothing will check these lineups for you before kickoff. ',
    reminderOff: (when: string) =>
      `Lineup reminder is off. Turn it on and Chimmy checks every lineup ${when}, messaging you only if one needs fixing. `,
    reminderManage: 'Manage',
    reminderTurnOn: 'Turn it on',

    // Lock
    lockDistantWhy: (kickoff: string) =>
      `The next kickoff we hold for these starters is ${kickoff}, further out than a lineup lock should be — this week’s schedule has probably not been ingested yet.`,
    lockNextKickoffTitle: (kickoff: string) =>
      `Next starter kickoff ${kickoff}. Individual locks and AutoSubs must be checked on your platform.`,

    // SyncStamp — `ageEs` is the age through the shell's `ageText(age, 'es')`; each language picks its own.
    syncFailed: 'last sync failed',
    syncedAgo: (age: string, _ageEs: string) => `synced ${age}`,

    // ScoreStamp
    cutPlace: (rank: number, outOf: number) => `${rank} of ${outOf}`,
    cutLowest: (place: string) => `lowest score: on the cut (${place})`,
    cutOver: (over: string, place: string) => `${over} over the cut (${place})`,
    /** ScoreStamp's word for where the row stands — English shows the lead code itself. */
    leadWord: (lead: 'ahead' | 'behind' | 'level'): string => lead,

    // weekRecordLine
    weekAhead: (n: number) => `ahead in ${n}`,
    weekBehind: (n: number) => `behind in ${n}`,
    weekLevel: (n: number) => `level in ${n}`,
    weekAboveCut: (n: number) => `above the cut in ${n}`,
    weekOnCut: (n: number) => `on the cut in ${n}`,
    weekNoPointsYet: (n: number) => `no points yet in ${n}`,
    weekSoFar: 'This week so far',

    // Row — `startersEs` is coreUiCopy's word for the count; English writes its own.
    fixLabel: (label: string): string => label,
    startedPastKickoff: (n: number, _startersEs: string) => `${n} ${n === 1 ? 'starter' : 'starters'} past kickoff · `,
    withoutKickoff: (n: number) => ` · ${n} without a kickoff`,

    // CrossLeagueStrip
    crossLeagueAria: 'Players in more than one lineup',
    crossLeagueLabel: 'Hurting more than one lineup',
    crossLeagueCount: (n: number) => `in ${n} lineups:`,
    crossLeagueMore: (n: number) => `+${n} more`,

    // "Before lock" queue counts
    queueEmpty: (n: number): string => `${n} empty`,
    queueOut: (n: number): string => `${n} out`,
    queueBye: (n: number) => `${n} on bye`,

    // Section label and count
    labelUnordered: (n: number) => `${n} shown · all lock together, so in no particular order`,
    labelUrgency: (n: number) => `Top ${n} · ranked by urgency`,
    labelQuestionableFirst: (n: number) => `Top ${n} · questionable starters first, then lock time`,
    labelLockTime: (n: number) => `Top ${n} · nothing is broken, so ranked by lock time`,
    teamsRead: (checked: string, total: string, paused: boolean) =>
      `${checked} of ${total} ${paused ? 'active ' : ''}teams read`,

    // Filters
    filterAria: 'Filter lineups',
    filterAll: 'All',
    filterHidden: (n: number) => `${n} other ${n === 1 ? 'lineup is' : 'lineups are'} hidden by this filter. `,
    filterShowAll: 'Show all',

    // Notes under the rows
    allSetLead: (checked: string, byeChecked: boolean, questionableFirst: boolean) =>
      `Every one of the ${checked} lineups we could read is set — no empty slots, nobody ruled out${byeChecked ? ', nobody on a bye' : ''}. ${questionableFirst
        ? 'Lineups with questionable starters come first, then the ones locking soonest.'
        : 'These are the ones locking soonest.'}`,
    nothingToSet: 'No lineups to set right now — every team is pre-draft, finished or paused. The lines below say which.',
    allSet: (checked: string, byeChecked: boolean) =>
      `Every one of the ${checked} lineups we could read is set — no empty slots, nobody ruled out${byeChecked ? ', nobody on a bye' : ''}.`,
    pausedLeagues: (n: number) =>
      `${n} ${n === 1 ? 'league is' : 'leagues are'} paused on this account and excluded from lineup urgency. `,
    automaticTeams: (n: number) => `${n} Best Ball teams use automatic lineups. `,
    inactiveTeams: (n: number) => `${n} pre-draft, completed, or inactive teams are excluded from manual lineup tasks.`,
    unreadableHead: (unreadable: number, total: string, paused: boolean, totalCount: number) =>
      `${unreadable} of your ${total} ${paused ? 'active ' : ''}claimed ${totalCount === 1 ? 'team' : 'teams'} could not be checked.`,
    noRoster: (n: number) => `${n} ${n === 1 ? 'has' : 'have'} no roster imported`,
    noLineup: (n: number) => `${n} ${n === 1 ? 'has' : 'have'} a roster but no starting lineup on file`,
    and: ' and ',
    /** `clause` is the English FOREIGN_IDS_UNREADABLE_CLAUSE; Spanish writes its own sentence. */
    idsUnreadable: (n: number, clause: string) =>
      `${n} ${n === 1 ? 'has' : 'have'} a roster on file, but ${n === 1 ? '' : 'for each league, '}${clause}`,
    staleRows: (n: number) =>
      `${n} of the leagues shown ${n === 1 ? 'was' : 'were'} last synced over a day ago or failed to sync, so ${n === 1 ? 'its row' : 'their rows'} may describe an older lineup. `,

    // FooterSummary's quiet line — `hidden` drives Spanish verb agreement; English does not need it.
    footerHiddenNeeds: (_hidden: number, hiddenNeeds: number) =>
      `include ${hiddenNeeds} more teams needing lineup review — open the full league list.`,
    footerUnreadable: (set: number, unreadable: number) =>
      `are not shown: ${set} set, ${unreadable} could not be read (the line above says why).`,
    footerNoManual: (_hidden: number): string => 'have no remaining manual lineup task.',
    footerSet: (_hidden: number): string => 'are set — nothing needs you there.',
  },
  es: {
    readingTipTitle: 'Cómo leer esta lista',
    readingTipOrder: 'Primero las alineaciones con problemas que aún puedes arreglar —una posición vacía, un titular descartado o en descanso—, las que más pierden primero, y luego por el inicio más cercano. T4 significa empatado en el 4.º lugar.',
    readingTipCounts: 'Los números en rojo son puntos que perderás si no actúas. Un número «en duda» en ámbar es un riesgo, no una pérdida: probablemente juega, así que nunca sube una liga en la lista. «Sin identificar» es un titular que no pudimos buscar: una carencia nuestra, no tuya. SET significa que lo revisamos y no falta nada.',
    readingTipClock: 'El reloj cuenta hasta el inicio del próximo titular con un problema —si no hay, del próximo titular—, en hora del Este. Cada jugador se bloquea en su propio partido: confirma los cierres y cambios automáticos en tu plataforma.',
    readingTipSynced: '«Sincronizada hace 3 h»: cada fila lee tu plantilla guardada en la última sincronización. Al abrir una liga se revisa su alineación en vivo.',
    readingTipScore: '«Ganando 88.4–71.2» es el marcador de esta semana; en una liga de eliminación es tu distancia al corte.',

    reminderWhen: (opensHoursBefore, closesHoursBefore) =>
      `una vez por semana, entre ${opensHoursBefore} y ${closesHoursBefore} horas antes del bloque principal de la NFL`,
    reminderOn: (when) =>
      `Recordatorio de alineación activado: ${when}, Chimmy revisa cada alineación y te escribe solo si alguna necesita arreglo. `,
    reminderMuted: 'Las alertas de alineación de Chimmy están silenciadas, así que nadie revisará estas alineaciones antes del inicio. ',
    reminderOff: (when) =>
      `Recordatorio de alineación desactivado. Actívalo y Chimmy revisará cada alineación ${when}, y te escribirá solo si alguna necesita arreglo. `,
    reminderManage: 'Gestionar',
    reminderTurnOn: 'Activarlo',

    lockDistantWhy: (kickoff) =>
      `El próximo partido registrado para estos titulares es ${kickoff}, demasiado lejano para ser el cierre de alineación; probablemente aún falta el calendario de esta semana.`,
    lockNextKickoffTitle: (kickoff) =>
      `Próximo inicio de un titular: ${kickoff}. Confirma los cierres individuales y cambios automáticos en tu plataforma.`,

    syncFailed: 'la última sincronización falló',
    syncedAgo: (_age, ageEs) => `sincronizada ${ageEs}`,

    cutPlace: (rank, outOf) => `${rank}.º de ${outOf}`,
    cutLowest: (place) => `puntuación más baja: en el corte (${place})`,
    cutOver: (over, place) => `${over} sobre el corte (${place})`,
    leadWord: (lead) => ({ ahead: 'ganando', behind: 'perdiendo', level: 'empatado' })[lead],

    weekAhead: (n) => `ganando en ${n}`,
    weekBehind: (n) => `perdiendo en ${n}`,
    weekLevel: (n) => `empatado en ${n}`,
    weekAboveCut: (n) => `sobre el corte en ${n}`,
    weekOnCut: (n) => `en el corte en ${n}`,
    weekNoPointsYet: (n) => `sin puntos aún en ${n}`,
    weekSoFar: 'Esta semana hasta ahora',

    fixLabel: (label) => label.replace(/^Open in /, 'Abrir en '),
    startedPastKickoff: (n, startersEs) => `${n} ${startersEs} con partido iniciado · `,
    withoutKickoff: (n) => ` · ${n} sin hora de inicio`,

    crossLeagueAria: 'Jugadores en varias alineaciones',
    crossLeagueLabel: 'Afecta a más de una alineación',
    crossLeagueCount: (n) => `en ${n} alineaciones:`,
    crossLeagueMore: (n) => `+${n} más`,

    queueEmpty: (n) => `${n} ${n === 1 ? 'vacía' : 'vacías'}`,
    queueOut: (n) => `${n} ${n === 1 ? 'descartado' : 'descartados'}`,
    queueBye: (n) => `${n} en descanso`,

    labelUnordered: (n) => `${n} visibles · cierran a la vez, sin orden particular`,
    labelUrgency: (n) => `Primeros ${n} · por urgencia`,
    labelQuestionableFirst: (n) => `Primeros ${n} · dudosos primero, luego por hora de cierre`,
    labelLockTime: (n) => `Primeros ${n} · sin problemas, ordenados por hora de cierre`,
    teamsRead: (checked, total, paused) =>
      `${checked} de ${total} equipos ${paused ? 'activos ' : ''}revisados`,

    filterAria: 'Filtrar alineaciones',
    filterAll: 'Todas',
    filterHidden: (n) => `${n} ${n === 1 ? 'alineación más está oculta' : 'alineaciones más están ocultas'} por este filtro. `,
    filterShowAll: 'Mostrar todas',

    allSetLead: (checked, byeChecked, questionableFirst) =>
      `Las ${checked} alineaciones que pudimos leer están listas: sin posiciones vacías ni jugadores descartados${byeChecked ? ', y nadie descansa' : ''}. ${questionableFirst ? 'Primero las que tienen titulares dudosos, luego las que cierran antes.' : 'Estas son las que cierran primero.'}`,
    nothingToSet: 'No hay alineaciones que ajustar ahora: cada equipo está antes del draft, terminado o en pausa. Las líneas de abajo dicen cuáles.',
    allSet: (checked, byeChecked) =>
      `Las ${checked} alineaciones que pudimos leer están listas: sin posiciones vacías ni jugadores descartados${byeChecked ? ', y nadie descansa' : ''}.`,
    pausedLeagues: (n) =>
      `${n} ${n === 1 ? 'liga está pausada' : 'ligas están pausadas'} en esta cuenta y no se incluyen en las prioridades de alineación. `,
    automaticTeams: (n) => `${n} equipos Best Ball usan alineaciones automáticas. `,
    inactiveTeams: (n) => `${n} equipos previos al draft, finalizados o inactivos quedan fuera de las tareas manuales de alineación.`,
    unreadableHead: (unreadable, total, paused) =>
      `${unreadable} de tus ${total} equipos asignados${paused ? ' activos' : ''} no se pudieron revisar.`,
    noRoster: (n) => `${n} sin plantilla importada`,
    noLineup: (n) => `${n} con plantilla pero sin alineación titular registrada`,
    and: ' y ',
    idsUnreadable: (n) => `${n} con plantilla registrada cuyos identificadores no podemos vincular al calendario`,
    staleRows: (n) =>
      `${n} ${n === 1 ? 'liga mostrada no se sincroniza' : 'ligas mostradas no se sincronizan'} desde hace más de un día o falló su última sincronización, así que sus filas pueden describir una alineación anterior. `,

    footerHiddenNeeds: (hidden, hiddenNeeds) =>
      `${hidden === 1 ? 'incluye' : 'incluyen'} ${hiddenNeeds} equipos más que necesitan revisar su alineación; abre la lista completa.`,
    footerUnreadable: (set, unreadable) =>
      `no se muestran: ${set} ${set === 1 ? 'lista' : 'listas'} y ${unreadable} sin poder leer (arriba se explica por qué).`,
    footerNoManual: (hidden) =>
      hidden === 1 ? 'no tiene tareas manuales de alineación pendientes.' : 'no tienen tareas manuales de alineación pendientes.',
    footerSet: (hidden) => (hidden === 1 ? 'está lista; no requiere atención.' : 'están listas; no requieren atención.'),
  },
})
