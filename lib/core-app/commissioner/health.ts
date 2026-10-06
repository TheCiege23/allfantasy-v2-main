/**
 * Commissioner Hub — the five league health flags (brief item 7).
 *
 * Abandoned teams, missing lineups, unequal schedules, unpaid dues and
 * unresolved votes. Each flag is either MEASURED — a count read off real rows —
 * or it says why it could not be measured. There is no third state.
 *
 * ⚠ THIS IS NOT A SECOND HEALTH SCORE. The headline number on the hub is the
 * canonical `monitorLeagueHealth` score, read through
 * `getCommissionerHubHealthForUser`, so the per-league screen and the
 * all-leagues `/commissioner-hub` cannot disagree about one league. These flags
 * are the named, actionable conditions underneath it, and they carry no score.
 *
 * ⚠ AN UNMEASURED FLAG IS NEVER A GREEN ONE. "0 unpaid" off a league that does
 * not track dues, or "0 missing lineups" off an MFL roster whose starters are
 * blank because MFL did not say, are the two most confident wrong answers this
 * panel could give. Both come back `measured: false` with the reason.
 *
 * Client-safe: no Prisma. The loader reads the rows and passes them in, so every
 * rule here is testable without a database.
 */

import { isPollClosed, type ViewerPoll } from '@/lib/chat-core/messagePolls'

export type HealthFlagKey = 'abandoned' | 'lineups' | 'schedule' | 'dues' | 'votes'

export type HealthFlagAction = { label: string; href: string; external: boolean }

export type HealthFlag =
  | {
      key: HealthFlagKey
      label: string
      measured: true
      severity: 'bad' | 'warn' | 'good'
      count: number
      headline: string
      detail: string
      /** Who or what the count is made of — a commissioner cannot message a number. */
      names: string[]
      action: HealthFlagAction | null
    }
  | {
      key: HealthFlagKey
      label: string
      measured: false
      reason: string
      action: HealthFlagAction | null
    }

/** Sleeper's marker for a starting slot nobody filled, in a lineup read straight off its API. */
const EMPTY_SLOT = '0'

function isEmptySlot(value: unknown): boolean {
  if (value == null) return true
  const s = String(value).trim()
  return s === '' || s === EMPTY_SLOT
}

/**
 * How many of a lineup's starting slots are empty.
 *
 * 🛑 A STORED LINEUP DOES NOT CONTAIN THE `"0"` MARKER. Every importer drops it before storing
 * (`SleeperRosterMapper` `starter_ids`), so on production an empty slot shows up only as a starters
 * list shorter than the league requires. Measured 2026-09-17: 0 of 4,027 stored rosters hold a
 * `"0"`; 241 in-season Sleeper rosters are short. Counting markers alone reported "Every lineup is
 * full" for all of them, and the lineup-reminder recipe could never fire.
 *
 * So, when the league's required starter count is known, empty = required − filled. When it is
 * not (0), only explicit markers count, which is all that can honestly be said.
 */
