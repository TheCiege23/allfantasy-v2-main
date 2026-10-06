/**
 * Commissioner Hub — where everything lives (brief items 2, 4 and 9).
 *
 *   - `buildLeagueAreas`     every league area, and where it is actually run
 *   - `buildWorkflows`       step-by-step guides for the four jobs the brief names
 *   - `buildCommunities`     Discord, announcements, calendar, payments, platform
 *
 * ⚠ EVERY LINK HERE POINTS AT A SCREEN THAT EXISTS AND WORKS, and an imported
 * league is told where the change is really made. AllFantasy cannot write to
 * Sleeper (its API is read-only), so a "Change settings" button that opened an
 * AllFantasy form for a Sleeper league would record a change that never reaches
 * the league. `resolveActionAuthority` decides that per action, the same way
 * Commissioner OS does; nothing here re-derives it.
 *
 * ⚠ PLATFORM LINKS ARE VERIFIED OR ABSENT. `verifiedHandoff` returns null for a
 * URL format nobody has confirmed lands where it says (MFL, Fantrax,
 * Fleaflicker, and every provider's settings screen), and the step then names
 * the platform in words instead of linking somewhere that might be wrong.
 *
 * Client-safe: no Prisma.
 */

import { resolveActionAuthority } from '@/lib/commissioner-os/authority'
import { verifiedHandoff, platformLabel, type LinkLeague, type PlatformLink } from '@/lib/core-app/platformLinks'
import { pickLanguage } from './pickLanguage'

export type HubLink = { label: string; href: string; external: boolean }

export type HubLeague = LinkLeague & {
  id: string
  name: string
  platform: string
  /** True when AllFantasy is this league's system of record. */
  native: boolean
}

function q(leagueId: string): string {
  return `?league=${encodeURIComponent(leagueId)}`
}

function leaguePage(leagueId: string, view: string): string {
  return `/league/${encodeURIComponent(leagueId)}?view=${encodeURIComponent(view)}`
}

function toHubLink(link: PlatformLink | null): HubLink | null {
  return link ? { label: link.label, href: link.href, external: link.external } : null
}

// ── League areas ────────────────────────────────────────────────────────────

export type LeagueArea = {
  key:
    | 'overview'
    | 'settings'
    | 'members'
    | 'standings'
    | 'schedule'
    | 'drafts'
    | 'trades'
    | 'waivers'
    | 'history'
    | 'announcements'
    | 'intelligence'
  label: string
  description: string
  link: HubLink
  /** Where a CHANGE is made, when that is not the page above. */
  changeOn: HubLink | null
  /** Short note for imported leagues: this page is a read of the platform. */
  note: string | null
}

