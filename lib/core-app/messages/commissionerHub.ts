import { defineMessages } from '@/lib/i18n/messages'

/**
 * Commissioner Hub loader (lib/core-app/commissionerHub.ts) — the sentences the hub composes at the
 * source: access-row fallbacks, the gate refusal, task-card links, tiles, settings rows and their
 * reasons. Every string is the one the loader wrote before the move, byte for byte, in both
 * languages — this is a relocation, not a rewrite.
 */
export const commissionerHubMessages = defineMessages({
  en: {
    // Access rows — fallbacks that stand in for a name.
    you: 'You',
    unknownManager: 'Unknown manager',
    leagueOwner: 'League owner',

    // Gate + read failures.
    commissionersOnly:
      'Commissioners and co-commissioners only. This is the league’s admin surface — settings, disputes and the attention queue — so it is limited to the people who run it.',
    waiverReadFailed: 'Waiver data couldn’t be read just now. This is a read failure on our side, not a league with no waivers.',
    waiverOversightUpsell: 'Waiver oversight is part of AF Commissioner.',
    tradeHistoryUnread: 'Trade history could not be read.',
    draftHistoryUnread: 'Draft history could not be read.',

    // Health-flag actions.
    resyncLeague: 'Re-sync this league',
    replaceManager: 'Replace a manager',
    openOrphanTeams: 'Open orphan teams',
    openLeague: 'Open league',
    teamFallback: (id: string) => `Team ${id}`,
    openSchedule: 'Open schedule',
    openDuesTracker: 'Open dues tracker',
    openLeagueChat: 'Open league chat',

    // Tiles.
    tileHealth: 'League health',
    healthSub: (status: string, confidencePct: number) => `${status} · ${confidencePct}% confidence`,
    tileNeedsYou: 'Needs you',
    needsYouNone: 'nothing needs a ruling',
    needsYouSome: 'task cards above',
    tileDeadline: 'Next deadline',
    deadlineNone: 'nothing dated is coming up — see the calendar for what is on file',
    tileManagers: 'Active managers',
    managersStale: (days: number) => `last sync was ${days} days ago — activity isn’t judged on data that old`,
    managersSub: (total: number, inactive: number, days: number) => `of ${total} · ${inactive} with no move in ${days} days`,
    tileClaimed: 'Claimed teams',
    claimedAll: (total: number) => `of ${total} · every team is connected`,
    claimedSome: (total: number, unclaimed: number) => `of ${total} · ${unclaimed} with no AllFantasy account`,
    noTeamsIngested: 'no teams have been ingested for this league yet',
    tileSync: 'Sync',
    syncLive: 'Live',
    syncLiveSub: 'runs on AllFantasy',
    neverSyncedReason: 'this league has never synced, so nothing on this screen has been measured yet',
    syncStale: 'Stale',
    syncOk: 'OK',

    // Settings rows.
    settingTradeDeadline: 'Trade deadline',
    settingWaivers: 'Waivers',
    noWaiverSettings: 'no waiver settings were ingested for this league',

    // Task list + disputes.
    tasksEmptyNeverSynced: 'This league has never synced, so nothing has been checked. An empty list here is not the same as a quiet league.',
    tasksEmptyQuiet: 'Nothing in this league needs you right now.',
    disputesNative: 'Open the integrity monitor for flags and each detector’s scan status. No flags on file does not establish that a scan ran.',
    disputesImported:
      'Dispute detection only runs on leagues created in AllFantasy — it has no data to read for an imported league, so "none found" would not mean anything here. The “Resolve a dispute” guide on this page works for every league.',

    // describeSyncAge.
    syncAgeNever: 'never synced',
    syncAgeNow: 'synced just now',
    syncAgeMinutes: (minutes: number) => `synced ${minutes}m ago`,
    syncAgeHours: (hours: number) => `synced ${hours}h ago`,
    syncAgeDays: (days: number) => `synced ${days}d ago`,

    // describeTradeDeadline / describePlayoffs.
    notPublished: 'not published in this league’s platform settings',
    noTradeDeadline: 'No deadline — trades stay open all season',
    tradeDeadlineWeek: (week: number) => `Week ${week}`,
    playoffsDefaults: 'this league’s playoff format was never ingested — the stored values are schema defaults, not its real settings',
    playoffsTop: (teams: number) => `Top ${teams}`,
    playoffsFrom: (start: number) => `from Week ${start}`,
  },
  es: {
    you: 'Tú',
    unknownManager: 'Mánager desconocido',
    leagueOwner: 'Dueño de la liga',

    commissionersOnly:
      'Solo para comisionados y cocomisionados. Esta es la zona de administración de la liga (configuración, disputas y la cola de atención), así que está limitada a quienes la dirigen.',
    waiverReadFailed:
      'No se pudieron leer los datos de agentes libres en este momento. Es un fallo de lectura por nuestra parte, no una liga sin agentes libres.',
    waiverOversightUpsell: 'La supervisión de agentes libres es parte de AF Commissioner.',
    tradeHistoryUnread: 'No se pudo leer el historial de intercambios.',
    draftHistoryUnread: 'No se pudo leer el historial de drafts.',

    resyncLeague: 'Volver a sincronizar esta liga',
    replaceManager: 'Reemplazar a un mánager',
    openOrphanTeams: 'Abrir equipos huérfanos',
    openLeague: 'Abrir la liga',
    teamFallback: (id) => `Equipo ${id}`,
    openSchedule: 'Abrir el calendario de partidos',
    openDuesTracker: 'Abrir el control de cuotas',
    openLeagueChat: 'Abrir el chat de la liga',

    tileHealth: 'Salud de la liga',
    healthSub: (status, confidencePct) => `${status} · ${confidencePct} % de confianza`,
    tileNeedsYou: 'Te necesita',
    needsYouNone: 'nada necesita una decisión',
    needsYouSome: 'tareas arriba',
    tileDeadline: 'Próxima fecha límite',
    deadlineNone: 'no se acerca nada con fecha: mira el calendario para ver lo registrado',
    tileManagers: 'Mánagers activos',
    managersStale: (days) => `la última sincronización fue hace ${days} días: no se juzga la actividad con datos tan viejos`,
    managersSub: (total, inactive, days) => `de ${total} · ${inactive} sin movimientos en ${days} días`,
    tileClaimed: 'Equipos reclamados',
    claimedAll: (total) => `de ${total} · todos los equipos están conectados`,
    claimedSome: (total, unclaimed) => `de ${total} · ${unclaimed} sin cuenta de AllFantasy`,
    noTeamsIngested: 'aún no se ha importado ningún equipo en esta liga',
    tileSync: 'Sincronización',
    syncLive: 'En vivo',
    syncLiveSub: 'funciona en AllFantasy',
    neverSyncedReason: 'esta liga nunca se ha sincronizado, así que aún no se ha medido nada en esta pantalla',
    syncStale: 'Desactualizada',
    syncOk: 'Al día',

    settingTradeDeadline: 'Fecha límite de intercambios',
    settingWaivers: 'Agentes libres',
    noWaiverSettings: 'no se importó la configuración de agentes libres de esta liga',

    tasksEmptyNeverSynced:
      'Esta liga nunca se ha sincronizado, así que no se ha revisado nada. Una lista vacía aquí no es lo mismo que una liga tranquila.',
    tasksEmptyQuiet: 'Nada en esta liga te necesita ahora mismo.',
    disputesNative:
      'Abre el monitor de integridad para ver las alertas y el estado de revisión de cada detector. Que no haya alertas registradas no demuestra que se haya hecho una revisión.',
    disputesImported:
      'La detección de disputas solo funciona en ligas creadas en AllFantasy: no tiene datos que leer en una liga importada, así que "ninguna encontrada" no significaría nada aquí. La guía «Resolver una disputa» de esta página sirve para cualquier liga.',

    syncAgeNever: 'nunca sincronizada',
    syncAgeNow: 'sincronizada ahora mismo',
    syncAgeMinutes: (minutes) => `sincronizada hace ${minutes} min`,
    syncAgeHours: (hours) => `sincronizada hace ${hours} h`,
    syncAgeDays: (days) => `sincronizada hace ${days} d`,

    notPublished: 'no figura en la configuración de la plataforma de esta liga',
    noTradeDeadline: 'Sin fecha límite: los intercambios siguen abiertos toda la temporada',
    tradeDeadlineWeek: (week) => `Semana ${week}`,
    playoffsDefaults:
      'el formato de playoffs de esta liga nunca se importó: los valores guardados son los predeterminados, no su configuración real',
    playoffsTop: (teams) => `Los ${teams} mejores`,
    playoffsFrom: (start) => `desde la semana ${start}`,
  },
})