export function emptyStarterSlots(starters: unknown[], requiredStarters: number): number {
  const markers = starters.filter(isEmptySlot).length
  if (!(requiredStarters > 0)) return markers
  return Math.max(0, requiredStarters - (starters.length - markers))
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Spanish when the reader asked for it (2026-10-05). Every flag is a sentence composed from league
 * data — counts, name lists, "and 3 more" — so it is written in the reader's language HERE rather
 * than translated by pattern at render, where it would come out half Spanish. The default is
 * English, so every other caller of these builders reads exactly what it always did.
 */
const isEs = (language: string | undefined) => language === 'es'

function namesPreview(names: string[], max = 4, language?: string): string {
  if (names.length === 0) return ''
  const shown = names.slice(0, max).join(', ')
  if (names.length <= max) return shown
  return isEs(language) ? `${shown} y ${names.length - max} más` : `${shown} and ${names.length - max} more`
}

// ── Abandoned teams ─────────────────────────────────────────────────────────

export type AbandonedInput = {
  /**
   * Per-manager status from `resolveMemberActivity` (./activity.ts). Null when
   * activity could not be judged — `activityReason` then says why, which is not
   * the same thing as a league with no managers.
   */
  managers: Array<{ name: string; status: 'active' | 'at_risk' | 'inactive' | 'unknown' }> | null
  activityReason?: string | null
  /** Teams the platform itself reports with no owner (`LeagueTeam.isOrphan`). */
  orphanTeams: string[]
  totalTeams: number
  action: HealthFlagAction | null
  /**
   * Set when the league's data has stopped arriving. Idle time is read from
   * `Roster.updatedAt`, which every sync touches — so when syncs stop, every
   * manager drifts past the 14-day window together and the whole league reads
   * as abandoned. Measured on a real Sleeper league whose last sync was 14 days
   * old: "12 teams with nobody running them". The honest answer is "we can't
   * tell until it syncs", with the re-sync as the action.
   */
  stale?: { reason: string; action: HealthFlagAction } | null
  language?: string
}

export function abandonedTeamsFlag(input: AbandonedInput): HealthFlag {
  const es = isEs(input.language)
  const label = es ? 'Equipos abandonados' : 'Abandoned teams'
  if (input.stale) {
    return { key: 'abandoned', label, measured: false, reason: input.stale.reason, action: input.stale.action }
  }
  if (input.managers == null && input.orphanTeams.length === 0) {
    return {
      key: 'abandoned',
      label,
      measured: false,
      reason:
        input.activityReason ??
        (es
          ? 'No se pudo leer la actividad de los mánagers en este momento, así que ningún equipo puede considerarse abandonado ni activo.'
          : 'Manager activity could not be read just now, so no team can be called abandoned or active.'),
      action: input.action,
    }
  }
  if (input.totalTeams === 0) {
    return {
      key: 'abandoned',
      label,
      measured: false,
      reason: es ? 'Aún no se ha importado ningún equipo en esta liga.' : 'No teams have been imported for this league yet.',
      action: null,
    }
  }

  /*
   * Two different facts, kept apart on purpose.
   *
   *   unowned  a seat with nobody in it — genuinely abandoned. One entry per team,
   *            so two teams both named "Unknown" count as two.
   *   quiet    a manager with no trade, waiver claim or roster move in 14 days.
   *            Early in a season that is common and says nothing about whether
   *            they set a lineup, so it is a warning, never "nobody is running it".
   */
  const unowned = input.orphanTeams
  const managers = input.managers ?? []
  const quiet = managers.filter((m) => m.status === 'inactive').map((m) => m.name)
  const count = unowned.length + quiet.length

  // Everyone quiet in a league whose feed is current is a fact about the league.
  if (unowned.length === 0 && managers.length > 1 && quiet.length === managers.length) {
    return {
      key: 'abandoned',
      label,
      measured: true,
      severity: 'warn',
      count,
      headline: es ? 'Ningún mánager ha hecho un movimiento en 14 días' : 'No manager has made a move in 14 days',
      detail: es
        ? `Ninguno de los ${managers.length} mánagers ha hecho un intercambio, un reclamo ni un cambio de plantilla en dos semanas. Es la liga la que está tranquila, no un equipo abandonado.`
        : `None of the ${managers.length} managers has made a trade, waiver claim or roster move in two weeks. That is the league being quiet, not one team being abandoned.`,
      names: [],
      action: null,
    }
  }

  const headline =
    count === 0
      ? es
        ? 'Todos los equipos tienen dueño y un movimiento reciente'
        : 'Every team has an owner and a recent move'
      : [
          unowned.length > 0
            ? es
              ? plural(unowned.length, 'equipo sin dueño', 'equipos sin dueño')
              : `${plural(unowned.length, 'team')} with no owner`
            : null,
          quiet.length > 0
            ? es
              ? plural(quiet.length, 'mánager sin movimientos en 14 días', 'mánagers sin movimientos en 14 días')
              : `${plural(quiet.length, 'manager')} with no moves in 14 days`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')

  const detail =
    count === 0
      ? managers.length > 0
        ? es
          ? 'Todos los equipos tienen dueño, y todos los mánagers han hecho un movimiento en los últimos 14 días.'
          : 'Every team has an owner, and every manager has made a move in the last 14 days.'
        : es
          ? 'Todos los equipos tienen dueño.'
          : 'Every team has an owner.'
      : [
          unowned.length > 0
            ? es
              ? `Sin dueño: ${namesPreview(unowned, 4, 'es')}.`
              : `No owner: ${namesPreview(unowned)}.`
            : null,
          quiet.length > 0
            ? es
              ? `Sin intercambios, reclamos ni cambios de plantilla en 14 días: ${namesPreview(quiet, 4, 'es')}. Estar tranquilo no es lo mismo que haberse ido: habla con ellos antes de reemplazar a nadie.`
              : `No trade, waiver claim or roster move in 14 days: ${namesPreview(quiet)}. Quiet isn’t the same as gone — check in before replacing anyone.`
            : null,
        ]
          .filter(Boolean)
          .join(' ')

  return {
    key: 'abandoned',
    label,
    measured: true,
    severity: unowned.length >= 2 ? 'bad' : count > 0 ? 'warn' : 'good',
    count,
    headline,
    detail,
    names: [...unowned, ...quiet],
    action: count > 0 ? input.action : null,
  }
}

// ── Missing lineups ─────────────────────────────────────────────────────────

export type LineupsInput = {
  platform: string
  /** Only an in-season league has a lineup anyone is expected to have set. */
  inSeason: boolean
  rosters: Array<{
    name: string
    /**
     * The roster's starting slots as the platform stored them, or null when the
     * roster's shape could not be read at all.
     */
    starters: unknown[] | null
  }>
  /** Starting slots the league's rules require (`readRequiredStarterCount`); 0 when unknown. */
  requiredStarters?: number
  action: HealthFlagAction | null
  /** Rosters from a sync that has stopped are last week's lineups — see `AbandonedInput.stale`. */
  stale?: { reason: string; action: HealthFlagAction } | null
  language?: string
}

/**
 * ⚠ MFL AND FANTRAX STORE AN EMPTY STARTER LIST WHEN THE LINEUP IS UNKNOWN, not
 * when it is empty (`MflLeagueFetchService` writes `[]` when the platform did not
 * return starters). On those platforms a blank lineup is an absence of data, and
 * accusing a manager on it would be wrong most of the time.
 */
const LINEUP_UNKNOWABLE = new Set(['mfl', 'fantrax'])

export function missingLineupsFlag(input: LineupsInput): HealthFlag {
  const es = isEs(input.language)
  const label = es ? 'Alineaciones incompletas' : 'Missing lineups'
  const platform = input.platform.trim().toLowerCase()
  if (LINEUP_UNKNOWABLE.has(platform)) {
    return {
      key: 'lineups',
      label,
      measured: false,
      reason: es
        ? `Las importaciones de ${platform === 'mfl' ? 'MFL' : 'Fantrax'} no indican si una alineación en blanco está vacía o simplemente no se reportó, así que aquí no se revisan las alineaciones.`
        : `${platform === 'mfl' ? 'MFL' : 'Fantrax'} imports don't say whether a blank lineup is empty or just not reported, so lineups aren't checked here.`,
      action: input.action,
    }
  }
  if (input.inSeason && input.stale) {
    return { key: 'lineups', label, measured: false, reason: input.stale.reason, action: input.stale.action }
  }
  if (!input.inSeason) {
    return {
      key: 'lineups',
      label,
      measured: false,
      reason: es ? 'Las alineaciones solo se revisan mientras se juega la temporada.' : 'Lineups are only checked while the season is being played.',
      action: null,
    }
  }

  const readable = input.rosters.filter(
    (r): r is { name: string; starters: unknown[] } => Array.isArray(r.starters) && r.starters.length > 0,
  )
  if (readable.length === 0) {
    return {
      key: 'lineups',
      label,
      measured: false,
      reason: es
        ? 'Ninguna plantilla de esta liga tiene todavía una alineación titular legible.'
        : 'No roster in this league has a readable starting lineup yet.',
      action: input.action,
    }
  }

  const holes = readable
    .map((r) => ({ name: r.name, empty: emptyStarterSlots(r.starters, input.requiredStarters ?? 0) }))
    .filter((r) => r.empty > 0)
    .sort((a, b) => b.empty - a.empty || a.name.localeCompare(b.name))

  const unread = input.rosters.length - readable.length
  const suffix =
    unread === 0
      ? ''
      : es
        ? ` ${plural(unread, 'plantilla', 'plantillas')} no se ${unread === 1 ? 'pudo' : 'pudieron'} leer y no ${unread === 1 ? 'cuenta' : 'cuentan'}.`
        : ` ${plural(unread, 'roster')} could not be read and ${unread === 1 ? 'is' : 'are'} not counted.`

  return {
    key: 'lineups',
    label,
    measured: true,
    severity: holes.length >= 2 ? 'bad' : holes.length === 1 ? 'warn' : 'good',
    count: holes.length,
    headline:
      holes.length === 0
        ? es
          ? 'Todas las alineaciones están completas'
          : 'Every lineup is full'
        : es
          ? `${plural(holes.length, 'equipo', 'equipos')} con un hueco en la alineación titular`
          : `${plural(holes.length, 'team')} starting with an empty slot`,
    detail:
      (holes.length === 0
        ? es
          ? readable.length === 1
            ? 'La única alineación legible tiene todos los puestos titulares cubiertos.'
            : `Las ${readable.length} alineaciones legibles tienen todos los puestos titulares cubiertos.`
          : `All ${readable.length} readable lineups have every starting slot filled.`
        : holes
            .slice(0, 4)
            .map((h) => (es ? `${h.name} (${plural(h.empty, 'hueco vacío', 'huecos vacíos')})` : `${h.name} (${plural(h.empty, 'empty slot')})`))
            .join(', ') +
          (holes.length > 4 ? (es ? ` y ${holes.length - 4} más.` : ` and ${holes.length - 4} more.`) : '.')) + suffix,
    names: holes.map((h) => h.name),
    action: holes.length > 0 ? input.action : null,
  }
}

// ── Unequal schedules ───────────────────────────────────────────────────────

export type ScheduleInput = {
  /** WeeklyMatchup rows for the current season. */
  games: Array<{ rosterId: string; week: number; matchupId: number | null }>
  /** Every roster id in the league, so a team with no games at all is still seen. */
  rosterIds: string[]
  teamName: (rosterId: string) => string
  /** Count games through this week (the league's latest played week). */
  throughWeek: number | null
  /** Guillotine / survivor formats are MEANT to leave teams with fewer games. */
  eliminationFormat: boolean
  action: HealthFlagAction | null
  language?: string
}

export function unequalSchedulesFlag(input: ScheduleInput): HealthFlag {
  const es = isEs(input.language)
  const label = es ? 'Calendarios desiguales' : 'Unequal schedules'
  if (input.eliminationFormat) {
    return {
      key: 'schedule',
      label,
      measured: false,
      reason: es
        ? 'Es un formato de eliminación, en el que los equipos eliminados dejan de jugar: que no todos tengan los mismos partidos es la regla funcionando.'
        : 'This is an elimination format, where eliminated teams stop playing — unequal game counts are the rules working.',
      action: null,
    }
  }
  if (input.games.length === 0 || input.throughWeek == null || input.throughWeek < 1) {
    return {
      key: 'schedule',
      label,
      measured: false,
      reason: es ? 'Aún no se ha importado ninguna semana jugada de esta temporada.' : 'No played weeks have been imported for this season yet.',
      action: null,
    }
  }

  const through = input.throughWeek
  const games = new Map<string, Set<number>>()
  for (const id of input.rosterIds) games.set(id, new Set())
  for (const g of input.games) {
    if (g.matchupId == null || g.week < 1 || g.week > through) continue
    const set = games.get(g.rosterId) ?? new Set<number>()
    set.add(g.week)
    games.set(g.rosterId, set)
  }

  const counts = [...games.entries()].map(([rosterId, weeks]) => ({ rosterId, n: weeks.size }))
  if (counts.length === 0) {
    return { key: 'schedule', label, measured: false, reason: es ? 'No hay equipos que comparar.' : 'No teams to compare.', action: null }
  }
  const most = Math.max(...counts.map((c) => c.n))
  const behind = counts
    .filter((c) => c.n < most)
    .map((c) => ({ name: input.teamName(c.rosterId), n: c.n }))
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))

  return {
    key: 'schedule',
    label,
    measured: true,
    severity: behind.length > 0 ? 'warn' : 'good',
    count: behind.length,
    headline:
      behind.length === 0
        ? es
          ? `Todos han jugado ${plural(most, 'partido', 'partidos')}`
          : `Everyone has played ${plural(most, 'game')}`
        : es
          ? `${plural(behind.length, 'equipo', 'equipos')} con partidos de menos`
          : `${plural(behind.length, 'team')} behind on games`,
    detail:
      behind.length === 0
        ? es
          ? through === 1
            ? 'Todos los equipos tienen un enfrentamiento en la semana 1.'
            : `Todos los equipos tienen un enfrentamiento en cada una de las semanas 1–${through}.`
          : `Every team has a matchup in each of weeks 1–${through}.`
        : es
          ? `La mayoría de los equipos tiene ${plural(most, 'partido', 'partidos')} hasta la semana ${through}; ${behind
              .slice(0, 4)
              .map((b) => `${b.name} tiene ${b.n}`)
              .join(', ')}${behind.length > 4 ? ` y ${behind.length - 4} más` : ''}.`
          : `Most teams have ${plural(most, 'game')} through week ${through}; ${behind
              .slice(0, 4)
              .map((b) => `${b.name} has ${b.n}`)
              .join(', ')}${behind.length > 4 ? ` and ${behind.length - 4} more` : ''}.`,
    names: behind.map((b) => b.name),
    action: behind.length > 0 ? input.action : null,
  }
}

