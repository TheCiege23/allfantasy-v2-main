/**
 * Spanish for the one-league Commissioner Hub's own words (2026-10-05).
 *
 * `/core/commissioner?league=…` is a SERVER screen (`components/core-app/screens/CommissionerHub.tsx`)
 * with client islands, and none of it read the language: every label, note and button was English
 * whatever the reader chose. The page now resolves the language for this screen and the hub words
 * itself through `hubCopy`; the client islands do the same with the provider's language.
 *
 * This covers the hub's OWN copy — headings, notes, buttons, filters, confirmations, errors. Text the
 * server composes from league data (tile labels and reasons, task cards, health flags, calendar
 * events, league areas, guides, the audit log) is routed through `hubCopy` too, so it passes through
 * unchanged until its entries are added here.
 *
 * `__tests__/core-app/commissioner-hub-copy.test.tsx` parses every hub component and fails on raw
 * English in JSX, and on any prose literal without Spanish. PURE and client-safe: no imports.
 */

const ES: Record<string, string> = {
  // ── Header, gate, footer ──────────────────────────────────────────────
  '← All leagues you run': '← Todas las ligas que diriges',
  'Core · Commissioner': 'Core · Comisionado',
  Commissioner: 'Comisionado',
  'Co-commissioner': 'Cocomisionado',
  'Commissioners and co-commissioners only': 'Solo para comisionados y cocomisionados',
  'Everything it takes to run this league: what needs you, league health, the calendar, guides for the hard jobs, and a record of every change.':
    'Todo lo que hace falta para dirigir esta liga: lo que necesita de ti, la salud de la liga, el calendario, guías para las tareas difíciles y un registro de cada cambio.',
  'Send @everyone': 'Enviar @everyone',
  'Multi-league tournaments and weekly reports →': 'Torneos entre ligas e informes semanales →',
  'This league right now': 'Esta liga ahora mismo',
  'Gone quiet:': 'Sin actividad:',
  'Member activity': 'Actividad de los miembros',
  '1 team isn’t connected to an AllFantasy account yet.': '1 equipo aún no está conectado a una cuenta de AllFantasy.',
  'Invite managers': 'Invitar mánagers',
  'Not measured yet': 'Aún sin medir',
  'This league has never synced, so nothing below has been checked. An empty task list here means we have not looked — not that the league is quiet.':
    'Esta liga nunca se ha sincronizado, así que nada de lo que sigue se ha revisado. Una lista de tareas vacía aquí significa que no hemos mirado, no que la liga esté tranquila.',
  'This league runs on AllFantasy, so settings and rulings saved here are the league’s own.':
    'Esta liga funciona en AllFantasy, así que la configuración y las decisiones que se guardan aquí son las de la liga.',
  'Health trends, manager intelligence and reports are in Commissioner OS.':
    'Las tendencias de salud, la información de los mánagers y los informes están en Commissioner OS.',
  'Open league chat →': 'Abrir el chat de la liga →',
  'Health trends in Commissioner OS →': 'Tendencias de salud en Commissioner OS →',

  // ── Section titles and the nav ────────────────────────────────────────
  'Commissioner hub sections': 'Secciones del centro del comisionado',
  Tasks: 'Tareas',
  Intelligence: 'Inteligencia',
  'Format operations': 'Operaciones del formato',
  'Trades & drafts': 'Intercambios y drafts',
  Health: 'Salud',
  Calendar: 'Calendario',
  Guides: 'Guías',
  'League areas': 'Áreas de la liga',
  Lineups: 'Alineaciones',
  Charts: 'Gráficos',
  Automations: 'Automatizaciones',
  Connections: 'Conexiones',
  'Audit log': 'Registro de cambios',
  'Commissioner intelligence': 'Inteligencia del comisionado',
  'Trades and draft archive': 'Intercambios y archivo de drafts',
  'Step-by-step guides': 'Guías paso a paso',
  'This week’s lineups, projected': 'Alineaciones proyectadas de esta semana',
  'nothing here changes a standing or a ruling.': 'nada de esto cambia una clasificación ni una decisión.',
  'Waiver oversight': 'Supervisión de agentes libres',
  'How this league runs': 'Cómo funciona esta liga',
  'Who can run this league': 'Quién puede dirigir esta liga',
  'League charts': 'Gráficos de la liga',
  'Public standings': 'Clasificación pública',
  'The full audit log': 'El registro completo de cambios',

  // ── Tasks ─────────────────────────────────────────────────────────────
  'Needs you now': 'Te necesita ahora',
  'Most urgent first': 'Lo más urgente primero',
  'Nothing outstanding': 'Nada pendiente',
  '1 more task': '1 tarea más',
  League: 'Liga',
  Deadline: 'Fecha límite',
  'Check-up': 'Chequeo',
  Review: 'Revisión',

  // ── Format operations, trades, drafts ─────────────────────────────────
  'Network:': 'Red:',
  'No specialty mechanics were resolved for this league. Review league settings before applying format-specific rules.':
    'No se identificó ninguna mecánica especial para esta liga. Revisa la configuración antes de aplicar reglas propias de un formato.',
  'Latest trades': 'Últimos intercambios',
  'No trade records on file.': 'No hay intercambios registrados.',
  'Trade history unavailable.': 'El historial de intercambios no está disponible.',
  'Draft archive': 'Archivo de drafts',
  'Season unknown': 'Temporada desconocida',
  ' (year inferred)': ' (año deducido)',
  '1 pick': '1 selección',
  'Correction:': 'Corrección:',
  'No draft sessions on file.': 'No hay drafts registrados.',
  'Draft history unavailable.': 'El historial de drafts no está disponible.',

  // ── Rules and access ──────────────────────────────────────────────────
  Disputes: 'Disputas',
  'Open integrity monitor →': 'Abrir el monitor de integridad →',
  '1 person': '1 persona',
  you: 'tú',
  'Here on AllFantasy': 'Aquí en AllFantasy',
  'No commissioner is recorded on this league’s ingested teams. That is a gap in what the platform published, not a league without one.':
    'No hay ningún comisionado registrado en los equipos importados de esta liga. Es un hueco en lo que publicó la plataforma, no una liga sin comisionado.',
  'As a co-commissioner you can act on everything above, including @everyone announcements. You cannot transfer commissionership or remove the primary commissioner, and connecting Discord is left to the league owner.':
    'Como cocomisionado puedes actuar sobre todo lo anterior, incluidos los anuncios a @everyone. No puedes transferir el cargo de comisionado ni quitar al comisionado principal, y conectar Discord queda en manos del dueño de la liga.',

  // ── Public standings ──────────────────────────────────────────────────
  Published: 'Publicada',
  Private: 'Privada',
  'This league’s standings are readable by anyone with the link, without an account, and search engines are allowed to index them. Team names are published; manager names are not.':
    'Cualquiera con el enlace puede ver la clasificación de esta liga sin una cuenta, y los buscadores pueden indexarla. Se publican los nombres de los equipos, no los de los mánagers.',
  'Off. Turning this on gives this league a public page at': 'Desactivada. Al activarla, esta liga tendrá una página pública en',
  '— readable without an account and indexable by search engines. It publishes the league name, team names, records and points. It does not publish manager names.':
    ': visible sin una cuenta e indexable por los buscadores. Publica el nombre de la liga, los nombres de los equipos, los récords y los puntos. No publica los nombres de los mánagers.',
  'Making private…': 'Haciéndola privada…',
  'Make private': 'Hacer privada',
  'Publish standings': 'Publicar la clasificación',
  'Publish this league’s standings?': '¿Publicar la clasificación de esta liga?',
  'Published: league name, team names, records, points': 'Se publica: nombre de la liga, nombres de los equipos, récords y puntos',
  'Not published: manager names, rosters, trades, chat': 'No se publica: nombres de los mánagers, plantillas, intercambios ni chat',
  'Anyone with the link can read it without an account, and search engines may index it':
    'Cualquiera con el enlace puede verla sin una cuenta, y los buscadores pueden indexarla',
  'Publishing…': 'Publicando…',
  'Yes, publish': 'Sí, publicar',

  // ── Health ────────────────────────────────────────────────────────────
  'Not measured': 'Sin medir',
  'League health': 'Salud de la liga',

  // ── Calendar ──────────────────────────────────────────────────────────
  'League calendar': 'Calendario de la liga',
  'Nothing on this league’s calendar has a date or a week yet.': 'Nada en el calendario de esta liga tiene aún fecha ni semana.',
  'Not on the calendar': 'Fuera del calendario',
  'This week': 'Esta semana',
  'Coming up': 'Próximamente',
  'No date': 'Sin fecha',
  Passed: 'Pasado',
  'Add to calendar (.ics)': 'Añadir al calendario (.ics)',

  // ── League areas, connections ─────────────────────────────────────────
  'Every part of the league': 'Cada parte de la liga',
  'Runs on AllFantasy': 'Funciona en AllFantasy',
  'Imported · changes are made on the platform': 'Importada · los cambios se hacen en la plataforma',
  Connected: 'Conectado',
  Available: 'Disponible',
  'Not available': 'No disponible',
  'Send an announcement': 'Enviar un anuncio',

  // ── Charts, recent changes, audit log ─────────────────────────────────
  'no moves imported yet': 'aún no hay movimientos importados',
  'League at a glance': 'La liga de un vistazo',
  'There isn’t enough played or imported data to chart yet.': 'Aún no hay suficientes datos jugados o importados para graficar.',
  'Scoring and competitive balance appear once this season has a played week on file.':
    'La puntuación y el equilibrio competitivo aparecen cuando esta temporada tiene una semana jugada registrada.',
  'Manager engagement is left out while the league’s data is out of date.':
    'La participación de los mánagers se omite mientras los datos de la liga estén desactualizados.',
  'Loading…': 'Cargando…',
  'Recent changes': 'Cambios recientes',
  'Full audit log': 'Registro completo',
  'Nothing has been recorded for this league yet.': 'Aún no se ha registrado nada en esta liga.',
  'Nothing has been recorded for this league yet. Imports, syncs, settings changes, announcements and automation runs will appear here as they happen.':
    'Aún no se ha registrado nada en esta liga. Las importaciones, sincronizaciones, cambios de configuración, anuncios y automatizaciones aparecerán aquí a medida que ocurran.',
  'Changes made directly on the league’s platform appear here only as the sync that picked them up.':
    'Los cambios hechos directamente en la plataforma de la liga solo aparecen aquí como la sincronización que los recogió.',
  'Filter the audit log': 'Filtrar el registro de cambios',

  // ── Members ───────────────────────────────────────────────────────────
  'Filter managers': 'Filtrar mánagers',
  All: 'Todos',
  'Needs attention': 'Necesitan atención',
  Active: 'Activo',
  Inactive: 'Inactivo',
  'Slowing down': 'Bajando el ritmo',
  'Can’t tell': 'No se sabe',
  'No managers match this filter.': 'Ningún mánager coincide con este filtro.',

  // ── Automations ───────────────────────────────────────────────────────
  'Your choices are saved now. Reminders, check-ins and announcements start posting once AllFantasy switches automated sending on. Weekly recaps use their own Tuesday schedule when enabled.':
    'Tus elecciones ya se guardaron. Los recordatorios, seguimientos y anuncios empezarán a publicarse cuando AllFantasy active el envío automático. Los resúmenes semanales usan su propio horario de los martes cuando están activados.',
  'Chimmy speaks up in league chat': 'Chimmy participa en el chat de la liga',
  'Chimmy posts the weekly awards and a take on every trade — who won it on paper, with the numbers. Up to four moments a day, plus the weekly awards. Off keeps Chimmy quiet in this league’s chat, the weekly recap included.':
    'Chimmy publica los premios semanales y una opinión sobre cada intercambio: quién lo ganó sobre el papel, con los números. Hasta cuatro momentos al día, más los premios semanales. Desactivado, Chimmy no habla en el chat de esta liga, incluido el resumen semanal.',
  'Posts as Chimmy, with Chimmy’s badge · on by default': 'Publica como Chimmy, con su insignia · activado por defecto',
  on: 'activado',
  off: 'desactivado',
  'posted by Chimmy': 'lo publica Chimmy',
  ' — off while Chimmy is quiet': ' — desactivado mientras Chimmy está en silencio',
  'posts in league chat': 'se publica en el chat de la liga',
  'Every message goes to this league’s chat, where each member gets it by their own notification settings.':
    'Cada mensaje va al chat de esta liga, donde cada miembro lo recibe según su propia configuración de notificaciones.',
  'Could not reach AllFantasy. Nothing was changed.': 'No se pudo conectar con AllFantasy. No se cambió nada.',

  // ── Chimmy ────────────────────────────────────────────────────────────
  unknown: 'desconocido',
  'Ask Chimmy about this league': 'Pregúntale a Chimmy sobre esta liga',
  'Guidance uses the selected league’s evidence. If this league belongs to a network you own, Chimmy also knows its member names. It cannot make rulings or change settings here.':
    'La orientación usa los datos de la liga seleccionada. Si esta liga pertenece a una red tuya, Chimmy también conoce los nombres de sus miembros. No puede tomar decisiones ni cambiar la configuración aquí.',
  Question: 'Pregunta',
  'Asking…': 'Preguntando…',
  'Ask Chimmy': 'Preguntar a Chimmy',
  'Template guidance': 'Orientación de plantilla',
  'AI guidance': 'Orientación de IA',
  'review evidence before acting.': 'revisa los datos antes de actuar.',
  'Chimmy could not answer': 'Chimmy no pudo responder',

  // ── Format template ───────────────────────────────────────────────────
  'Run on AllFantasy as': 'Funciona en AllFantasy como',
  ' — that version is no longer published': ' — esa versión ya no está publicada',
  'Turn off this format’s mechanics for the league?': '¿Desactivar las mecánicas de este formato para la liga?',
  'Removing…': 'Quitando…',
  'Yes, remove': 'Sí, quitar',
  Cancel: 'Cancelar',
  'Remove format': 'Quitar el formato',
  'Apply it to this league? You can remove it later.': '¿Aplicarlo a esta liga? Puedes quitarlo más tarde.',
  'Applying…': 'Aplicando…',
  'Yes, apply': 'Sí, aplicar',
  'Could not reach the server. Nothing was changed.': 'No se pudo conectar con el servidor. No se cambió nada.',

  // ── Guides ────────────────────────────────────────────────────────────
  Back: 'Atrás',
  steps: 'pasos',
  Use: 'Usar',
  Runs: 'Se procesa',
  'Next step': 'Siguiente paso',
  'Start over': 'Empezar de nuevo',

  // ── Waivers ───────────────────────────────────────────────────────────
  'Waiver rules →': 'Reglas de agentes libres →',
  'Last run': 'Último proceso',
  'Run by a commissioner': 'Lo procesó un comisionado',
  Scheduled: 'Programado',
  'This run started and never finished, so some claims were not processed.':
    'Este proceso empezó y nunca terminó, así que algunas solicitudes no se procesaron.',
  'The last run processed no claims.': 'El último proceso no procesó ninguna solicitud.',
  'No waiver run has processed in this league yet.': 'Aún no se ha procesado ninguna ronda de agentes libres en esta liga.',
  'Running…': 'Procesando…',
  'Processes the claims waiting now, by this league’s rules. Settled claims are not re-run.':
    'Procesa las solicitudes que esperan ahora, según las reglas de esta liga. Las solicitudes ya resueltas no se vuelven a procesar.',
  '1 claim is waiting. Only the primary commissioner can run waivers manually.':
    '1 solicitud está esperando. Solo el comisionado principal puede procesar los agentes libres manualmente.',
  'Not run. Try again in a moment.': 'No se procesó. Inténtalo de nuevo en un momento.',
  'Nothing processed — waivers are locked or no claims were waiting.':
    'No se procesó nada: los agentes libres están bloqueados o no había solicitudes esperando.',
  'Processed 1 claim.': 'Se procesó 1 solicitud.',
  'Not run — the connection dropped.': 'No se procesó: se cortó la conexión.',
}

