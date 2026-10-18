import { defineMessages } from '@/lib/i18n/messages'

/**
 * Commissioner Hub builders (lib/core-app/commissioner/health.ts, activity.ts, signals.ts, tasks.ts).
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
  },
})
