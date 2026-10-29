import { defineMessages } from '@/lib/i18n/messages'

/**
 * Commissioner Hub builders (lib/core-app/commissioner/health.ts, activity.ts, signals.ts, tasks.ts,
 * recipes.ts, calendar.ts).
 * Every string is the one the builder wrote before the move, byte for byte, in both languages — this
 * is a relocation, not a rewrite. Keys are prefixed by the module that reads them.
 */

/** "1 team", "3 teams" — the builders' own plural, repeated here so the catalog imports nothing at runtime. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const daysEs = (n: number) => plural(n, 'día', 'días')

export const commissionerToolsMessages = defineMessages({
  en: {
    // ── health.ts ──
    healthUnnamedTeams: (blanks: number) => `${blanks} unnamed teams`,
    healthAndMore: (shown: string, rest: number) => `${shown} and ${rest} more`,
    healthAbandonedLabel: 'Abandoned teams',
    healthActivityUnreadable: 'Manager activity could not be read just now, so no team can be called abandoned or active.',
    healthNoTeamsInLeague: 'No teams have been imported for this league yet.',
    healthNoMovesHeadline: 'No manager has made a move in 14 days',
    healthLeagueQuietDetail: (managers: number) =>
      `None of the ${managers} managers has made a trade, waiver claim or roster move in two weeks. That is the league being quiet, not one team being abandoned.`,
    healthAllOwnedActiveHeadline: 'Every team has an owner and a recent move',
    healthUnownedHeadline: (n: number) => `${plural(n, 'team')} with no owner`,
    healthQuietHeadline: (n: number) => `${plural(n, 'manager')} with no moves in 14 days`,
    healthAllOwnedActiveDetail: 'Every team has an owner, and every manager has made a move in the last 14 days.',
    healthAllOwnedDetail: 'Every team has an owner.',
    healthUnownedDetail: (preview: string) => `No owner: ${preview}.`,
    healthQuietDetail: (preview: string) =>
      `No trade, waiver claim or roster move in 14 days: ${preview}. Quiet isn’t the same as gone — check in before replacing anyone.`,
    healthLineupsLabel: 'Missing lineups',
    healthLineupsUnknowable: (platform: string) =>
      `${platform} imports don't say whether a blank lineup is empty or just not reported, so lineups aren't checked here.`,
    healthLineupsOffSeason: 'Lineups are only checked while the season is being played.',
    healthLineupsNoneReadable: 'No roster in this league has a readable starting lineup yet.',
    healthLineupsUnread: (unread: number) => ` ${plural(unread, 'roster')} could not be read and ${unread === 1 ? 'is' : 'are'} not counted.`,
    healthLineupsFullHeadline: 'Every lineup is full',
    healthLineupsHolesHeadline: (n: number) => `${plural(n, 'team')} starting with an empty slot`,
    healthLineupsFullDetail: (readable: number) => `All ${readable} readable lineups have every starting slot filled.`,
    healthLineupsHole: (name: string, empty: number) => `${name} (${plural(empty, 'empty slot')})`,
    healthLineupsMore: (n: number) => ` and ${n} more.`,
    healthScheduleLabel: 'Unequal schedules',
    healthScheduleElimination: 'This is an elimination format, where eliminated teams stop playing — unequal game counts are the rules working.',
    healthScheduleNoWeeks: 'No played weeks have been imported for this season yet.',
    healthScheduleNoTeams: 'No teams to compare.',
    healthScheduleEvenHeadline: (most: number) => `Everyone has played ${plural(most, 'game')}`,
    healthScheduleBehindHeadline: (n: number) => `${plural(n, 'team')} behind on games`,
    healthScheduleEvenDetail: (through: number) => `Every team has a matchup in each of weeks 1–${through}.`,
    healthScheduleBehindDetail: (most: number, through: number, behind: Array<{ name: string; n: number }>) =>
      `Most teams have ${plural(most, 'game')} through week ${through}; ${behind
        .slice(0, 4)
        .map((b) => `${b.name} has ${b.n}`)
        .join(', ')}${behind.length > 4 ? ` and ${behind.length - 4} more` : ''}.`,
    healthDuesLabel: 'Unpaid dues',
    healthDuesUntracked: 'Dues aren’t tracked in AllFantasy for this league, so nobody can be called paid or unpaid.',
    healthDuesSetUp: 'Set up dues tracking',
    healthDuesNoTeams: 'No teams have been imported yet.',
    healthDuesAmount: (money: string) => ` of ${money}`,
    healthDuesPaidHeadline: 'Everyone has paid',
    healthDuesOweHeadline: (n: number, amount: string) => `${plural(n, 'team')} still owe${n === 1 ? 's' : ''} dues${amount}`,
    healthDuesPaidDetail: (teams: number) => `All ${teams} teams are marked paid in the dues tracker.`,
    healthDuesUnpaidDetail: (preview: string) => `${preview}. Marked by hand in the dues tracker — AllFantasy does not see the payment itself.`,
    healthVotesLabel: 'Unresolved votes',
    healthVotesUnreadable: 'League chat polls could not be read just now.',
    healthVotesNoneHeadline: 'No open votes',
    healthVotesOpenHeadline: (n: number) => `${plural(n, 'league vote')} still open`,
    healthVotesNoneDetail: 'Every league-chat poll has closed. Votes held on the platform itself are not imported.',
    healthVoteCloses: (question: string, closesAt: string) => `“${question}” closes ${new Date(closesAt).toUTCString().slice(0, 16)}`,
    healthVoteNoDeadline: (question: string) => `“${question}” has no deadline`,
    healthVotesMore: (n: number) => `; and ${n} more.`,

    // ── activity.ts ──
    activityNoMoves: 'No moves have been imported for this league yet, so nobody can be called active or inactive.',
    activityFeedStale: (ageDays: number) =>
      `The newest imported move is ${plural(ageDays, 'day')} old, so every manager would look idle. Re-sync the league to check who is really active.`,
    activityUnmatched: 'This league’s moves couldn’t be matched to its managers, so activity isn’t judged here.',
    activityLastMoveAgo: (days: number) => `last move ${plural(days, 'day')} ago`,
    activityNoQualifyingMove: 'no qualifying move on file',
    activityBasisMoves: (windowDays: number) => `trades, waiver claims and roster moves in the last ${windowDays} days`,
    activityManagersUnreadable: 'Manager activity couldn’t be read just now.',
    activityNoRosters: 'No rosters have been set up for this league yet.',
    activityNoneOnFile: 'no activity on file',
    activityToday: 'active today',
    activityYesterday: 'last move yesterday',
    activityBasisRoster: 'the last lineup or roster change',
    activityLeagueUnreadable: 'League activity couldn’t be read just now.',
    activityStaleSync: (days: number) =>
      `AllFantasy last read this league ${days} days ago, so every manager would look idle. Re-sync it to see who is really active.`,
    activityUnnamedTeam: 'Unnamed team',
    activityTeamSlot: (slot: string) => `Team ${slot}`,

    // ── signals.ts ──
    signalsIntegrityTitle: (n: number) => `${plural(n, 'open integrity alert')}`,
    signalsIntegrityDetail: 'Flagged from trade values and lineup cards. They need a person to look before anything is decided.',
    signalsIntegrityAction: 'Review alerts',
    signalsTradesTitle: (n: number) => `${plural(n, 'trade')} awaiting your review`,
    signalsTradesDetail: 'Both managers agreed. The trade does not go through until a commissioner approves or vetoes it.',
    signalsTradesAction: 'Review trades',
    signalsWaiversTitle: (n: number) => `${plural(n, 'waiver claim')} waiting over a week`,
    signalsWaiversDetail: 'These claims should have been decided by a waiver run by now. Run waivers to process them.',
    signalsWaiversAction: 'Open waivers',
    signalsDraftTitle: 'No draft date set',
    signalsDraftDetail: 'Managers can’t plan around a draft that isn’t scheduled. Add the date in draft settings.',
    signalsDraftAction: 'Set the date',

    // ── tasks.ts ──
    tasksStaleTitle: (days: number) => `This league’s data is ${days} days old`,
    tasksStaleDetail: (platformLabel: string) =>
      `AllFantasy hasn’t read it from ${platformLabel} since then, so activity, lineups and inactive managers can’t be checked.`,
    tasksResync: 'Re-sync',
    tasksSeeCalendar: 'See calendar',
    tasksOpen: 'Open',
    // ── recipes.ts ── (`RECIPES` reads these English values directly: the chat posts stay English)
    recipesLineupReminderLabel: 'Lineup reminders',
    recipesLineupReminderDescription: 'On each NFL game day, a morning post naming teams with an empty starting slot.',
    recipesLineupReminderCadence: 'Game days, early morning ET',
    recipesWeeklyRecapLabel: 'Weekly recap',
    recipesWeeklyRecapDescription: 'Results, the top of the table and the week’s awards, counted from real matchups.',
    recipesWeeklyRecapCadence: 'Tuesdays',
    recipesInactivityWarningLabel: 'Inactivity warnings',
    recipesInactivityWarningDescription: 'A friendly weekly check-in naming managers with no trade, waiver claim or roster move in 14 days.',
    recipesInactivityWarningCadence: 'Once a week at most',
    recipesVotingDeadlineLabel: 'Voting deadlines',
    recipesVotingDeadlineDescription: 'A reminder when a league-chat poll closes within the next day.',
    recipesVotingDeadlineCadence: 'The day before a poll closes',
    recipesPlayoffAnnouncementLabel: 'Playoff announcement',
    recipesPlayoffAnnouncementDescription: 'When playoffs begin, a post with the seeds as the standings have them.',
    recipesPlayoffAnnouncementCadence: 'Once a season',
    recipesUnavailableNflOnly: 'Game-day timing is only known for NFL leagues today.',
    recipesUnavailableMflLineups: 'MFL imports can’t tell an empty lineup from an unreported one.',
    recipesUnavailableFantraxLineups: 'Fantrax imports can’t tell an empty lineup from an unreported one.',
    recipesUnavailableWeeklyRecap: 'Weekly recaps require a Sleeper week feed or finalized AllFantasy matchups.',
    // ── calendar.ts ──
    calendarWeek: (week: number) => `Week ${week}`,
    calendarDraft: 'Draft',
    calendarDraftSetInSettings: 'Set in this league’s draft settings.',
    calendarDraftInProgress: 'Draft — in progress',
    calendarNow: 'Now',
    calendarNoDateOnFile: 'No date on file',
    calendarNoDraftDateNative: 'No draft date is set. Add one in draft settings so it shows here and in managers’ calendars.',
    calendarNoDraftDatePlatform: (platformLabel: string) => `${platformLabel} holds this draft’s date, and imports don’t carry it yet.`,
    calendarWaiversOnPlatform: (platformLabel: string) => `Waivers process on ${platformLabel}, and its processing schedule isn’t imported.`,
    calendarNoWaiverRun: 'This league has no waiver run — free agents are first come, first served.',
    calendarWaiversProcess: 'Waivers process',
    calendarWaiversDetail: 'Every week at this time. Claims submitted before then are processed together.',
    calendarWaiverTimeUnset: 'This league’s waiver processing time isn’t set.',
    calendarNoTradeDeadline: 'No trade deadline — trades stay open all season.',
    calendarTradeDeadline: 'Trade deadline',
    calendarTradesCloseKickoff: (week: number) => `Trades close in week ${week}, which kicks off on this date.`,
    calendarTradesClose: (week: number) => `Trades close in week ${week}.`,
    calendarTradeDeadlineUnpublished: (native: boolean, platformLabel: string) =>
      `No trade deadline is published in this league’s ${native ? '' : `${platformLabel} `}settings.`,
    calendarPickTradesOpen: 'Pick trades stay open all season; only player trades close at the deadline.',
    calendarPickTradeDeadline: 'Pick trade deadline',
    calendarPickTradesClose: (week: number) => `Trades made only of draft picks close after week ${week}.`,
    calendarPlayoffsBegin: 'Playoffs begin',
    calendarPlayoffsDetail: 'The regular season ends the week before.',
    calendarNoPlayoffWeek: 'No playoff start week is published for this league.',
    calendarDuesUnpaid: (unpaid: number) => `Dues — ${unpaid} unpaid`,
    calendarDuesAllPaid: 'Dues — all paid',
    calendarNoDueDate: 'No due date',
    calendarDuesDetail: (amountLabel: string | null) =>
      `${amountLabel ? `${amountLabel} per team. ` : ''}The dues tracker has no due date field, so this can’t be put on a calendar.`,
    calendarDuesUntracked: 'Dues aren’t tracked in AllFantasy for this league.',
    calendarVoteCloses: (question: string) => `Vote closes: ${question}`,
    calendarNoDeadline: 'No deadline',
    calendarPollDetail: 'League-chat poll.',
    calendarPollNoDeadlineDetail: 'League-chat poll with no deadline — it stays open until someone closes it.',
    calendarRenew: 'Renew for next season',
    calendarRenewNative: 'This season is finished. Renew the league to carry rosters and managers forward.',
    calendarRenewFollows: (platformLabel: string) =>
      `This season is finished. Renew it on ${platformLabel} — AllFantasy picks up the new season on its own within a few hours.`,
    calendarRenewReimport: (platformLabel: string) =>
      `This season is finished. Renew it on ${platformLabel}, then re-import so AllFantasy follows the new season.`,
    calendarIcsName: (leagueName: string) => `${leagueName} — league calendar`,
  },
  es: {
    // ── health.ts ──
    healthUnnamedTeams: (blanks) => `${blanks} equipos sin nombre`,
    healthAndMore: (shown, rest) => `${shown} y ${rest} más`,
    healthAbandonedLabel: 'Equipos abandonados',
    healthActivityUnreadable:
      'No se pudo leer la actividad de los mánagers en este momento, así que ningún equipo puede considerarse abandonado ni activo.',
    healthNoTeamsInLeague: 'Aún no se ha importado ningún equipo en esta liga.',
    healthNoMovesHeadline: 'Ningún mánager ha hecho un movimiento en 14 días',
    healthLeagueQuietDetail: (managers) =>
      `Ninguno de los ${managers} mánagers ha hecho un intercambio, un reclamo ni un cambio de plantilla en dos semanas. Es la liga la que está tranquila, no un equipo abandonado.`,
    healthAllOwnedActiveHeadline: 'Todos los equipos tienen dueño y un movimiento reciente',
    healthUnownedHeadline: (n) => plural(n, 'equipo sin dueño', 'equipos sin dueño'),
    healthQuietHeadline: (n) => plural(n, 'mánager sin movimientos en 14 días', 'mánagers sin movimientos en 14 días'),
    healthAllOwnedActiveDetail: 'Todos los equipos tienen dueño, y todos los mánagers han hecho un movimiento en los últimos 14 días.',
    healthAllOwnedDetail: 'Todos los equipos tienen dueño.',
    healthUnownedDetail: (preview) => `Sin dueño: ${preview}.`,
    healthQuietDetail: (preview) =>
      `Sin intercambios, reclamos ni cambios de plantilla en 14 días: ${preview}. Estar tranquilo no es lo mismo que haberse ido: habla con ellos antes de reemplazar a nadie.`,
    healthLineupsLabel: 'Alineaciones incompletas',
    healthLineupsUnknowable: (platform) =>
      `Las importaciones de ${platform} no indican si una alineación en blanco está vacía o simplemente no se reportó, así que aquí no se revisan las alineaciones.`,
    healthLineupsOffSeason: 'Las alineaciones solo se revisan mientras se juega la temporada.',
    healthLineupsNoneReadable: 'Ninguna plantilla de esta liga tiene todavía una alineación titular legible.',
    healthLineupsUnread: (unread) =>
      ` ${plural(unread, 'plantilla', 'plantillas')} no se ${unread === 1 ? 'pudo' : 'pudieron'} leer y no ${unread === 1 ? 'cuenta' : 'cuentan'}.`,
    healthLineupsFullHeadline: 'Todas las alineaciones están completas',
    healthLineupsHolesHeadline: (n) => `${plural(n, 'equipo', 'equipos')} con un hueco en la alineación titular`,
    healthLineupsFullDetail: (readable) =>
      readable === 1
        ? 'La única alineación legible tiene todos los puestos titulares cubiertos.'
        : `Las ${readable} alineaciones legibles tienen todos los puestos titulares cubiertos.`,
    healthLineupsHole: (name, empty) => `${name} (${plural(empty, 'hueco vacío', 'huecos vacíos')})`,
    healthLineupsMore: (n) => ` y ${n} más.`,
    healthScheduleLabel: 'Calendarios desiguales',
    healthScheduleElimination:
      'Es un formato de eliminación, en el que los equipos eliminados dejan de jugar: que no todos tengan los mismos partidos es la regla funcionando.',
    healthScheduleNoWeeks: 'Aún no se ha importado ninguna semana jugada de esta temporada.',
    healthScheduleNoTeams: 'No hay equipos que comparar.',
    healthScheduleEvenHeadline: (most) => `Todos han jugado ${plural(most, 'partido', 'partidos')}`,
    healthScheduleBehindHeadline: (n) => `${plural(n, 'equipo', 'equipos')} con partidos de menos`,
    healthScheduleEvenDetail: (through) =>
      through === 1
        ? 'Todos los equipos tienen un enfrentamiento en la semana 1.'
        : `Todos los equipos tienen un enfrentamiento en cada una de las semanas 1–${through}.`,
    healthScheduleBehindDetail: (most, through, behind) =>
      `La mayoría de los equipos tiene ${plural(most, 'partido', 'partidos')} hasta la semana ${through}; ${behind
        .slice(0, 4)
        .map((b) => `${b.name} tiene ${b.n}`)
        .join(', ')}${behind.length > 4 ? ` y ${behind.length - 4} más` : ''}.`,
    healthDuesLabel: 'Cuotas sin pagar',
    healthDuesUntracked: 'Las cuotas de esta liga no se registran en AllFantasy, así que nadie puede considerarse al día ni pendiente.',
    healthDuesSetUp: 'Configurar el control de cuotas',
    healthDuesNoTeams: 'Aún no se ha importado ningún equipo.',
    healthDuesAmount: (money) => ` de ${money}`,
    healthDuesPaidHeadline: 'Todos han pagado',
    healthDuesOweHeadline: (n, amount) => `${plural(n, 'equipo', 'equipos')} ${n === 1 ? 'debe' : 'deben'} la cuota${amount}`,
    healthDuesPaidDetail: (teams) =>
      teams === 1
        ? 'El único equipo figura como pagado en el control de cuotas.'
        : `Los ${teams} equipos figuran como pagados en el control de cuotas.`,
    healthDuesUnpaidDetail: (preview) => `${preview}. Se marca a mano en el control de cuotas: AllFantasy no ve el pago en sí.`,
    healthVotesLabel: 'Votaciones abiertas',
    healthVotesUnreadable: 'No se pudieron leer las encuestas del chat de la liga en este momento.',
    healthVotesNoneHeadline: 'No hay votaciones abiertas',
    healthVotesOpenHeadline: (n) => plural(n, 'votación de la liga sigue abierta', 'votaciones de la liga siguen abiertas'),
    healthVotesNoneDetail:
      'Todas las encuestas del chat de la liga se han cerrado. Las votaciones hechas en la propia plataforma no se importan.',
    healthVoteCloses: (question, closesAt) =>
      `“${question}” cierra el ${new Date(closesAt).toLocaleDateString('es', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
    healthVoteNoDeadline: (question) => `“${question}” no tiene fecha límite`,
    healthVotesMore: (n) => `; y ${n} más.`,

    // ── activity.ts ──
    activityNoMoves: 'Aún no se ha importado ningún movimiento de esta liga, así que nadie puede considerarse activo ni inactivo.',
    activityFeedStale: (ageDays) =>
      `El movimiento importado más reciente tiene ${daysEs(ageDays)}, así que todos los mánagers parecerían inactivos. Vuelve a sincronizar la liga para ver quién está realmente activo.`,
    activityUnmatched: 'Los movimientos de esta liga no se pudieron asociar a sus mánagers, así que aquí no se juzga la actividad.',
    activityLastMoveAgo: (days) => `último movimiento hace ${daysEs(days)}`,
    activityNoQualifyingMove: 'ningún movimiento válido registrado',
    activityBasisMoves: (windowDays) => `los intercambios, reclamos y cambios de plantilla de los últimos ${windowDays} días`,
    activityManagersUnreadable: 'No se pudo leer la actividad de los mánagers en este momento.',
    activityNoRosters: 'Aún no se ha configurado ninguna plantilla en esta liga.',
    activityNoneOnFile: 'sin actividad registrada',
    activityToday: 'activo hoy',
    activityYesterday: 'último movimiento ayer',
    activityBasisRoster: 'el último cambio de alineación o de plantilla',
    activityLeagueUnreadable: 'No se pudo leer la actividad de la liga en este momento.',
    activityStaleSync: (days) =>
      `AllFantasy leyó esta liga por última vez hace ${days} días, así que todos los mánagers parecerían inactivos. Vuelve a sincronizarla para ver quién está realmente activo.`,
    activityUnnamedTeam: 'Equipo sin nombre',
    activityTeamSlot: (slot) => `Equipo ${slot}`,

    // ── signals.ts ──
    signalsIntegrityTitle: (n) => plural(n, 'alerta de integridad abierta', 'alertas de integridad abiertas'),
    signalsIntegrityDetail:
      'Detectadas a partir de los valores de los intercambios y las alineaciones. Necesitan que una persona las revise antes de decidir nada.',
    signalsIntegrityAction: 'Revisar alertas',
    signalsTradesTitle: (n) => `${plural(n, 'intercambio espera', 'intercambios esperan')} tu revisión`,
    signalsTradesDetail: 'Ambos mánagers aceptaron. El intercambio no se hace efectivo hasta que un comisionado lo apruebe o lo vete.',
    signalsTradesAction: 'Revisar intercambios',
    signalsWaiversTitle: (n) => `${plural(n, 'reclamo lleva', 'reclamos llevan')} más de una semana esperando`,
    signalsWaiversDetail: 'Estos reclamos ya deberían haberse resuelto en un procesamiento de reclamos. Procésalos para resolverlos.',
    signalsWaiversAction: 'Abrir agentes libres',
    signalsDraftTitle: 'No hay fecha de draft',
    signalsDraftDetail: 'Los mánagers no pueden organizarse para un draft sin fecha. Añádela en la configuración del draft.',
    signalsDraftAction: 'Poner la fecha',

    // ── tasks.ts ──
    tasksStaleTitle: (days) => `Los datos de esta liga tienen ${days} días`,
    tasksStaleDetail: (platformLabel) =>
      `AllFantasy no los ha leído de ${platformLabel} desde entonces, así que no se puede revisar la actividad, las alineaciones ni los mánagers inactivos.`,
    tasksResync: 'Volver a sincronizar',
    tasksSeeCalendar: 'Ver el calendario',
    tasksOpen: 'Abrir',
    // ── recipes.ts ──
    recipesLineupReminderLabel: 'Recordatorios de alineación',
    recipesLineupReminderDescription: 'Cada día de partido de la NFL, una publicación por la mañana que nombra a los equipos con un puesto titular vacío.',
    recipesLineupReminderCadence: 'Días de partido, temprano por la mañana (ET)',
    recipesWeeklyRecapLabel: 'Resumen semanal',
    recipesWeeklyRecapDescription: 'Resultados, lo más alto de la tabla y los premios de la semana, calculados con los enfrentamientos reales.',
    recipesWeeklyRecapCadence: 'Los martes',
    recipesInactivityWarningLabel: 'Avisos de inactividad',
    recipesInactivityWarningDescription: 'Un aviso semanal amistoso que nombra a los mánagers sin intercambios, reclamos ni cambios de plantilla en 14 días.',
    recipesInactivityWarningCadence: 'Como mucho una vez por semana',
    recipesVotingDeadlineLabel: 'Fechas límite de votación',
    recipesVotingDeadlineDescription: 'Un recordatorio cuando una encuesta del chat de la liga cierra en el próximo día.',
    recipesVotingDeadlineCadence: 'El día antes de que cierre una encuesta',
    recipesPlayoffAnnouncementLabel: 'Anuncio de playoffs',
    recipesPlayoffAnnouncementDescription: 'Cuando empiezan los playoffs, una publicación con los cabezas de serie según la clasificación.',
    recipesPlayoffAnnouncementCadence: 'Una vez por temporada',
    recipesUnavailableNflOnly: 'Por ahora solo se conoce el horario de los días de partido en las ligas de la NFL.',
    recipesUnavailableMflLineups: 'Las importaciones de MFL no distinguen una alineación vacía de una no reportada.',
    recipesUnavailableFantraxLineups: 'Las importaciones de Fantrax no distinguen una alineación vacía de una no reportada.',
    recipesUnavailableWeeklyRecap: 'Los resúmenes semanales necesitan los datos semanales de Sleeper o enfrentamientos finalizados de AllFantasy.',
    // ── calendar.ts ──
    calendarWeek: (week) => `Semana ${week}`,
    calendarDraft: 'Draft',
    calendarDraftSetInSettings: 'Fijado en la configuración del draft de esta liga.',
    calendarDraftInProgress: 'Draft en curso',
    calendarNow: 'Ahora',
    calendarNoDateOnFile: 'Sin fecha registrada',
    calendarNoDraftDateNative: 'No hay fecha de draft. Añade una en la configuración del draft para que aparezca aquí y en los calendarios de los mánagers.',
    calendarNoDraftDatePlatform: (platformLabel) => `${platformLabel} guarda la fecha de este draft, y las importaciones aún no la traen.`,
    calendarWaiversOnPlatform: (platformLabel) => `Los reclamos se procesan en ${platformLabel}, y su horario de procesamiento no se importa.`,
    calendarNoWaiverRun: 'Esta liga no tiene procesamiento de reclamos: los fichajes son por orden de llegada.',
    calendarWaiversProcess: 'Procesamiento de reclamos',
    calendarWaiversDetail: 'Cada semana a esta hora. Los reclamos enviados antes se procesan juntos.',
    calendarWaiverTimeUnset: 'No está fijada la hora del procesamiento de reclamos de esta liga.',
    calendarNoTradeDeadline: 'Sin fecha límite de intercambios: siguen abiertos toda la temporada.',
    calendarTradeDeadline: 'Fecha límite de intercambios',
    calendarTradesCloseKickoff: (week) => `Los intercambios cierran en la semana ${week}, que empieza en esta fecha.`,
    calendarTradesClose: (week) => `Los intercambios cierran en la semana ${week}.`,
    calendarTradeDeadlineUnpublished: (native, platformLabel) =>
      native
        ? 'La configuración de esta liga no fija una fecha límite de intercambios.'
        : `La configuración de ${platformLabel} de esta liga no fija una fecha límite de intercambios.`,
    calendarPickTradesOpen: 'Los intercambios de selecciones siguen abiertos toda la temporada; solo los de jugadores cierran en la fecha límite.',
    calendarPickTradeDeadline: 'Fecha límite para intercambiar selecciones',
    calendarPickTradesClose: (week) => `Los intercambios solo de selecciones del draft cierran tras la semana ${week}.`,
    calendarPlayoffsBegin: 'Empiezan los playoffs',
    calendarPlayoffsDetail: 'La temporada regular termina la semana anterior.',
    calendarNoPlayoffWeek: 'No figura la semana de inicio de los playoffs de esta liga.',
    calendarDuesUnpaid: (unpaid) => `Cuotas: ${unpaid} sin pagar`,
    calendarDuesAllPaid: 'Cuotas: todas pagadas',
    calendarNoDueDate: 'Sin fecha de pago',
    calendarDuesDetail: (amountLabel) =>
      `${amountLabel ? `${amountLabel} por equipo. ` : ''}El control de cuotas no tiene campo de fecha de pago, así que no se puede poner en un calendario.`,
    calendarDuesUntracked: 'Las cuotas de esta liga no se registran en AllFantasy.',
    calendarVoteCloses: (question) => `Cierra la votación: ${question}`,
    calendarNoDeadline: 'Sin fecha límite',
    calendarPollDetail: 'Encuesta del chat de la liga.',
    calendarPollNoDeadlineDetail: 'Encuesta del chat de la liga sin fecha límite: sigue abierta hasta que alguien la cierre.',
    calendarRenew: 'Renovar para la próxima temporada',
    calendarRenewNative: 'Esta temporada terminó. Renueva la liga para conservar las plantillas y los mánagers.',
    calendarRenewFollows: (platformLabel) =>
      `Esta temporada terminó. Renuévala en ${platformLabel}: AllFantasy toma la nueva temporada por su cuenta en unas horas.`,
    calendarRenewReimport: (platformLabel) =>
      `Esta temporada terminó. Renuévala en ${platformLabel} y vuelve a importarla para que AllFantasy siga la nueva temporada.`,
    calendarIcsName: (leagueName) => `${leagueName}: calendario de la liga`,
  },
})