export function buildLeagueAreas(league: HubLeague, language = 'en'): LeagueArea[] {
  const L = pickLanguage(language)
  const pl = platformLabel(league.platform)
  const onPlatform = league.native ? null : toHubLink(verifiedHandoff(league, 'league'))
  const readNote = league.native ? null : L(`Read from ${pl}. Changes are made there.`, `Datos leídos de ${pl}. Los cambios se hacen allí.`)
  const core = (screen: string) => `/core/${screen}${q(league.id)}`

  return [
    {
      key: 'overview',
      label: L('Overview', 'Resumen'),
      description: L('Standings snapshot, this week, and what changed.', 'La clasificación de un vistazo, esta semana y lo que cambió.'),
      link: { label: L('Open overview', 'Abrir el resumen'), href: `/core${q(league.id)}`, external: false },
      changeOn: null,
      note: null,
    },
    {
      key: 'settings',
      label: L('Settings', 'Configuración'),
      description: L('Scoring, rosters, waivers, trades, draft and playoffs.', 'Puntuación, plantillas, agentes libres, intercambios, draft y playoffs.'),
      link: { label: L('Open settings', 'Abrir la configuración'), href: leaguePage(league.id, 'settings'), external: false },
      changeOn: onPlatform,
      note: league.native
        ? null
        : L(`A read-only summary here. Rules are changed on ${pl}.`, `Aquí es un resumen de solo lectura. Las reglas se cambian en ${pl}.`),
    },
    {
      key: 'members',
      label: L('Members', 'Miembros'),
      description: L('Who manages each team, invites, and co-commissioners.', 'Quién dirige cada equipo, invitaciones y cocomisionados.'),
      link: { label: L('Manage members', 'Gestionar miembros'), href: leaguePage(league.id, 'settings'), external: false },
      changeOn: onPlatform,
      note: league.native
        ? null
        : L(
            `Team ownership is set on ${pl}. AllFantasy handles invites to claim a team here.`,
            `La propiedad de los equipos se fija en ${pl}. AllFantasy gestiona aquí las invitaciones para reclamar un equipo.`,
          ),
    },
    {
      key: 'standings',
      label: L('Standings', 'Clasificación'),
      description: L('Records, points and playoff picture.', 'Récords, puntos y panorama de playoffs.'),
      link: { label: L('Open standings', 'Abrir la clasificación'), href: core('standings'), external: false },
      changeOn: null,
      note: readNote,
    },
    {
      key: 'schedule',
      label: L('Schedule', 'Calendario de partidos'),
      description: L('Every week’s matchups.', 'Los enfrentamientos de cada semana.'),
      link: { label: L('Open schedule', 'Abrir el calendario de partidos'), href: leaguePage(league.id, 'schedule'), external: false },
      changeOn: onPlatform,
      note: readNote,
    },
    {
      key: 'drafts',
      label: L('Drafts', 'Drafts'),
      description: L('Draft board, order and results.', 'Tablero, orden y resultados del draft.'),
      link: { label: L('Open Draft HQ', 'Abrir Draft HQ'), href: core('draft-hq'), external: false },
      changeOn: onPlatform,
      note: league.native ? null : L(`The draft itself runs on ${pl}; Draft HQ follows it.`, `El draft en sí se hace en ${pl}; Draft HQ lo sigue.`),
    },
    {
      key: 'trades',
      label: L('Trades', 'Intercambios'),
      description: L('Offers, completed deals and review.', 'Ofertas, intercambios cerrados y revisión.'),
      link: { label: L('Open trades', 'Abrir intercambios'), href: core('trades'), external: false },
      changeOn: league.native ? null : toHubLink(verifiedHandoff(league, 'trade')),
      note: league.native ? null : L(`Trades are accepted and vetoed on ${pl}.`, `Los intercambios se aceptan y se vetan en ${pl}.`),
    },
    {
      key: 'waivers',
      label: L('Waivers', 'Agentes libres'),
      description: L('Claims, FAAB and the last run.', 'Reclamos, FAAB y el último proceso.'),
      link: { label: L('Open waivers', 'Abrir agentes libres'), href: core('waivers'), external: false },
      changeOn: league.native ? null : toHubLink(verifiedHandoff(league, 'waivers')),
      note: league.native ? null : L(`Claims are processed on ${pl}.`, `Los reclamos se procesan en ${pl}.`),
    },
    {
      key: 'history',
      label: L('History', 'Historial'),
      description: L('Past seasons, champions and all-time records.', 'Temporadas pasadas, campeones y récords históricos.'),
      link: { label: L('Open history', 'Abrir el historial'), href: core('career'), external: false },
      changeOn: null,
      note: null,
    },
    {
      key: 'announcements',
      label: L('Announcements', 'Anuncios'),
      description: L('League chat — where rulings and reminders are posted.', 'El chat de la liga, donde se publican decisiones y recordatorios.'),
      link: { label: L('Open league chat', 'Abrir el chat de la liga'), href: leaguePage(league.id, 'league_chat'), external: false },
      changeOn: null,
      note: null,
    },
    {
      // The league Overview's commissioner card used to open this page; it now opens this hub,
      // so the hub has to keep a way there.
      key: 'intelligence',
      label: L('Commissioner intelligence', 'Inteligencia del comisionado'),
      description: L('League and manager health, rivalries, the audit log and the intelligence modules.', 'Salud de la liga y de los mánagers, rivalidades, el registro de cambios y los módulos de inteligencia.'),
      link: {
        label: L('Open intelligence', 'Abrir inteligencia'),
        href: `/league/${encodeURIComponent(league.id)}/intelligence`,
        external: false,
      },
      changeOn: null,
      note: null,
    },
  ]
}

