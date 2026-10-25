/**
 * The league log (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, "Audit log"): every commissioner
 * action, written in plain words, readable by the whole league unless the commissioner sets it to
 * "commish only". Free for every league. Rows come from `LeagueAuditLog`.
 *
 * ⚠ MEMBERS SEE THE SENTENCE, NEVER THE ROW. An audit row's before/after state can carry things the
 * league must not see (a sealed draw, a co-commissioner's scopes, a dispute's private text). So a
 * member gets only the line `describeLogEntry` builds from the few fields it names, and only for the
 * action types listed in `LOG_ACTIONS` with `members: true`. Anything else — automation runs, system
 * jobs, types added later — reaches commissioners only, until someone decides how to word it here.
 *
 * Pure.
 */

export const LEAGUE_LOG_VISIBILITY_KEY = 'league_log_visibility'
export type LeagueLogVisibility = 'league' | 'commish_only'
export const DEFAULT_LEAGUE_LOG_VISIBILITY: LeagueLogVisibility = 'league'

export function readLeagueLogVisibility(settings: unknown): LeagueLogVisibility {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  return s[LEAGUE_LOG_VISIBILITY_KEY] === 'commish_only' ? 'commish_only' : DEFAULT_LEAGUE_LOG_VISIBILITY
}

/** Validate a save; unknown values are refused rather than read as the default. */
export function parseLeagueLogVisibility(value: unknown): { ok: true; value: LeagueLogVisibility } | { ok: false; error: string } {
  if (value === 'league' || value === 'commish_only') return { ok: true, value }
  return { ok: false, error: 'The league log is either visible to the league or commish only.' }
}

export type LogLang = 'en' | 'es'
export type LogCategory = 'settings' | 'scoring' | 'rosters' | 'rulings' | 'money' | 'draft' | 'league'

export const LOG_CATEGORY_LABELS: Record<LogCategory, { en: string; es: string }> = {
  settings: { en: 'Settings', es: 'Ajustes' },
  scoring: { en: 'Scores & standings', es: 'Puntos y clasificación' },
  rosters: { en: 'Rosters & waivers', es: 'Plantillas y reclamos' },
  rulings: { en: 'Rulings', es: 'Decisiones' },
  money: { en: 'Dues', es: 'Cuotas' },
  draft: { en: 'Draft', es: 'Draft' },
  league: { en: 'League', es: 'Liga' },
}

/** The slice of a `LeagueAuditLog` row the log reads. */
export type AuditRow = {
  id: string
  actionType: string
  entityId: string | null
  userId: string | null
  beforeState: unknown
  afterState: unknown
  metadata: unknown
  createdAt: Date | string
}

/** Names the service looked up: app users by id, teams by roster id. */
export type LogNames = { users: Record<string, string>; teams: Record<string, string> }

type Ctx = { row: AuditRow; lang: LogLang; names: LogNames }
type Line = { en: string; es: string }

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function signed(n: number): string {
  const r = Math.round(n * 100) / 100
  return r > 0 ? `+${r}` : String(r)
}
function team(ctx: Ctx, rosterId: unknown): Line {
  const id = str(rosterId)
  const name = id ? ctx.names.teams[id] : undefined
  return name ? { en: name, es: name } : { en: 'a team', es: 'un equipo' }
}
function member(ctx: Ctx, userId: unknown): Line {
  const id = str(userId)
  const name = id ? ctx.names.users[id] : undefined
  return name ? { en: name, es: name } : { en: 'a manager', es: 'un mánager' }
}

const SECTION_LABELS: Record<string, Line> = {
  general: { en: 'general', es: 'generales' },
  scoring: { en: 'scoring', es: 'puntuación' },
  roster: { en: 'roster', es: 'plantilla' },
  draft: { en: 'draft', es: 'draft' },
  waivers: { en: 'waiver', es: 'reclamos' },
  trades: { en: 'trade', es: 'traspasos' },
  playoffs: { en: 'playoff', es: 'playoffs' },
  commissioner: { en: 'commissioner', es: 'comisionado' },
  conceptRules: { en: 'format', es: 'formato' },
  ai: { en: 'AI', es: 'IA' },
}

type Action = {
  category: LogCategory
  /** Shown to members when the log is visible to the league. */
  members: boolean
  line: (ctx: Ctx) => Line & { detailEn?: string | null; detailEs?: string | null }
}

/**
 * Every action type the log knows how to word. A row whose type is missing here is still shown to
 * commissioners, as its raw type.
 */