// ── Unpaid dues ─────────────────────────────────────────────────────────────

export type DuesTracker = {
  enabled: boolean
  amount: number | null
  currency: string
  paymentLink: string | null
  paymentProvider: string | null
  entries: Array<{ teamId: string; paid: boolean }>
}

/**
 * Reads `League.settings.dues_tracker`, the blob the dues route writes.
 * Anything malformed reads as "not tracked" rather than throwing — the source is
 * JSON a person edited.
 */
export function readDuesTracker(settings: unknown): DuesTracker | null {
  if (!settings || typeof settings !== 'object') return null
  const raw = (settings as Record<string, unknown>).dues_tracker
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const entries = Array.isArray(d.entries)
    ? d.entries.flatMap((e) => {
        if (!e || typeof e !== 'object') return []
        const row = e as Record<string, unknown>
        return typeof row.teamId === 'string' ? [{ teamId: row.teamId, paid: row.paid === true }] : []
      })
    : []
  const link = typeof d.paymentLink === 'string' ? d.paymentLink.trim() : ''
  return {
    enabled: d.enabled === true,
    amount: typeof d.amount === 'number' && Number.isFinite(d.amount) ? d.amount : null,
    currency: typeof d.currency === 'string' && d.currency ? d.currency : 'USD',
    // Only a real https link is ever rendered as one. The value is commissioner-typed.
    paymentLink: /^https:\/\//i.test(link) ? link : null,
    paymentProvider: typeof d.paymentProvider === 'string' ? d.paymentProvider : null,
    entries,
  }
}