// ── Guided workflows ────────────────────────────────────────────────────────

export type WorkflowStep = {
  title: string
  body: string
  link: HubLink | null
}

export type Workflow = {
  key: 'replace-manager' | 'change-rule' | 'schedule-draft' | 'resolve-dispute'
  title: string
  summary: string
  /** Stated up front for an imported league, so step 3 is not a surprise. */
  authorityNote: string | null
  steps: WorkflowStep[]
}

export function buildWorkflows(league: HubLeague, language = 'en'): Workflow[] {
  const L = pickLanguage(language)
  const pl = platformLabel(league.platform)
  /*
   * Team ownership, rules and trade rulings are all EXTERNAL state on an imported
   * league — the platform holds the truth and a re-sync can observe the change.
   * One resolution covers all four guides.
   */
  const authority = resolveActionAuthority({ platform: league.platform, scope: 'external', verifiableFromImport: true })
  const onPlatform = toHubLink(verifiedHandoff(league, 'league'))
  const onPlatformTrade = toHubLink(verifiedHandoff(league, 'trade')) ?? onPlatform
  const chat: HubLink = { label: L('Open league chat', 'Abrir el chat de la liga'), href: leaguePage(league.id, 'league_chat'), external: false }
  const settings: HubLink = { label: L('Open league settings', 'Abrir la configuración de la liga'), href: leaguePage(league.id, 'settings'), external: false }
  const resync: HubLink = { label: L('Re-sync this league', 'Volver a sincronizar esta liga'), href: `/core/sync${q(league.id)}`, external: false }
  const platformStep = (what: string, link: HubLink | null): WorkflowStep => ({
    title: L(`Make the change on ${pl}`, `Haz el cambio en ${pl}`),
    body: L(
      `${pl} is this league’s system of record, so ${what} happens there. ${
        link ? '' : `Open the league in ${pl} and use its commissioner tools.`
      }`,
      `${pl} es el sistema de referencia de esta liga, así que ${what} se hace allí. ${
        link ? '' : `Abre la liga en ${pl} y usa sus herramientas de comisionado.`
      }`,
    ).trim(),
    link,
  })

  const replace: Workflow = {
    key: 'replace-manager',
    title: L('Replace a manager', 'Reemplazar a un mánager'),
    summary: L('Find the team nobody is running, hand it to someone new, and tell the league.', 'Encuentra el equipo que nadie dirige, entrégaselo a alguien nuevo y avisa a la liga.'),
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: authority.canExecute
      ? [
          {
            title: L('Confirm who has gone quiet', 'Confirma quién se ha quedado sin actividad'),
            body: L('Member activity below lists every manager with no owner or no move in 14 days.', 'La actividad de los miembros, más abajo, lista a cada mánager sin dueño o sin movimientos en 14 días.'),
            link: { label: L('See member activity', 'Ver la actividad de los miembros'), href: '#ch-members', external: false },
          },
          {
            title: L('Open the team up', 'Deja el equipo disponible'),
            body: L('Orphan teams lists ownerless teams and lets you advertise one or hand it to an AI manager for now.', 'Equipos huérfanos lista los equipos sin dueño y te permite anunciar uno o dejárselo por ahora a un mánager de IA.'),
            link: { label: L('Open orphan teams', 'Abrir equipos huérfanos'), href: `/league/${encodeURIComponent(league.id)}/orphan-teams`, external: false },
          },
          {
            title: L('Invite the replacement', 'Invita al reemplazo'),
            body: L('Send your league’s invite link. The new manager joins and takes over the open team.', 'Envía el enlace de invitación de tu liga. El nuevo mánager se une y se hace cargo del equipo disponible.'),
            link: settings,
          },
          {
            title: L('Tell the league', 'Avisa a la liga'),
            body: L('Post who is taking over, so nobody is surprised by a new name in the standings.', 'Publica quién se hace cargo, para que a nadie le sorprenda un nombre nuevo en la clasificación.'),
            link: chat,
          },
        ]
      : [
          {
            title: L('Confirm who has gone quiet', 'Confirma quién se ha quedado sin actividad'),
            body: L('Member activity below lists every manager with no owner or no move in 14 days.', 'La actividad de los miembros, más abajo, lista a cada mánager sin dueño o sin movimientos en 14 días.'),
            link: { label: L('See member activity', 'Ver la actividad de los miembros'), href: '#ch-members', external: false },
          },
          platformStep(L('changing a team’s owner', 'cambiar el dueño de un equipo'), onPlatform),
          {
            title: L('Re-sync so AllFantasy sees the new owner', 'Vuelve a sincronizar para que AllFantasy vea al nuevo dueño'),
            body: L('Until the next sync, AllFantasy still shows the old manager on that team.', 'Hasta la próxima sincronización, AllFantasy sigue mostrando al mánager anterior en ese equipo.'),
            link: resync,
          },
          {
            title: L('Invite them to claim the team here', 'Invítalo a reclamar el equipo aquí'),
            body: L('Your league’s invite link lets the new manager connect the team to their AllFantasy account.', 'El enlace de invitación de tu liga permite al nuevo mánager conectar el equipo a su cuenta de AllFantasy.'),
            link: settings,
          },
          {
            title: L('Tell the league', 'Avisa a la liga'),
            body: L('Post who is taking over, so nobody is surprised by a new name in the standings.', 'Publica quién se hace cargo, para que a nadie le sorprenda un nombre nuevo en la clasificación.'),
            link: chat,
          },
        ],
  }

  const pollStep: WorkflowStep = {
    title: L('Put it to a vote', 'Sométela a votación'),
    body: L('Post a poll in league chat and give it a deadline — open votes show on this page and in the calendar until they close.', 'Publica una encuesta en el chat de la liga y ponle una fecha límite: las votaciones abiertas aparecen en esta página y en el calendario hasta que cierran.'),
    link: chat,
  }

  const changeRule: Workflow = {
    key: 'change-rule',
    title: L('Change a rule', 'Cambiar una regla'),
    summary: L('Check what the league runs on today, get the league’s agreement, apply it, and record it.', 'Comprueba cómo funciona hoy la liga, consigue el acuerdo de la liga, aplícalo y déjalo registrado.'),
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: [
      {
        title: L('Check the current rule', 'Revisa la regla actual'),
        body: L('“How this league runs” below shows the trade deadline, playoffs and waivers as they stand.', '«Cómo funciona esta liga», más abajo, muestra la fecha límite de intercambios, los playoffs y los agentes libres tal como están.'),
        link: { label: L('See current rules', 'Ver las reglas actuales'), href: '#ch-rules', external: false },
      },
      pollStep,
      ...(authority.canExecute
        ? [
            {
              title: L('Apply it in settings', 'Aplícalo en la configuración'),
              body: L('Every saved change is written to the league’s audit log and appears in the timeline on this page.', 'Cada cambio guardado se escribe en el registro de cambios de la liga y aparece en la línea de tiempo de esta página.'),
              link: settings,
            },
          ]
        : [
            platformStep(L('changing a rule', 'cambiar una regla'), onPlatform),
            {
              title: L('Re-sync so the change shows here', 'Vuelve a sincronizar para que el cambio aparezca aquí'),
              body: L('AllFantasy reads the new rule on the next sync.', 'AllFantasy lee la nueva regla en la próxima sincronización.'),
              link: resync,
            },
          ]),
      {
        title: L('Announce the change', 'Anuncia el cambio'),
        body: L('Say what changed and from which week, in league chat, so the ruling is on the record.', 'Di en el chat de la liga qué cambió y desde qué semana, para que la decisión quede registrada.'),
        link: chat,
      },
    ],
  }

  const scheduleDraft: Workflow = {
    key: 'schedule-draft',
    title: L('Schedule a draft', 'Programar un draft'),
    summary: L('Pick a time that works, set it, and make sure every manager has it.', 'Elige una hora que funcione, fíjala y asegúrate de que todos los mánagers la tengan.'),
    authorityNote: league.native
      ? null
      : L(`${pl} runs this league’s draft, so the date is set there.`, `${pl} lleva el draft de esta liga, así que la fecha se fija allí.`),
    steps: [
      {
        title: L('Find a time that works', 'Encuentra una hora que funcione'),
        body: L('Post a poll with two or three options and a deadline a few days out.', 'Publica una encuesta con dos o tres opciones y una fecha límite a unos días vista.'),
        link: chat,
      },
      league.native
        ? {
            title: L('Set the draft date', 'Fija la fecha del draft'),
            body: L('Draft settings hold the date, draft type, pick timer and order. Once saved, it appears in this page’s calendar and calendar export.', 'La configuración del draft guarda la fecha, el tipo de draft, el tiempo por selección y el orden. Una vez guardada, aparece en el calendario de esta página y en su exportación.'),
            link: settings,
          }
        : platformStep(L('setting the draft date', 'fijar la fecha del draft'), onPlatform),
      league.native
        ? {
            title: L('Lock in the draft order', 'Cierra el orden del draft'),
            body: L('Randomize or set the order in draft settings before draft day.', 'Sortea o fija el orden en la configuración del draft antes del día del draft.'),
            link: settings,
          }
        : {
            title: L('Follow it from Draft HQ', 'Síguelo desde Draft HQ'),
            body: L('Draft HQ picks the draft up from the platform once it starts.', 'Draft HQ recoge el draft de la plataforma en cuanto empieza.'),
            link: { label: L('Open Draft HQ', 'Abrir Draft HQ'), href: `/core/draft-hq${q(league.id)}`, external: false },
          },
      {
        title: L('Announce the date', 'Anuncia la fecha'),
        body: league.native
          ? L('Post it in league chat. Managers can also add it to their calendars from the export on this page.', 'Publícala en el chat de la liga. Los mánagers también pueden añadirla a sus calendarios desde la exportación de esta página.')
          : L('Post the date and time in league chat, with the time zone.', 'Publica la fecha y la hora en el chat de la liga, con la zona horaria.'),
        link: chat,
      },
    ],
  }

  const resolveDispute: Workflow = {
    key: 'resolve-dispute',
    title: L('Resolve a dispute', 'Resolver una disputa'),
    summary: L('Get the facts, check the rule, rule on it, and put the ruling on the record.', 'Reúne los hechos, revisa la regla, decide y deja la decisión registrada.'),
    authorityNote: authority.canExecute ? null : authority.blockedReason,
    steps: [
      {
        title: L('Get the facts', 'Reúne los hechos'),
        body: L('The trade or move in question, its date and who was involved — the Trades screen and the timeline on this page have both.', 'El intercambio o movimiento en cuestión, su fecha y quiénes participaron: la pantalla de Intercambios y la línea de tiempo de esta página tienen ambos datos.'),
        link: { label: L('Open trades', 'Abrir intercambios'), href: `/core/trades${q(league.id)}`, external: false },
      },
      {
        title: L('Check the rule', 'Revisa la regla'),
        body: L('Read what the league actually runs on before ruling, so the decision rests on the rule and not on memory.', 'Lee cómo funciona realmente la liga antes de decidir, para que la decisión se base en la regla y no en la memoria.'),
        link: { label: L('See current rules', 'Ver las reglas actuales'), href: '#ch-rules', external: false },
      },
      authority.canExecute
        ? {
            title: L('Review it in the league', 'Revísalo en la liga'),
            body: L('Pending trades can be approved or vetoed from the league’s Trades tab.', 'Los intercambios pendientes se pueden aprobar o vetar desde la pestaña Intercambios de la liga.'),
            link: { label: L('Open trade review', 'Abrir la revisión de intercambios'), href: leaguePage(league.id, 'trades'), external: false },
          }
        : platformStep(L('vetoing or reversing a move', 'vetar o revertir un movimiento'), onPlatformTrade),
      {
        title: L('If it’s a judgment call, let the league decide', 'Si es una cuestión de criterio, deja que decida la liga'),
        body: L('A poll with a deadline keeps the ruling from being yours alone.', 'Una encuesta con fecha límite evita que la decisión sea solo tuya.'),
        link: chat,
      },
      {
        title: L('Post the ruling', 'Publica la decisión'),
        body: L('State the decision and the rule behind it in league chat — that post is the league’s record of it.', 'Explica la decisión y la regla en la que se basa en el chat de la liga: esa publicación es el registro de la liga.'),
        link: chat,
      },
    ],
  }

  return [replace, changeRule, scheduleDraft, resolveDispute]
}

