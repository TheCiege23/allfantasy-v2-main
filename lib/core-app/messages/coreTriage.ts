import { defineMessages } from '@/lib/i18n/messages'

/**
 * Small /core triage and shell components, one catalog: Player Finder's lineup links
 * (player-finder/TriageLineupLinks.tsx) and lock clock (player-finder/LockClock.tsx), the triage
 * best-add button (screens/TriageBestAdd.tsx), the commissioner weekly plan
 * (CommissionerWeeklyPlan.tsx), InfoTip, LeagueSwipe, LineupVerification, the player-card highlights
 * (player-card/PlayerHighlights.tsx) and the draft history review (screens/DraftHistoryReview.tsx).
 * Every string is the one the component printed before the move, byte for byte, in both languages —
 * this is a relocation, not a rewrite.
 */
export const coreTriageMessages = defineMessages({
  en: {
    // TriageLineupLinks
    triageLinksAria: (playerName: string) => `Open ${playerName}'s lineups`,
    /** `lands` is the English landing screen; `landsEs` the Spanish one. Each language picks its own. */
    triageLinksOpen: (done: boolean, league: string, lands: string, _landsEs: string, platform: string) =>
      `${done ? 'Opened: ' : ''}${league} — open the ${lands} on ${platform}`,
    triageLinksLands: (lands: string, _landsEs: string): string => lands,

    // TriageBestAdd
    bestAddSearch: (leagueName: string) => `Find free agents in ${leagueName}`,
    bestAddNone: (leagueName: string) => `No free agent beats your lineup in ${leagueName}`,
    bestAddAdd: (name: string, detail: string, leagueName: string) => `Add ${name} (${detail}) in ${leagueName}`,

    // CommissionerWeeklyPlan
    weeklyPlanTaskSaved: 'Task saved in the Commissioner Hub.',
    weeklyPlanTaskUnconfirmed: 'Task could not be confirmed. Retry the same task or refresh the queue.',
    weeklyPlanCopied: 'Copied.',
    weeklyPlanCopyManually: 'Select the announcement text and copy it.',
    weeklyPlanPollInvalid: 'Add a question, 2–6 distinct options and a future closing time.',
    weeklyPlanDraftOpened: 'Draft opened in league chat. Review it and press Send when ready.',
    weeklyPlanAria: 'Commissioner weekly workspace',
    weeklyPlanTitle: 'Turn this week into league action',
    weeklyPlanIntro: 'Review the evidence, save a task, or prepare an editable league message. Tasks are audited. Drafts open unsent.',
    weeklyPlanSaveSummary: 'Save a reviewed weekly task',
    weeklyPlanStartFromIssue: 'Start from a weekly issue',
    weeklyPlanChooseIssue: 'Choose an issue or write your own',
    weeklyPlanTaskTitle: 'Task title',
    weeklyPlanReviewedDetails: 'Reviewed details',
    weeklyPlanDueTime: 'Due time (your device time zone, optional)',
    weeklyPlanSaving: 'Saving…',
    weeklyPlanSaveTask: 'Save task',
    weeklyPlanAnnouncementSummary: 'Prepare an announcement',
    weeklyPlanAnnouncementDraft: 'Announcement draft',
    weeklyPlanCopyAnnouncement: 'Copy announcement',
    weeklyPlanReviewInChat: 'Review in league chat',
    weeklyPlanPollSummary: 'Prepare a league poll',
    weeklyPlanPollQuestion: 'Poll question',
    weeklyPlanPollOptions: 'Options (one per line, 2–6)',
    weeklyPlanPollClose: 'Close voting (your device time zone)',
    weeklyPlanReviewPoll: 'Review poll in league chat',
    weeklyPlanHubLink: 'Commissioner Hub and task queue',

    // InfoTip
    infoTipClose: 'Close',

    // LeagueSwipe
    swipeAria: 'Switch league',

    // LineupVerification
    verifySection: 'Lineup verification',
    verifyWeek: 'Week',
    verifyChecked: 'Lineup checked',
    verifyStale: ' · Refresh before making a lineup decision.',
    verifyFresh: ' · Starter, bench, IR and taxi placement verified.',
    verifyNone: 'Lineup could not be verified. Lineup advice is paused until a successful refresh.',
    verifyNote: 'This checks lineup placement. Injury news and projections may update separately.',
    verifyChecking: 'Checking Sleeper…',
    verifyRefresh: 'Refresh lineup',

    // PlayerHighlights
    highlightsAria: (name: string) => `${name} highlights`,
    highlightsNote: (name: string) => `Recent official NFL uploads. Team recaps may not feature ${name}.`,

    // LockClock
    lockClockLocked: 'locked',
    /** `clock` is the localized kickoff clock; `rawClock` the lock state's own. */
    lockClockLockedTitle: (_clock: string, rawClock: string) => `Locked · kicked off ${rawClock}`,
    lockClockLocksTitle: (_clock: string, rawClock: string) => `Lineup locks at his kickoff · ${rawClock}`,

    // DraftHistoryReview
    draftReviewVerified: (count: number) => `${count} historical picks verified. Review again for remaining records.`,
    draftReviewUnavailable: 'Review unavailable or records changed. Retry; no source is guessed. Commissioners only.',
    draftReviewSummary: 'Commissioner: verify historical source',
    draftReviewTipLabel: 'About source verification',
    draftReviewTipTitle: 'Historical verification',
    draftReviewTipBody:
      'Choose a source you can independently confirm. Only exact season, round, overall pick and player-ID matches are attached, at most 50 per review. Raw selections are preserved. The actor, reason and before/after metadata are audited privately. Unmatched facts remain unresolved.',
    draftReviewWarning: 'Different drafts can contain identical selections. Confirm the original draft before applying a source.',
    draftReviewLoad: 'Load verified league sources / retry provider',
    draftReviewSourceDraft: 'Source draft',
    draftReviewChooseSource: 'Choose a source',
    draftReviewPreview: 'Preview exact matches',
    draftReviewUnresolved: 'unresolved picks in this batch. Preview IDs:',
    draftReviewEvidence: 'Evidence / reason (10–500 characters)',
    draftReviewConfirm: 'Confirm this source and preserve audit',
    draftReviewReading: 'Reading historical source…',
  },
  es: {
    triageLinksAria: (playerName) => `Abrir las alineaciones de ${playerName}`,
    triageLinksOpen: (done, league, _lands, landsEs, platform) => `${done ? 'Abierta: ' : ''}${league}: abrir ${landsEs} en ${platform}`,
    triageLinksLands: (_lands, landsEs) => landsEs,

    bestAddSearch: (leagueName) => `Buscar agentes libres en ${leagueName}`,
    bestAddNone: (leagueName) => `Ningún agente libre mejora tu alineación en ${leagueName}`,
    bestAddAdd: (name, detail, leagueName) => `Añadir a ${name} (${detail}) en ${leagueName}`,

    weeklyPlanTaskSaved: 'Tarea guardada en el Centro del comisionado.',
    weeklyPlanTaskUnconfirmed: 'No se pudo confirmar la tarea. Reintenta la misma tarea o actualiza la cola.',
    weeklyPlanCopied: 'Copiado.',
    weeklyPlanCopyManually: 'Selecciona el texto del anuncio y cópialo.',
    weeklyPlanPollInvalid: 'Añade una pregunta, 2–6 opciones distintas y una hora de cierre futura.',
    weeklyPlanDraftOpened: 'Borrador abierto en el chat de liga. Revísalo y pulsa Enviar cuando esté listo.',
    weeklyPlanAria: 'Espacio semanal del comisionado',
    weeklyPlanTitle: 'Convierte esta semana en acciones de liga',
    weeklyPlanIntro:
      'Revisa los datos, guarda una tarea o prepara un mensaje editable para la liga. Las tareas se registran. Los borradores se abren sin enviar.',
    weeklyPlanSaveSummary: 'Guardar una tarea semanal revisada',
    weeklyPlanStartFromIssue: 'Empezar con un asunto semanal',
    weeklyPlanChooseIssue: 'Elige un asunto o escribe el tuyo',
    weeklyPlanTaskTitle: 'Título de tarea',
    weeklyPlanReviewedDetails: 'Detalles revisados',
    weeklyPlanDueTime: 'Plazo (zona horaria del dispositivo, opcional)',
    weeklyPlanSaving: 'Guardando…',
    weeklyPlanSaveTask: 'Guardar tarea',
    weeklyPlanAnnouncementSummary: 'Preparar un anuncio',
    weeklyPlanAnnouncementDraft: 'Borrador del anuncio',
    weeklyPlanCopyAnnouncement: 'Copiar anuncio',
    weeklyPlanReviewInChat: 'Revisar en chat de liga',
    weeklyPlanPollSummary: 'Preparar una encuesta de liga',
    weeklyPlanPollQuestion: 'Pregunta de encuesta',
    weeklyPlanPollOptions: 'Opciones (una por línea, 2–6)',
    weeklyPlanPollClose: 'Cerrar votación (zona horaria del dispositivo)',
    weeklyPlanReviewPoll: 'Revisar encuesta en chat de liga',
    weeklyPlanHubLink: 'Centro del comisionado y cola de tareas',

    infoTipClose: 'Cerrar',

    swipeAria: 'Cambiar de liga',

    verifySection: 'Verificación de la alineación',
    verifyWeek: 'Semana',
    verifyChecked: 'Alineación revisada',
    verifyStale: ' · Actualiza antes de decidir la alineación.',
    verifyFresh: ' · Titulares, banquillo, IR y taxi verificados.',
    verifyNone: 'No se pudo verificar la alineación. Los consejos de alineación quedan en pausa hasta una actualización correcta.',
    verifyNote: 'Esto revisa dónde está cada jugador en la alineación. Las noticias de lesiones y las proyecciones pueden actualizarse por separado.',
    verifyChecking: 'Revisando Sleeper…',
    verifyRefresh: 'Actualizar alineación',

    highlightsAria: (name) => `Videos de ${name}`,
    highlightsNote: (name) => `Publicaciones recientes del canal oficial de la NFL. Los resúmenes de equipo pueden no mostrar a ${name}.`,

    lockClockLocked: 'bloqueado',
    lockClockLockedTitle: (clock) => `Bloqueado · empezó ${clock}`,
    lockClockLocksTitle: (clock) => `La alineación se bloquea en su inicio · ${clock}`,

    draftReviewVerified: (count) => `${count} selecciones verificadas. Revisa los registros restantes.`,
    draftReviewUnavailable: 'Revisión no disponible o registros cambiados. Vuelve a intentar; no se adivina el origen. Solo comisionados.',
    draftReviewSummary: 'Comisionado: verificar origen histórico',
    draftReviewTipLabel: 'Acerca de la verificación',
    draftReviewTipTitle: 'Verificación histórica',
    draftReviewTipBody:
      'Elige un origen que puedas confirmar. Solo se vinculan coincidencias exactas de temporada, ronda, selección e ID, hasta 50 por revisión. Las selecciones se conservan. Actor, motivo y metadatos se auditan en privado. Las discrepancias siguen sin resolver.',
    draftReviewWarning: 'Distintos drafts pueden contener selecciones idénticas. Confirma el draft original antes de vincularlo.',
    draftReviewLoad: 'Cargar orígenes / reintentar proveedor',
    draftReviewSourceDraft: 'Draft de origen',
    draftReviewChooseSource: 'Elige un origen',
    draftReviewPreview: 'Vista previa de coincidencias',
    draftReviewUnresolved: 'selecciones sin resolver en este lote. IDs:',
    draftReviewEvidence: 'Evidencia / motivo (10–500 caracteres)',
    draftReviewConfirm: 'Confirmar origen y conservar auditoría',
    draftReviewReading: 'Consultando origen histórico…',
  },
})
