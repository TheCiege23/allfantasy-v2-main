import { defineMessages } from '@/lib/i18n/messages'

/**
 * Commissioner Hub — where everything lives (lib/core-app/commissioner/areas.ts: `buildLeagueAreas`,
 * `buildWorkflows`, `buildCommunities`).
 * Every string is the one the builder wrote before the move, byte for byte, in both languages — this
 * is a relocation, not a rewrite. Keys are prefixed by the builder that reads them: `area*` (league
 * areas), `wf*` (guided workflows; `wfReplace*`, `wfRule*`, `wfDraft*`, `wfDispute*` per guide) and
 * `comm*` (external communities). A string several builders share sits under the first one.
 */

export const commissionerAreasMessages = defineMessages({
  en: {
    // ── buildLeagueAreas ──
    areaReadNote: (pl: string) => `Read from ${pl}. Changes are made there.`,
    areaOverviewLabel: 'Overview',
    areaOverviewDescription: 'Standings snapshot, this week, and what changed.',
    areaOverviewLink: 'Open overview',
    areaSettingsLabel: 'Settings',
    areaSettingsDescription: 'Scoring, rosters, waivers, trades, draft and playoffs.',
    areaSettingsLink: 'Open settings',
    areaSettingsNote: (pl: string) => `A read-only summary here. Rules are changed on ${pl}.`,
    areaMembersLabel: 'Members',
    areaMembersDescription: 'Who manages each team, invites, and co-commissioners.',
    areaMembersLink: 'Manage members',
    areaMembersNote: (pl: string) => `Team ownership is set on ${pl}. AllFantasy handles invites to claim a team here.`,
    areaStandingsLabel: 'Standings',
    areaStandingsDescription: 'Records, points and playoff picture.',
    areaStandingsLink: 'Open standings',
    areaScheduleLabel: 'Schedule',
    areaScheduleDescription: 'Every week’s matchups.',
    areaScheduleLink: 'Open schedule',
    areaDraftsLabel: 'Drafts',
    areaDraftsDescription: 'Draft board, order and results.',
    areaDraftsNote: (pl: string) => `The draft itself runs on ${pl}; Draft HQ follows it.`,
    areaTradesLabel: 'Trades',
    areaTradesDescription: 'Offers, completed deals and review.',
    areaTradesNote: (pl: string) => `Trades are accepted and vetoed on ${pl}.`,
    areaWaiversLabel: 'Waivers',
    areaWaiversDescription: 'Claims, FAAB and the last run.',
    areaWaiversLink: 'Open waivers',
    areaWaiversNote: (pl: string) => `Claims are processed on ${pl}.`,
    areaHistoryLabel: 'History',
    areaHistoryDescription: 'Past seasons, champions and all-time records.',
    areaHistoryLink: 'Open history',
    areaAnnouncementsLabel: 'Announcements',
    areaAnnouncementsDescription: 'League chat — where rulings and reminders are posted.',
    areaIntelligenceLabel: 'Commissioner intelligence',
    areaIntelligenceDescription: 'League and manager health, rivalries, the audit log and the intelligence modules.',
    areaIntelligenceLink: 'Open intelligence',

    // ── shared links (areas, workflows, communities) ──
    openLeagueChat: 'Open league chat',
    openDraftHq: 'Open Draft HQ',
    openTrades: 'Open trades',

    // ── buildWorkflows ──
    wfOpenLeagueSettings: 'Open league settings',
    wfResync: 'Re-sync this league',
    wfPlatformStepTitle: (pl: string) => `Make the change on ${pl}`,
    /** Trimmed by the caller, as before: with a link the trailing sentence is empty. */
    wfPlatformStepBody: (pl: string, what: string, hasLink: boolean) =>
      `${pl} is this league’s system of record, so ${what} happens there. ${
        hasLink ? '' : `Open the league in ${pl} and use its commissioner tools.`
      }`,
    wfSeeCurrentRules: 'See current rules',
    wfTellLeagueTitle: 'Tell the league',
    wfTellLeagueBody: 'Post who is taking over, so nobody is surprised by a new name in the standings.',

    wfReplaceTitle: 'Replace a manager',
    wfReplaceSummary: 'Find the team nobody is running, hand it to someone new, and tell the league.',
    wfReplaceQuietTitle: 'Confirm who has gone quiet',
    wfReplaceQuietBody: 'Member activity below lists every manager with no owner or no move in 14 days.',
    wfReplaceQuietLink: 'See member activity',
    wfReplaceOpenTeamTitle: 'Open the team up',
    wfReplaceOpenTeamBody: 'Orphan teams lists ownerless teams and lets you advertise one or hand it to an AI manager for now.',
    wfReplaceOpenTeamLink: 'Open orphan teams',
    wfReplaceInviteTitle: 'Invite the replacement',
    wfReplaceInviteBody: 'Send your league’s invite link. The new manager joins and takes over the open team.',
    wfReplacePlatformWhat: 'changing a team’s owner',
    wfReplaceResyncTitle: 'Re-sync so AllFantasy sees the new owner',
    wfReplaceResyncBody: 'Until the next sync, AllFantasy still shows the old manager on that team.',
    wfReplaceClaimTitle: 'Invite them to claim the team here',
    wfReplaceClaimBody: 'Your league’s invite link lets the new manager connect the team to their AllFantasy account.',

    wfPollTitle: 'Put it to a vote',
    wfPollBody: 'Post a poll in league chat and give it a deadline — open votes show on this page and in the calendar until they close.',

    wfRuleTitle: 'Change a rule',
    wfRuleSummary: 'Check what the league runs on today, get the league’s agreement, apply it, and record it.',
    wfRuleCheckTitle: 'Check the current rule',
    wfRuleCheckBody: '“How this league runs” below shows the trade deadline, playoffs and waivers as they stand.',
    wfRuleApplyTitle: 'Apply it in settings',
    wfRuleApplyBody: 'Every saved change is written to the league’s audit log and appears in the timeline on this page.',
    wfRulePlatformWhat: 'changing a rule',
    wfRuleResyncTitle: 'Re-sync so the change shows here',
    wfRuleResyncBody: 'AllFantasy reads the new rule on the next sync.',
    wfRuleAnnounceTitle: 'Announce the change',
    wfRuleAnnounceBody: 'Say what changed and from which week, in league chat, so the ruling is on the record.',

    wfDraftTitle: 'Schedule a draft',
    wfDraftSummary: 'Pick a time that works, set it, and make sure every manager has it.',
    wfDraftAuthorityNote: (pl: string) => `${pl} runs this league’s draft, so the date is set there.`,
    wfDraftFindTimeTitle: 'Find a time that works',
    wfDraftFindTimeBody: 'Post a poll with two or three options and a deadline a few days out.',
    wfDraftSetDateTitle: 'Set the draft date',
    wfDraftSetDateBody:
      'Draft settings hold the date, draft type, pick timer and order. Once saved, it appears in this page’s calendar and calendar export.',
    wfDraftPlatformWhat: 'setting the draft date',
    wfDraftOrderTitle: 'Lock in the draft order',
    wfDraftOrderBody: 'Randomize or set the order in draft settings before draft day.',
    wfDraftFollowTitle: 'Follow it from Draft HQ',
    wfDraftFollowBody: 'Draft HQ picks the draft up from the platform once it starts.',
    wfDraftAnnounceTitle: 'Announce the date',
    wfDraftAnnounceNativeBody: 'Post it in league chat. Managers can also add it to their calendars from the export on this page.',
    wfDraftAnnounceImportedBody: 'Post the date and time in league chat, with the time zone.',

    wfDisputeTitle: 'Resolve a dispute',
    wfDisputeSummary: 'Get the facts, check the rule, rule on it, and put the ruling on the record.',
    wfDisputeFactsTitle: 'Get the facts',
    wfDisputeFactsBody:
      'The trade or move in question, its date and who was involved — the Trades screen and the timeline on this page have both.',
    wfDisputeRuleTitle: 'Check the rule',
    wfDisputeRuleBody: 'Read what the league actually runs on before ruling, so the decision rests on the rule and not on memory.',
    wfDisputeReviewTitle: 'Review it in the league',
    wfDisputeReviewBody: 'Pending trades can be approved or vetoed from the league’s Trades tab.',
    wfDisputeReviewLink: 'Open trade review',
    wfDisputePlatformWhat: 'vetoing or reversing a move',
    wfDisputeJudgmentTitle: 'If it’s a judgment call, let the league decide',
    wfDisputeJudgmentBody: 'A poll with a deadline keeps the ruling from being yours alone.',
    wfDisputePostTitle: 'Post the ruling',
    wfDisputePostBody: 'State the decision and the rule behind it in league chat — that post is the league’s record of it.',

    // ── buildCommunities ──
    commDiscordConnectedDetail: (channelName: string | null, guildName: string | null) =>
      `League chat relays to ${channelName ? `#${channelName}` : 'a channel'}${guildName ? ` in ${guildName}` : ''}.`,
    commDiscordManage: 'Manage the bridge',
    commDiscordAvailableDetail: 'Relay league chat to your Discord server, both ways.',
    commDiscordUnavailableDetail: 'Not connected. Only the league owner can connect Discord.',
    commDiscordConnect: 'Connect Discord',
    commAnnouncementsLabel: 'Email & announcements',
    commAnnouncementsReach: (claimed: number, total: number) =>
      `A league-chat post reaches the ${claimed} of ${total} managers with AllFantasy accounts, by in-app, email or text as each has chosen.`,
    commAnnouncementsBroadcast: ' An @everyone announcement notifies all of them at once.',
    commAnnouncementsNobody:
      'No manager has connected an AllFantasy account yet, so there is nobody to email. Invite managers to claim their teams.',
    commCalendarLabel: 'Calendar',
    commCalendarDownload: (n: number) =>
      `Download the league’s ${n} dated ${n === 1 ? 'event' : 'events'} as a calendar file for Google, Apple or Outlook.`,
    commCalendarEmpty: 'Nothing on this league’s calendar has a date yet, so there is nothing to export.',
    commPaymentLabel: 'Payment link',
    commPaymentCollected: (provider: string) => `Dues are collected through ${provider}.`,
    commPaymentOpen: (provider: string) => `Open ${provider}`,
    commPaymentFallbackProvider: 'the league’s payment link',
    commPaymentTrackedNoLink: 'Dues are tracked, but no payment link is set. Add a LeagueSafe or FanCred link in the dues tracker.',
    commPaymentUntracked: 'Track dues and add a LeagueSafe or FanCred link in the league’s dues tracker.',
    commPaymentOpenTracker: 'Open dues tracker',
    commPlatformNativeLabel: 'Source platform',
    commPlatformNativeDetail: 'This league runs on AllFantasy — there is no other platform to keep in step.',
    commPlatformLinkedDetail: (pl: string) =>
      `Rules, rosters and rulings are applied on ${pl}. AllFantasy re-reads the league on every sync.`,
    commPlatformUnlinkedDetail: (pl: string) =>
      `Rules, rosters and rulings are applied on ${pl}. A direct link to this league on ${pl} isn’t verified yet.`,
  },
  es: {
    // ── buildLeagueAreas ──
    areaReadNote: (pl: string) => `Datos leídos de ${pl}. Los cambios se hacen allí.`,
    areaOverviewLabel: 'Resumen',
    areaOverviewDescription: 'La clasificación de un vistazo, esta semana y lo que cambió.',
    areaOverviewLink: 'Abrir el resumen',
    areaSettingsLabel: 'Configuración',
    areaSettingsDescription: 'Puntuación, plantillas, agentes libres, intercambios, draft y playoffs.',
    areaSettingsLink: 'Abrir la configuración',
    areaSettingsNote: (pl: string) => `Aquí es un resumen de solo lectura. Las reglas se cambian en ${pl}.`,
    areaMembersLabel: 'Miembros',
    areaMembersDescription: 'Quién dirige cada equipo, invitaciones y cocomisionados.',
    areaMembersLink: 'Gestionar miembros',
    areaMembersNote: (pl: string) =>
      `La propiedad de los equipos se fija en ${pl}. AllFantasy gestiona aquí las invitaciones para reclamar un equipo.`,
    areaStandingsLabel: 'Clasificación',
    areaStandingsDescription: 'Récords, puntos y panorama de playoffs.',
    areaStandingsLink: 'Abrir la clasificación',
    areaScheduleLabel: 'Calendario de partidos',
    areaScheduleDescription: 'Los enfrentamientos de cada semana.',
    areaScheduleLink: 'Abrir el calendario de partidos',
    areaDraftsLabel: 'Drafts',
    areaDraftsDescription: 'Tablero, orden y resultados del draft.',
    areaDraftsNote: (pl: string) => `El draft en sí se hace en ${pl}; Draft HQ lo sigue.`,
    areaTradesLabel: 'Intercambios',
    areaTradesDescription: 'Ofertas, intercambios cerrados y revisión.',
    areaTradesNote: (pl: string) => `Los intercambios se aceptan y se vetan en ${pl}.`,
    areaWaiversLabel: 'Agentes libres',
    areaWaiversDescription: 'Reclamos, FAAB y el último proceso.',
    areaWaiversLink: 'Abrir agentes libres',
    areaWaiversNote: (pl: string) => `Los reclamos se procesan en ${pl}.`,
    areaHistoryLabel: 'Historial',
    areaHistoryDescription: 'Temporadas pasadas, campeones y récords históricos.',
    areaHistoryLink: 'Abrir el historial',
    areaAnnouncementsLabel: 'Anuncios',
    areaAnnouncementsDescription: 'El chat de la liga, donde se publican decisiones y recordatorios.',
    areaIntelligenceLabel: 'Inteligencia del comisionado',
    areaIntelligenceDescription:
      'Salud de la liga y de los mánagers, rivalidades, el registro de cambios y los módulos de inteligencia.',
    areaIntelligenceLink: 'Abrir inteligencia',

    // ── shared links (areas, workflows, communities) ──
    openLeagueChat: 'Abrir el chat de la liga',
    openDraftHq: 'Abrir Draft HQ',
    openTrades: 'Abrir intercambios',

    // ── buildWorkflows ──
    wfOpenLeagueSettings: 'Abrir la configuración de la liga',
    wfResync: 'Volver a sincronizar esta liga',
    wfPlatformStepTitle: (pl: string) => `Haz el cambio en ${pl}`,
    wfPlatformStepBody: (pl: string, what: string, hasLink: boolean) =>
      `${pl} es el sistema de referencia de esta liga, así que ${what} se hace allí. ${
        hasLink ? '' : `Abre la liga en ${pl} y usa sus herramientas de comisionado.`
      }`,
    wfSeeCurrentRules: 'Ver las reglas actuales',
    wfTellLeagueTitle: 'Avisa a la liga',
    wfTellLeagueBody: 'Publica quién se hace cargo, para que a nadie le sorprenda un nombre nuevo en la clasificación.',

    wfReplaceTitle: 'Reemplazar a un mánager',
    wfReplaceSummary: 'Encuentra el equipo que nadie dirige, entrégaselo a alguien nuevo y avisa a la liga.',
    wfReplaceQuietTitle: 'Confirma quién se ha quedado sin actividad',
    wfReplaceQuietBody: 'La actividad de los miembros, más abajo, lista a cada mánager sin dueño o sin movimientos en 14 días.',
    wfReplaceQuietLink: 'Ver la actividad de los miembros',
    wfReplaceOpenTeamTitle: 'Deja el equipo disponible',
    wfReplaceOpenTeamBody:
      'Equipos huérfanos lista los equipos sin dueño y te permite anunciar uno o dejárselo por ahora a un mánager de IA.',
    wfReplaceOpenTeamLink: 'Abrir equipos huérfanos',
    wfReplaceInviteTitle: 'Invita al reemplazo',
    wfReplaceInviteBody: 'Envía el enlace de invitación de tu liga. El nuevo mánager se une y se hace cargo del equipo disponible.',
    wfReplacePlatformWhat: 'cambiar el dueño de un equipo',
    wfReplaceResyncTitle: 'Vuelve a sincronizar para que AllFantasy vea al nuevo dueño',
    wfReplaceResyncBody: 'Hasta la próxima sincronización, AllFantasy sigue mostrando al mánager anterior en ese equipo.',
    wfReplaceClaimTitle: 'Invítalo a reclamar el equipo aquí',
    wfReplaceClaimBody: 'El enlace de invitación de tu liga permite al nuevo mánager conectar el equipo a su cuenta de AllFantasy.',

    wfPollTitle: 'Sométela a votación',
    wfPollBody:
      'Publica una encuesta en el chat de la liga y ponle una fecha límite: las votaciones abiertas aparecen en esta página y en el calendario hasta que cierran.',

    wfRuleTitle: 'Cambiar una regla',
    wfRuleSummary: 'Comprueba cómo funciona hoy la liga, consigue el acuerdo de la liga, aplícalo y déjalo registrado.',
    wfRuleCheckTitle: 'Revisa la regla actual',
    wfRuleCheckBody:
      '«Cómo funciona esta liga», más abajo, muestra la fecha límite de intercambios, los playoffs y los agentes libres tal como están.',
    wfRuleApplyTitle: 'Aplícalo en la configuración',
    wfRuleApplyBody:
      'Cada cambio guardado se escribe en el registro de cambios de la liga y aparece en la línea de tiempo de esta página.',
    wfRulePlatformWhat: 'cambiar una regla',
    wfRuleResyncTitle: 'Vuelve a sincronizar para que el cambio aparezca aquí',
    wfRuleResyncBody: 'AllFantasy lee la nueva regla en la próxima sincronización.',
    wfRuleAnnounceTitle: 'Anuncia el cambio',
    wfRuleAnnounceBody: 'Di en el chat de la liga qué cambió y desde qué semana, para que la decisión quede registrada.',

    wfDraftTitle: 'Programar un draft',
    wfDraftSummary: 'Elige una hora que funcione, fíjala y asegúrate de que todos los mánagers la tengan.',
    wfDraftAuthorityNote: (pl: string) => `${pl} lleva el draft de esta liga, así que la fecha se fija allí.`,
    wfDraftFindTimeTitle: 'Encuentra una hora que funcione',
    wfDraftFindTimeBody: 'Publica una encuesta con dos o tres opciones y una fecha límite a unos días vista.',
    wfDraftSetDateTitle: 'Fija la fecha del draft',
    wfDraftSetDateBody:
      'La configuración del draft guarda la fecha, el tipo de draft, el tiempo por selección y el orden. Una vez guardada, aparece en el calendario de esta página y en su exportación.',
    wfDraftPlatformWhat: 'fijar la fecha del draft',
    wfDraftOrderTitle: 'Cierra el orden del draft',
    wfDraftOrderBody: 'Sortea o fija el orden en la configuración del draft antes del día del draft.',
    wfDraftFollowTitle: 'Síguelo desde Draft HQ',
    wfDraftFollowBody: 'Draft HQ recoge el draft de la plataforma en cuanto empieza.',
    wfDraftAnnounceTitle: 'Anuncia la fecha',
    wfDraftAnnounceNativeBody:
      'Publícala en el chat de la liga. Los mánagers también pueden añadirla a sus calendarios desde la exportación de esta página.',
    wfDraftAnnounceImportedBody: 'Publica la fecha y la hora en el chat de la liga, con la zona horaria.',

    wfDisputeTitle: 'Resolver una disputa',
    wfDisputeSummary: 'Reúne los hechos, revisa la regla, decide y deja la decisión registrada.',
    wfDisputeFactsTitle: 'Reúne los hechos',
    wfDisputeFactsBody:
      'El intercambio o movimiento en cuestión, su fecha y quiénes participaron: la pantalla de Intercambios y la línea de tiempo de esta página tienen ambos datos.',
    wfDisputeRuleTitle: 'Revisa la regla',
    wfDisputeRuleBody:
      'Lee cómo funciona realmente la liga antes de decidir, para que la decisión se base en la regla y no en la memoria.',
    wfDisputeReviewTitle: 'Revísalo en la liga',
    wfDisputeReviewBody: 'Los intercambios pendientes se pueden aprobar o vetar desde la pestaña Intercambios de la liga.',
    wfDisputeReviewLink: 'Abrir la revisión de intercambios',
    wfDisputePlatformWhat: 'vetar o revertir un movimiento',
    wfDisputeJudgmentTitle: 'Si es una cuestión de criterio, deja que decida la liga',
    wfDisputeJudgmentBody: 'Una encuesta con fecha límite evita que la decisión sea solo tuya.',
    wfDisputePostTitle: 'Publica la decisión',
    wfDisputePostBody:
      'Explica la decisión y la regla en la que se basa en el chat de la liga: esa publicación es el registro de la liga.',

    // ── buildCommunities ──
    commDiscordConnectedDetail: (channelName: string | null, guildName: string | null) =>
      `El chat de la liga se conecta con ${channelName ? `#${channelName}` : 'un canal'}${guildName ? ` en ${guildName}` : ''}.`,
    commDiscordManage: 'Gestionar la conexión',
    commDiscordAvailableDetail: 'Conecta el chat de la liga con tu servidor de Discord, en ambos sentidos.',
    commDiscordUnavailableDetail: 'Sin conectar. Solo el dueño de la liga puede conectar Discord.',
    commDiscordConnect: 'Conectar Discord',
    commAnnouncementsLabel: 'Correo y anuncios',
    commAnnouncementsReach: (claimed: number, total: number) =>
      `Una publicación en el chat de la liga llega a los ${claimed} de ${total} mánagers con cuenta de AllFantasy, por la app, correo o mensaje de texto, según haya elegido cada uno.`,
    commAnnouncementsBroadcast: ' Un anuncio a @everyone los avisa a todos a la vez.',
    commAnnouncementsNobody:
      'Ningún mánager ha conectado todavía una cuenta de AllFantasy, así que no hay a quién escribir. Invita a los mánagers a reclamar sus equipos.',
    commCalendarLabel: 'Calendario',
    commCalendarDownload: (n: number) =>
      `Descarga ${n === 1 ? 'el evento con fecha' : `los ${n} eventos con fecha`} de la liga como archivo de calendario para Google, Apple u Outlook.`,
    commCalendarEmpty: 'Nada en el calendario de esta liga tiene fecha todavía, así que no hay nada que exportar.',
    commPaymentLabel: 'Enlace de pago',
    commPaymentCollected: (provider: string) => `Las cuotas se cobran a través de ${provider}.`,
    commPaymentOpen: (provider: string) => `Abrir ${provider}`,
    commPaymentFallbackProvider: 'el enlace de pago de la liga',
    commPaymentTrackedNoLink:
      'Las cuotas se registran, pero no hay enlace de pago. Añade un enlace de LeagueSafe o FanCred en el control de cuotas.',
    commPaymentUntracked: 'Registra las cuotas y añade un enlace de LeagueSafe o FanCred en el control de cuotas de la liga.',
    commPaymentOpenTracker: 'Abrir el control de cuotas',
    commPlatformNativeLabel: 'Plataforma de origen',
    commPlatformNativeDetail: 'Esta liga funciona en AllFantasy: no hay otra plataforma con la que sincronizarse.',
    commPlatformLinkedDetail: (pl: string) =>
      `Las reglas, las plantillas y las decisiones se aplican en ${pl}. AllFantasy vuelve a leer la liga en cada sincronización.`,
    commPlatformUnlinkedDetail: (pl: string) =>
      `Las reglas, las plantillas y las decisiones se aplican en ${pl}. Aún no está verificado un enlace directo a esta liga en ${pl}.`,
  },
})