export const LOG_ACTIONS: Record<string, Action> = {
  settings_patch: {
    category: 'settings',
    members: true,
    line: (ctx) => {
      const section = str(obj(ctx.row.metadata).section)
      const label = section ? SECTION_LABELS[section] : undefined
      return label
        ? { en: `Changed the ${label.en} settings`, es: `Cambió los ajustes de ${label.es}` }
        : { en: 'Changed the league settings', es: 'Cambió los ajustes de la liga' }
    },
  },
  settings_mid_season_change: {
    category: 'settings',
    members: true,
    line: (ctx) => {
      const section = str(obj(ctx.row.metadata).section)
      return section === 'scoring'
        ? { en: 'Changed the scoring rules mid-season', es: 'Cambió la puntuación a mitad de temporada' }
        : { en: 'Changed the roster settings mid-season', es: 'Cambió la plantilla a mitad de temporada' }
    },
  },
  settings_lock_changed: {
    category: 'settings',
    members: true,
    line: (ctx) => {
      const m = obj(ctx.row.metadata)
      const added = Array.isArray(m.added) ? m.added.length : 0
      const removed = Array.isArray(m.removed) ? m.removed.length : 0
      if (added && !removed) return { en: 'Locked settings for the season', es: 'Bloqueó ajustes para la temporada' }
      if (removed && !added) return { en: 'Unlocked settings', es: 'Desbloqueó ajustes' }
      return { en: 'Changed which settings are locked', es: 'Cambió qué ajustes están bloqueados' }
    },
  },
  settings_unlock_vote_started: {
    category: 'settings',
    members: true,
    line: () => ({ en: 'Started a league vote to unlock settings', es: 'Abrió una votación para desbloquear ajustes' }),
  },
  settings_unlock_vote_passed: {
    category: 'settings',
    members: true,
    line: () => ({ en: 'The vote to unlock settings passed', es: 'La votación para desbloquear ajustes se aprobó' }),
  },
  settings_unlock_vote_failed: {
    category: 'settings',
    members: true,
    line: () => ({ en: 'The vote to unlock settings failed', es: 'La votación para desbloquear ajustes no se aprobó' }),
  },
  // Written by the stat-correction review (lib/stat-corrections): a re-check of a sealed week found
  // corrected stats. Nothing was applied, so it is the commissioner's to act on, not the league's news.
  stat_correction_detected: {
    category: 'scoring',
    members: false,
    line: (ctx) => {
      const m = obj(ctx.row.metadata)
      const week = num(m.week)
      const flipped = num(m.flipped) ?? 0
      const changes = obj(ctx.row.afterState).changes
      const n = Array.isArray(changes) ? changes.length : null
      const wk = { en: week != null ? ` for week ${week}` : '', es: week != null ? ` de la semana ${week}` : '' }
      const players = { en: n != null ? `: ${n} player${n === 1 ? '' : 's'} changed` : '', es: n != null ? `: ${n} jugador${n === 1 ? '' : 'es'} con cambios` : '' }
      return {
        en: `Stat corrections found${wk.en}${players.en}`,
        es: `Se encontraron correcciones de estadísticas${wk.es}${players.es}`,
        detailEn: flipped ? `${flipped} result${flipped === 1 ? '' : 's'} would change. Nothing was applied.` : 'No result would change. Nothing was applied.',
        detailEs: flipped ? `Cambiaría${flipped === 1 ? '' : 'n'} ${flipped} resultado${flipped === 1 ? '' : 's'}. No se aplicó nada.` : 'Ningún resultado cambiaría. No se aplicó nada.',
      }
    },
  },
  score_adjustment_added: {
    category: 'scoring',
    members: true,
    line: (ctx) => {
      const m = obj(ctx.row.metadata)
      const a = obj(ctx.row.afterState)
      const pts = num(a.points)
      const week = num(m.week)
      const t = team(ctx, m.rosterId)
      const reason = str(a.reason)
      return {
        en: `Adjusted ${t.en}'s score${pts != null ? ` by ${signed(pts)}` : ''}${week != null ? ` in week ${week}` : ''}`,
        es: `Ajustó los puntos de ${t.es}${pts != null ? ` en ${signed(pts)}` : ''}${week != null ? ` en la semana ${week}` : ''}`,
        detailEn: reason,
        detailEs: reason,
      }
    },
  },
  score_adjustment_removed: {
    category: 'scoring',
    members: true,
    line: (ctx) => {
      const m = obj(ctx.row.metadata)
      const week = num(m.week)
      const t = team(ctx, m.rosterId)
      return {
        en: `Removed a score adjustment for ${t.en}${week != null ? ` in week ${week}` : ''}`,
        es: `Quitó un ajuste de puntos de ${t.es}${week != null ? ` en la semana ${week}` : ''}`,
      }
    },
  },
  commissioner_edit_standings: {
    category: 'scoring',
    members: true,
    line: () => ({ en: 'Edited the standings', es: 'Editó la clasificación' }),
  },
  // An undo of one of the edits above (lib/commissioner-undo). Members saw the edit, so they see it taken back.
  commissioner_undo: {
    category: 'league',
    members: true,
    line: (ctx) => {
      const m = obj(ctx.row.metadata)
      const t = team(ctx, m.rosterId)
      switch (str(m.undoneActionType)) {
        case 'commissioner_edit_faab':
          return { en: `Undid the FAAB change for ${t.en}`, es: `Deshizo el cambio de FAAB de ${t.es}` }
        case 'commissioner_edit_waiver_priority':
          return { en: `Undid the waiver priority change for ${t.en}`, es: `Deshizo el cambio de prioridad de reclamos de ${t.es}` }
        case 'commissioner_edit_standings':
          return { en: 'Undid a standings edit', es: 'Deshizo una edición de la clasificación' }
        default:
          return { en: 'Undid a commissioner change', es: 'Deshizo un cambio del comisionado' }
      }
    },
  },
  commissioner_recompute_standings: {
    category: 'scoring',
    members: true,
    line: () => ({ en: 'Recalculated the standings', es: 'Recalculó la clasificación' }),
  },
  dispute_ruled: {
    category: 'rulings',
    members: true,
    // The ruling itself is posted to league chat; the log records that one was made, not the case.
    line: () => ({ en: 'Ruled on a dispute', es: 'Resolvió una disputa' }),
  },
  commissioner_roster_override: {
    category: 'rosters',
    members: true,
    line: (ctx) => {
      const t = team(ctx, ctx.row.entityId)
      return { en: `Changed ${t.en}'s roster`, es: `Cambió la plantilla de ${t.es}` }
    },
  },
  waiver_claim_commissioner_override: {
    category: 'rosters',
    members: true,
    line: () => ({ en: 'Overrode a waiver claim', es: 'Anuló un reclamo' }),
  },
  commissioner_run_waivers: {
    category: 'rosters',
    members: true,
    line: () => ({ en: 'Ran waivers by hand', es: 'Procesó los reclamos a mano' }),
  },
  commissioner_edit_faab: {
    category: 'rosters',
    members: true,
    line: (ctx) => {
      const t = team(ctx, ctx.row.entityId)
      const v = num(obj(ctx.row.afterState).faabRemaining)
      return {
        en: `Set ${t.en}'s FAAB${v != null ? ` to $${v}` : ''}`,
        es: `Fijó el FAAB de ${t.es}${v != null ? ` en $${v}` : ''}`,
      }
    },
  },
  commissioner_edit_waiver_priority: {
    category: 'rosters',
    members: true,
    line: (ctx) => {
      const t = team(ctx, ctx.row.entityId)
      const v = num(obj(ctx.row.afterState).waiverPriority)
      return {
        en: `Set ${t.en}'s waiver priority${v != null ? ` to ${v}` : ''}`,
        es: `Fijó la prioridad de reclamos de ${t.es}${v != null ? ` en ${v}` : ''}`,
      }
    },
  },
  // Inactive manager mode (lib/inactive-manager): the league should know who is setting a team's lineup.
  'inactive_manager_mode.on': {
    category: 'rosters',
    members: true,
    line: (ctx) => {
      const t = team(ctx, ctx.row.entityId)
      return { en: `AllFantasy now sets ${t.en}'s best lineup each week while the manager is away`, es: `AllFantasy ahora pone la mejor alineación de ${t.es} cada semana mientras el mánager no está` }
    },
  },
  'inactive_manager_mode.off': {
    category: 'rosters',
    members: true,
    line: (ctx) => {
      const t = team(ctx, ctx.row.entityId)
      return { en: `AllFantasy stopped setting ${t.en}'s lineup`, es: `AllFantasy dejó de poner la alineación de ${t.es}` }
    },
  },
  'inactive_manager_mode.ended': {
    category: 'rosters',
    members: true,
    line: (ctx) => {
      const t = team(ctx, ctx.row.entityId)
      return { en: `${t.en}'s manager is back and set their own lineup, so AllFantasy stopped`, es: `El mánager de ${t.es} volvió y puso su alineación, así que AllFantasy se detuvo` }
    },
  },
  'native_autosubs.policy_changed': {
    category: 'rosters',
    members: true,
    line: (ctx) =>
      obj(ctx.row.afterState).enabled === true
        ? { en: 'Turned on auto-subs', es: 'Activó los cambios automáticos' }
        : { en: 'Turned off auto-subs', es: 'Desactivó los cambios automáticos' },
  },
  commissioner_undo_draft_pick: {
    category: 'draft',
    members: true,
    line: () => ({ en: 'Undid the last draft pick', es: 'Deshizo la última elección del draft' }),
  },
  league_lock_toggle: {
    category: 'league',
    members: true,
    line: (ctx) =>
      obj(ctx.row.afterState).locked === true
        ? { en: 'Locked the league', es: 'Bloqueó la liga' }
        : { en: 'Unlocked the league', es: 'Desbloqueó la liga' },
  },
  emergency_pause_toggle: {
    category: 'league',
    members: true,
    line: (ctx) =>
      obj(ctx.row.afterState).emergencyPaused === true
        ? { en: 'Paused the league', es: 'Pausó la liga' }
        : { en: 'Resumed the league', es: 'Reanudó la liga' },
  },
  weekly_recap_review_set: {
    category: 'league',
    members: true,
    line: (ctx) =>
      obj(ctx.row.afterState).mode === 'review'
        ? { en: 'Set the weekly recap to be reviewed before it posts', es: 'Hizo que el resumen semanal se revise antes de publicarse' }
        : { en: 'Set the weekly recap to post on its own', es: 'Hizo que el resumen semanal se publique solo' },
  },
  finance_settings_edit: {
    category: 'money',
    members: true,
    line: () => ({ en: 'Changed the dues settings', es: 'Cambió los ajustes de cuotas' }),
  },
  finance_dues_manual: {
    category: 'money',
    members: true,
    // Who paid, not how much: the amount stays with the dues tracker.
    line: (ctx) => {
      const who = member(ctx, obj(ctx.row.afterState).targetUserId)
      return { en: `Marked ${who.en}'s dues as paid`, es: `Marcó como pagada la cuota de ${who.es}` }
    },
  },
  finance_dues_waived: {
    category: 'money',
    members: true,
    line: (ctx) => {
      const who = member(ctx, obj(ctx.row.afterState).targetUserId)
      return { en: `Waived ${who.en}'s dues`, es: `Eximió de la cuota a ${who.es}` }
    },
  },
}