export type DuesInput = {
  tracker: DuesTracker | null
  /** `LeagueTeam.id` + display name — the dues entries key on the team row id. */
  teams: Array<{ id: string; name: string }>
  action: HealthFlagAction | null
  language?: string
}

export function unpaidDuesFlag(input: DuesInput): HealthFlag {
  const es = isEs(input.language)
  const label = es ? 'Cuotas sin pagar' : 'Unpaid dues'
  const t = input.tracker
  if (!t || !t.enabled) {
    return {
      key: 'dues',
      label,
      measured: false,
      reason: es
        ? 'Las cuotas de esta liga no se registran en AllFantasy, así que nadie puede considerarse al día ni pendiente.'
        : 'Dues aren’t tracked in AllFantasy for this league, so nobody can be called paid or unpaid.',
      action: input.action ? { ...input.action, label: es ? 'Configurar el control de cuotas' : 'Set up dues tracking' } : null,
    }
  }
  if (input.teams.length === 0) {
    return { key: 'dues', label, measured: false, reason: es ? 'Aún no se ha importado ningún equipo.' : 'No teams have been imported yet.', action: null }
  }

  const paid = new Set(t.entries.filter((e) => e.paid).map((e) => e.teamId))
  const unpaid = input.teams.filter((team) => !paid.has(team.id)).map((team) => team.name)
  const amount = t.amount != null ? `${es ? ' de' : ' of'} ${formatMoney(t.amount, t.currency)}` : ''

  return {
    key: 'dues',
    label,
    measured: true,
    severity: unpaid.length > 0 ? 'warn' : 'good',
    count: unpaid.length,
    headline:
      unpaid.length === 0
        ? es
          ? 'Todos han pagado'
          : 'Everyone has paid'
        : es
          ? `${plural(unpaid.length, 'equipo', 'equipos')} ${unpaid.length === 1 ? 'debe' : 'deben'} la cuota${amount}`
          : `${plural(unpaid.length, 'team')} still owe${unpaid.length === 1 ? 's' : ''} dues${amount}`,
    detail:
      unpaid.length === 0
        ? es
          ? input.teams.length === 1
            ? 'El único equipo figura como pagado en el control de cuotas.'
            : `Los ${input.teams.length} equipos figuran como pagados en el control de cuotas.`
          : `All ${input.teams.length} teams are marked paid in the dues tracker.`
        : es
          ? `${namesPreview(unpaid, 4, 'es')}. Se marca a mano en el control de cuotas: AllFantasy no ve el pago en sí.`
          : `${namesPreview(unpaid)}. Marked by hand in the dues tracker — AllFantasy does not see the payment itself.`,
    names: unpaid,
    action: unpaid.length > 0 ? input.action : null,
  }
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

// ── Unresolved votes ────────────────────────────────────────────────────────

export type LeaguePoll = ViewerPoll & { id: string; postedAt: string }

export type VotesInput = {
  polls: LeaguePoll[] | null
  now: Date
  action: HealthFlagAction | null
  language?: string
}

export function openPolls(polls: LeaguePoll[], now: Date): LeaguePoll[] {
  return polls
    .filter((p) => !isPollClosed(p, now.getTime()))
    .sort((a, b) => {
      const at = a.closesAt ? Date.parse(a.closesAt) : Number.MAX_SAFE_INTEGER
      const bt = b.closesAt ? Date.parse(b.closesAt) : Number.MAX_SAFE_INTEGER
      return at - bt
    })
}

export function unresolvedVotesFlag(input: VotesInput): HealthFlag {
  const es = isEs(input.language)
  const label = es ? 'Votaciones abiertas' : 'Unresolved votes'
  if (input.polls == null) {
    return {
      key: 'votes',
      label,
      measured: false,
      reason: es ? 'No se pudieron leer las encuestas del chat de la liga en este momento.' : 'League chat polls could not be read just now.',
      action: input.action,
    }
  }
  const open = openPolls(input.polls, input.now)
  const soon = open.filter(
    (p) => p.closesAt && Date.parse(p.closesAt) - input.now.getTime() < 24 * 60 * 60 * 1000,
  )
  /*
   * A poll with no deadline never closes on its own. Past a week it is a
   * question the league asked and nobody answered — worth a nudge, and the
   * reason it counts as unresolved rather than merely open.
   */
  const stale = open.filter(
    (p) => !p.closesAt && input.now.getTime() - Date.parse(p.postedAt) > 7 * 24 * 60 * 60 * 1000,
  )

  return {
    key: 'votes',
    label,
    measured: true,
    severity: soon.length > 0 || stale.length > 0 ? 'warn' : 'good',
    count: open.length,
    headline:
      open.length === 0
        ? es
          ? 'No hay votaciones abiertas'
          : 'No open votes'
        : es
          ? plural(open.length, 'votación de la liga sigue abierta', 'votaciones de la liga siguen abiertas')
          : `${plural(open.length, 'league vote')} still open`,
    detail:
      open.length === 0
        ? es
          ? 'Todas las encuestas del chat de la liga se han cerrado. Las votaciones hechas en la propia plataforma no se importan.'
          : 'Every league-chat poll has closed. Votes held on the platform itself are not imported.'
        : open
            .slice(0, 3)
            .map((p) =>
              p.closesAt
                ? es
                  ? `“${p.question}” cierra el ${new Date(p.closesAt).toLocaleDateString('es', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
                  : `“${p.question}” closes ${new Date(p.closesAt).toUTCString().slice(0, 16)}`
                : es
                  ? `“${p.question}” no tiene fecha límite`
                  : `“${p.question}” has no deadline`,
            )
            .join('; ') + (open.length > 3 ? (es ? `; y ${open.length - 3} más.` : `; and ${open.length - 3} more.`) : '.'),
    names: open.map((p) => p.question),
    action: open.length > 0 ? input.action : null,
  }
}

/** Flags that need a commissioner, worst first — the order the hub lists them in. */
export function rankFlags(flags: HealthFlag[]): HealthFlag[] {
  const weight = (f: HealthFlag) => (!f.measured ? 3 : f.severity === 'bad' ? 0 : f.severity === 'warn' ? 1 : 2)
  return [...flags].sort((a, b) => weight(a) - weight(b))
}