type Pattern = [RegExp, (...groups: string[]) => string]

const es = (s: string) => hubCopy(s, 'es')

/** Templates, each anchored to the whole string. Names and numbers they carry are kept as they are. */
const PATTERNS: Pattern[] = [
  // gate
  [/^You are a member of (.+)\. Ask its commissioner to add you as a co-commissioner if you need this\.$/s, (l) => `Eres miembro de ${l}. Pide a su comisionado que te añada como cocomisionado si lo necesitas.`],
  [/^You have view-only access to (.+)\.$/s, (l) => `Tienes acceso de solo lectura a ${l}.`],
  [/^You are not a member of (.+)\.$/s, (l) => `No eres miembro de ${l}.`],
  // header and footer
  [
    /^Everything it takes to run this league: what needs you, league health, the calendar, guides for the hard jobs, and a record of every change\. AllFantasy reads (.+) — rules and rulings are still applied there\.$/s,
    (p) => `${ES['Everything it takes to run this league: what needs you, league health, the calendar, guides for the hard jobs, and a record of every change.']} AllFantasy lee ${p}: las reglas y las decisiones se siguen aplicando allí.`,
  ],
  [/^AllFantasy reads this league\. Settings and rulings are applied on (.+)\.$/s, (p) => `AllFantasy lee esta liga. La configuración y las decisiones se aplican en ${p}.`],
  [/^(.+) right now$/s, (l) => `${l} ahora mismo`],
  [/^ and (\d+) more$/, (n) => ` y ${n} más`],
  [/^(\d+) teams aren’t connected to an AllFantasy account yet\.$/, (n) => `${n} equipos aún no están conectados a una cuenta de AllFantasy.`],
  // drafts
  [/^(\d+) picks$/, (n) => `${n} selecciones`],
  [/^Round (\d+), pick (\d+): (.+) selected (.+)$/s, (r, p, owner, player) => `Ronda ${r}, selección ${p}: ${owner} eligió a ${player}`],
  [/^week (\d+)$/, (w) => `semana ${w}`],
  // access
  [/^(\d+) people$/, (n) => `${n} personas`],
  // A platform name only — a broader `On …` would turn a server sentence half Spanish.
  [/^Here and on ([A-Za-z0-9]+)$/, (p) => `Aquí y en ${p}`],
  [/^On ([A-Za-z0-9]+)$/, (p) => `En ${p}`],
  [
    /^Whoever imported this league runs it here on AllFantasy\. (.+)’s own commissioner is listed as (.+) publishes it — rulings are still applied there\.$/s,
    (p) => `Quien importó esta liga la dirige aquí en AllFantasy. El comisionado de ${p} aparece tal como ${p} lo publica: las decisiones se siguen aplicando allí.`,
  ],
  // tasks, health, members
  [/^(\d+) more tasks$/, (n) => `${n} tareas más`],
  [/^(\d+) of (\d+) checks measured$/, (a, b) => `${a} de ${b} comprobaciones medidas`],
  [/^AllFantasy’s league health score · (\d+)% confidence\.$/, (n) => `Puntuación de salud de AllFantasy · ${n} % de confianza.`],
  [/^(\d+) of (\d+) active$/, (a, b) => `${a} de ${b} activos`],
  [/^Judged by (.+)\.$/s, (basis) => `Según ${es(basis)}.`],
  // audit log
  [/^(\d+) most recent$/, (n) => `los ${n} más recientes`],
  // automations, saves
  [/^Last changed (.+)\.$/s, (d) => `Último cambio: ${d}.`],
  [/^Could not save \((\d+)\)\.$/, (s) => `No se pudo guardar (${s}).`],
  // Chimmy
  [/^Use the stated number of tokens for this commissioner question\? Current balance: (.+)\.$/s, (b) => `¿Usar la cantidad de tokens indicada para esta pregunta de comisionado? Saldo actual: ${b}.`],
  [/^Use 1 token for this commissioner question\? Current balance: (.+)\.$/s, (b) => `¿Usar 1 token para esta pregunta de comisionado? Saldo actual: ${b}.`],
  [/^Use (\d+) tokens for this commissioner question\? Current balance: (.+)\.$/s, (n, b) => `¿Usar ${n} tokens para esta pregunta de comisionado? Saldo actual: ${b}.`],
  // format template
  [/^Does this league run as (.+)\?$/s, (f) => `¿Esta liga funciona como ${f}?`],
  // guides
  [/^Step (\d+) of (\d+)$/, (a, b) => `Paso ${a} de ${b}`],
  // waivers
  [/^FAAB budgets · \$([\d,.]+) season$/, (n) => `Presupuestos FAAB · $${n} por temporada`],
  [/^\$([\d,.]+) spent$/, (n) => `$${n} gastados`],
  [/^(.+) FAAB remaining$/s, (h) => `FAAB restante de ${h}`],
  [/^Last run · (.+) ET$/s, (w) => `Último proceso · ${w} ET`],
  [/^\$([\d,.]+) bid$/, (n) => `oferta de $${n}`],
  [/^Run waivers now · (\d+) waiting$/, (n) => `Procesar agentes libres ahora · ${n} en espera`],
  [
    /^(\d+) claims are waiting\. Only the primary commissioner can run waivers manually\.$/,
    (n) => `${n} solicitudes están esperando. Solo el comisionado principal puede procesar los agentes libres manualmente.`,
  ],
  [/^Not run: (.+)\.$/s, (why) => `No se procesó: ${why}.`],
  [/^Processed (\d+) claims\.$/, (n) => `Se procesaron ${n} solicitudes.`],
]