/** Action types a member may read, when the log is visible to the league. */
export const MEMBER_LOG_ACTION_TYPES: readonly string[] = Object.entries(LOG_ACTIONS)
  .filter(([, a]) => a.members)
  .map(([type]) => type)

export type LeagueLogEntry = {
  id: string
  at: string
  actor: string
  category: LogCategory | null
  title: string
  detail: string | null
  /** Commissioners only: the action type and the row's states, for the cases the sentence leaves out. */
  raw?: { actionType: string; beforeState: unknown; afterState: unknown; metadata: unknown }
  /** Commissioners only, on an action that can be undone (lib/commissioner-undo): whether it still can, and why not. */
  undo?: { available: boolean; reason: string | null }
}

/**
 * One row as a log line. `forCommissioner` adds the raw row and words unknown types by their name;
 * for a member, a type that is not member-visible returns null (the service never asks, but this is
 * the second lock on the same door).
 */
export function describeLogEntry(row: AuditRow, opts: { lang: LogLang; names: LogNames; forCommissioner: boolean }): LeagueLogEntry | null {
  const action = LOG_ACTIONS[row.actionType]
  if (!opts.forCommissioner && !action?.members) return null
  const at = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt)
  const actor = row.userId
    ? opts.names.users[row.userId] ?? (opts.lang === 'es' ? 'Un comisionado' : 'A commissioner')
    : opts.lang === 'es' ? 'AllFantasy (automático)' : 'AllFantasy (automatic)'
  let title: string
  let detail: string | null = null
  if (action) {
    const l = action.line({ row, lang: opts.lang, names: opts.names })
    title = opts.lang === 'es' ? l.es : l.en
    detail = (opts.lang === 'es' ? l.detailEs : l.detailEn) ?? null
  } else {
    title = row.actionType.replace(/[._]+/g, ' ')
  }
  const entry: LeagueLogEntry = { id: row.id, at, actor, category: action?.category ?? null, title, detail }
  if (opts.forCommissioner) {
    entry.raw = { actionType: row.actionType, beforeState: row.beforeState, afterState: row.afterState, metadata: row.metadata }
  }
  return entry
}

/** Roster ids a set of rows names, so the service can look their team names up in one query. */
export function rosterIdsNamedBy(rows: readonly AuditRow[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    const m = obj(row.metadata)
    if ((row.actionType.startsWith('score_adjustment_') || row.actionType === 'commissioner_undo') && str(m.rosterId)) ids.add(str(m.rosterId)!)
    if (
      (row.actionType === 'commissioner_roster_override' ||
        row.actionType === 'commissioner_edit_faab' ||
        row.actionType === 'commissioner_edit_waiver_priority' ||
        row.actionType.startsWith('inactive_manager_mode.')) &&
      str(row.entityId)
    ) {
      ids.add(str(row.entityId)!)
    }
  }
  return [...ids]
}

/** App users a set of rows names: the actors and the members a dues line is about. */
export function userIdsNamedBy(rows: readonly AuditRow[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.userId) ids.add(row.userId)
    if (row.actionType === 'finance_dues_manual' || row.actionType === 'finance_dues_waived') {
      const t = str(obj(row.afterState).targetUserId)
      if (t) ids.add(t)
    }
  }
  return [...ids]
}