// ── External communities ────────────────────────────────────────────────────

export type CommunityChannel = {
  key: 'discord' | 'announcements' | 'calendar' | 'payments' | 'platform'
  label: string
  status: 'connected' | 'available' | 'unavailable'
  detail: string
  link: HubLink | null
}

export type CommunitiesInput = {
  league: HubLeague
  /** The viewer is `League.userId` — the only role the Discord bridge routes accept. */
  viewerIsOwner: boolean
  /** The viewer may send an @everyone announcement here (commissioner or co-commissioner, native league). */
  viewerCanBroadcast: boolean
  discord: { guildName: string | null; channelName: string | null } | null
  datedEventCount: number
  payment: { link: string | null; provider: string | null; tracked: boolean }
  claimedTeams: number
  totalTeams: number
  /** The reader's language; default English. */
  language?: string
}

export function buildCommunities(input: CommunitiesInput): CommunityChannel[] {
  const { league } = input
  const L = pickLanguage(input.language)
  const pl = platformLabel(league.platform)
  const out: CommunityChannel[] = []

  out.push(
    input.discord
      ? {
          key: 'discord',
          label: 'Discord',
          status: 'connected',
          detail: L(
            `League chat relays to ${input.discord.channelName ? `#${input.discord.channelName}` : 'a channel'}${
              input.discord.guildName ? ` in ${input.discord.guildName}` : ''
            }.`,
            `El chat de la liga se conecta con ${input.discord.channelName ? `#${input.discord.channelName}` : 'un canal'}${
              input.discord.guildName ? ` en ${input.discord.guildName}` : ''
            }.`,
          ),
          link: input.viewerIsOwner
            ? { label: L('Manage the bridge', 'Gestionar la conexión'), href: `/core/discord${q(league.id)}`, external: false }
            : null,
        }
      : {
          key: 'discord',
          label: 'Discord',
          status: input.viewerIsOwner ? 'available' : 'unavailable',
          detail: input.viewerIsOwner
            ? L('Relay league chat to your Discord server, both ways.', 'Conecta el chat de la liga con tu servidor de Discord, en ambos sentidos.')
            : L('Not connected. Only the league owner can connect Discord.', 'Sin conectar. Solo el dueño de la liga puede conectar Discord.'),
          link: input.viewerIsOwner
            ? { label: L('Connect Discord', 'Conectar Discord'), href: `/core/discord${q(league.id)}`, external: false }
            : null,
        },
  )

  out.push({
    key: 'announcements',
    label: L('Email & announcements', 'Correo y anuncios'),
    status: input.claimedTeams > 0 ? 'available' : 'unavailable',
    detail:
      input.claimedTeams > 0
        ? L(
            `A league-chat post reaches the ${input.claimedTeams} of ${input.totalTeams} managers with AllFantasy accounts, by in-app, email or text as each has chosen.`,
            `Una publicación en el chat de la liga llega a los ${input.claimedTeams} de ${input.totalTeams} mánagers con cuenta de AllFantasy, por la app, correo o mensaje de texto, según haya elegido cada uno.`,
          ) +
          (input.viewerCanBroadcast
            ? L(' An @everyone announcement notifies all of them at once.', ' Un anuncio a @everyone los avisa a todos a la vez.')
            : '')
        : L('No manager has connected an AllFantasy account yet, so there is nobody to email. Invite managers to claim their teams.', 'Ningún mánager ha conectado todavía una cuenta de AllFantasy, así que no hay a quién escribir. Invita a los mánagers a reclamar sus equipos.'),
    link: { label: L('Open league chat', 'Abrir el chat de la liga'), href: leaguePage(league.id, 'league_chat'), external: false },
  })

  out.push({
    key: 'calendar',
    label: L('Calendar', 'Calendario'),
    status: input.datedEventCount > 0 ? 'available' : 'unavailable',
    detail:
      input.datedEventCount > 0
        ? L(
            `Download the league’s ${input.datedEventCount} dated ${input.datedEventCount === 1 ? 'event' : 'events'} as a calendar file for Google, Apple or Outlook.`,
            `Descarga ${input.datedEventCount === 1 ? 'el evento con fecha' : `los ${input.datedEventCount} eventos con fecha`} de la liga como archivo de calendario para Google, Apple u Outlook.`,
          )
        : L('Nothing on this league’s calendar has a date yet, so there is nothing to export.', 'Nada en el calendario de esta liga tiene fecha todavía, así que no hay nada que exportar.'),
    link: null,
  })

  out.push(
    input.payment.link
      ? {
          key: 'payments',
          label: L('Payment link', 'Enlace de pago'),
          status: 'connected',
          detail: L(
            `Dues are collected through ${providerName(input.payment.provider)}.`,
            `Las cuotas se cobran a través de ${providerName(input.payment.provider, 'es')}.`,
          ),
          link: {
            label: L(`Open ${providerName(input.payment.provider)}`, `Abrir ${providerName(input.payment.provider, 'es')}`),
            href: input.payment.link,
            external: true,
          },
        }
      : {
          key: 'payments',
          label: L('Payment link', 'Enlace de pago'),
          status: 'available',
          detail: input.payment.tracked
            ? L('Dues are tracked, but no payment link is set. Add a LeagueSafe or FanCred link in the dues tracker.', 'Las cuotas se registran, pero no hay enlace de pago. Añade un enlace de LeagueSafe o FanCred en el control de cuotas.')
            : L('Track dues and add a LeagueSafe or FanCred link in the league’s dues tracker.', 'Registra las cuotas y añade un enlace de LeagueSafe o FanCred en el control de cuotas de la liga.'),
          link: { label: L('Open dues tracker', 'Abrir el control de cuotas'), href: leaguePage(league.id, 'settings'), external: false },
        },
  )

  if (league.native) {
    out.push({
      key: 'platform',
      label: L('Source platform', 'Plataforma de origen'),
      status: 'connected',
      detail: L('This league runs on AllFantasy — there is no other platform to keep in step.', 'Esta liga funciona en AllFantasy: no hay otra plataforma con la que sincronizarse.'),
      link: null,
    })
  } else {
    const link = toHubLink(verifiedHandoff(league, 'league'))
    out.push({
      key: 'platform',
      label: pl,
      status: link ? 'connected' : 'available',
      detail: link
        ? L(
            `Rules, rosters and rulings are applied on ${pl}. AllFantasy re-reads the league on every sync.`,
            `Las reglas, las plantillas y las decisiones se aplican en ${pl}. AllFantasy vuelve a leer la liga en cada sincronización.`,
          )
        : L(
            `Rules, rosters and rulings are applied on ${pl}. A direct link to this league on ${pl} isn’t verified yet.`,
            `Las reglas, las plantillas y las decisiones se aplican en ${pl}. Aún no está verificado un enlace directo a esta liga en ${pl}.`,
          ),
      link,
    })
  }

  return out
}

function providerName(provider: string | null, language = 'en'): string {
  const L = pickLanguage(language)
  const p = (provider ?? '').toLowerCase()
  if (p === 'leaguesafe') return 'LeagueSafe'
  if (p === 'fancred') return 'FanCred'
  return L('the league’s payment link', 'el enlace de pago de la liga')
}