/*
 * The league health engine's one-line summary (`monitorLeagueHealth`), shown as the hub's health
 * status: "League health: 62/100 (healthy). <a strength> Problem: <a problem>". The engine composes
 * it from a closed vocabulary, so it is rebuilt here from its pieces — and if ANY piece is not in the
 * vocabulary the whole sentence stays English, never half of one.
 */
const HEALTH_STATUS_ES: Record<string, string> = {
  excellent: 'excelente',
  healthy: 'saludable',
  watch: 'en observación',
  at_risk: 'en riesgo',
  critical: 'crítica',
}
const HEALTH_STRENGTH_ES: Record<string, string> = {
  'Strong engagement — active trading and waiver use': 'Mucha participación: intercambios y agentes libres activos.',
  'Fair structure — good settings and low disputes': 'Estructura justa: buena configuración y pocas disputas.',
  'Sustainable — all managers active, no abandonment': 'Sostenible: todos los mánagers activos y sin abandonos.',
  'Near-perfect lineup submission rate': 'Casi todas las alineaciones enviadas.',
  'Active league chat — strong community': 'Chat de la liga activo: una comunidad fuerte.',
  'No major strengths.': 'Sin fortalezas destacadas.',
}
const HEALTH_PROBLEM_ES: Array<[RegExp, (n: string) => string]> = [
  [/^(\d+) inactive managers — engagement at risk$/, (n) => `${n} mánagers inactivos: la participación está en riesgo.`],
  [/^(\d+) abandoned teams — immediate action needed$/, (n) => `${n} equipos abandonados: hace falta actuar de inmediato.`],
  [/^(\d+) unresolved disputes eroding trust$/, (n) => `${n} disputas sin resolver están minando la confianza.`],
  [/^Low engagement — league activity is below healthy levels$/, () => 'Participación baja: la actividad de la liga está por debajo de lo saludable.'],
  [/^Poor lineup submission rate — managers are checked out$/, () => 'Pocas alineaciones enviadas: los mánagers se han desconectado.'],
]

