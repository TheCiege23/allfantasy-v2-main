import { defineMessages } from '@/lib/i18n/messages'

/**
 * Inactive manager mode on the Commissioner Hub (components/core-app/InactiveManagerCommissioner.tsx) —
 * the panel's local `t(english, spanish)` helper, moved here.
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. The "managed since" date arrives already formatted by the component
 * (`toLocaleDateString(getAppIntlLocale())`), so this file imports nothing at runtime.
 */
export const inactiveManagerCommissionerMessages = defineMessages({
  en: {
    loadFailed: 'Commissioner permission or a connection is required.',
    stopped: 'Stopped. The manager sets their own lineup again.',
    turnedOn: 'On. AllFantasy will set this lineup within the hour.',
    saveFailed: 'Could not save. Refresh and try again.',
    autopilotOn:
      'Chimmy is running this team: the lineup, plus a waiver claim when a starter cannot play. Trade offers to it are refused while it does.',
    autopilotOff: 'Autopilot off. AllFantasy still sets the lineup until you stop it.',
    draftAsMeOn: 'On. A missed draft pick is made the way that manager usually drafts.',
    draftAsMeOff: 'Off. A missed draft pick uses the standard autopick.',
    styleDynastyOwner: 'Play like a dynasty owner',
    styleWinNow: 'Win now',
    styleRebuild: 'Rebuild',
    team: 'Team',
    title: 'Inactive manager mode',
    intro:
      "Hand an away manager's lineup to AllFantasy: it sets the projected-best lineup every week, from players whose games have not started. It stops by itself the moment the manager saves a lineup, and the league log shows every change. With AF Commissioner, Chimmy can run the whole team on autopilot, playing like a dynasty owner by default.",
    draftAsMeToggle:
      'Draft as me: when a manager misses a pick, Chimmy drafts the way they usually draft instead of taking the best available player.',
    draftAsMeUpsell: 'Draft as me: missed picks made the way each manager drafts (AF Commissioner)',
    loadingTeams: 'Loading teams…',
    noneInactive: 'No team looks inactive right now.',
    managedSince: (date: string) => `· AllFantasy sets this lineup since ${date}`,
    suggested: '· Suggested: no activity for a while',
    saving: 'Saving…',
    stop: 'Stop',
    letAllFantasySet: 'Let AllFantasy set lineups',
    chimmyAutopilot: 'Chimmy autopilot',
    off: 'Off',
    autopilotUpsell: 'Let Chimmy run this team (AF Commissioner)',
    otherTeams: 'Other teams',
  },
  es: {
    loadFailed: 'Se requiere permiso del comisionado o conexión.',
    stopped: 'Detenido. El mánager vuelve a poner su alineación.',
    turnedOn: 'Activado. AllFantasy pondrá esta alineación en menos de una hora.',
    saveFailed: 'No se pudo guardar. Actualiza e inténtalo de nuevo.',
    autopilotOn:
      'Chimmy dirige este equipo: la alineación y un reclamo cuando un titular no puede jugar. Se rechazan las ofertas de intercambio mientras tanto.',
    autopilotOff: 'Piloto automático apagado. AllFantasy sigue poniendo la alineación hasta que lo detengas.',
    draftAsMeOn: 'Activado. Una selección perdida se hace como suele elegir ese mánager.',
    draftAsMeOff: 'Desactivado. Una selección perdida usa la selección automática estándar.',
    styleDynastyOwner: 'Jugar como dueño dinastía',
    styleWinNow: 'Ganar ya',
    styleRebuild: 'Reconstruir',
    team: 'Equipo',
    title: 'Modo mánager inactivo',
    intro:
      'Deja la alineación de un mánager ausente a AllFantasy: pone la mejor alineación proyectada cada semana, con jugadores cuyos partidos no han empezado. Se detiene sola cuando el mánager guarda una alineación, y el registro de la liga muestra cada cambio. Con AF Commissioner, Chimmy puede dirigir todo el equipo en piloto automático, jugando como dueño dinastía por defecto.',
    draftAsMeToggle:
      'Draft as me: cuando un mánager pierde una selección, Chimmy elige como suele elegir ese mánager en vez de tomar al mejor jugador disponible.',
    draftAsMeUpsell: 'Draft as me: selecciones perdidas hechas como elige cada mánager (AF Commissioner)',
    loadingTeams: 'Cargando equipos…',
    noneInactive: 'Ningún equipo parece inactivo ahora.',
    managedSince: (date) => `· AllFantasy pone esta alineación desde el ${date}`,
    suggested: '· Sugerido: sin actividad hace tiempo',
    saving: 'Guardando…',
    stop: 'Detener',
    letAllFantasySet: 'Que AllFantasy ponga alineaciones',
    chimmyAutopilot: 'Piloto automático de Chimmy',
    off: 'Apagado',
    autopilotUpsell: 'Que Chimmy dirija este equipo (AF Commissioner)',
    otherTeams: 'Otros equipos',
  },
})