function healthSummaryEs(english: string): string | null {
  const m = /^League health: (\d+)\/100 \(([a-z_]+)\)\. (.+?) (?:Problem: (.+)|No major problems\.)$/s.exec(english)
  if (!m) return null
  const [, score, status, strength, problem] = m
  const statusEs = HEALTH_STATUS_ES[status!]
  const strengthEs = HEALTH_STRENGTH_ES[strength!]
  if (!statusEs || !strengthEs) return null
  let problemEs = 'Sin problemas destacados.'
  if (problem != null) {
    for (const [re, build] of HEALTH_PROBLEM_ES) {
      const pm = re.exec(problem)
      if (pm) {
        problemEs = `Problema: ${build(pm[1] ?? '')}`
        return `Salud de la liga: ${score}/100 (${statusEs}). ${strengthEs} ${problemEs}`
      }
    }
    return null
  }
  return `Salud de la liga: ${score}/100 (${statusEs}). ${strengthEs} ${problemEs}`
}

/** The hub's own words in the reader's language; unknown text passes through unchanged. */
export function hubCopy(english: string | null | undefined, language: string): string {
  if (english == null) return ''
  if (language !== 'es') return english
  const exact = ES[english]
  if (exact != null) return exact
  const summary = healthSummaryEs(english)
  if (summary != null) return summary
  for (const [pattern, build] of PATTERNS) {
    const m = pattern.exec(english)
    if (m) return build(...m.slice(1))
  }
  return english
}

/** The locale dates on the hub are formatted in. */
export function hubDateLocale(language: string): string {
  return language === 'es' ? 'es-US' : 'en-US'
}
