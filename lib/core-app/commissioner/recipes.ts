/**
 * Commissioner Hub — automation recipes (brief item 8).
 *
 * Five recipes a commissioner can switch on per league: lineup reminders, the
 * weekly recap, inactivity warnings, voting-deadline reminders and the playoff
 * announcement. Each posts ONE message into the league's own chat, where every
 * member already gets it by their own notification settings.
 *
 * ── Where the switches live ──────────────────────────────────────────────
 *
 * `League.settings.commissionerRecipes`, written through the existing
 * `PATCH /api/league/settings` `settingsMerge` path. That route is already
 * commissioner-gated (`requireCommissionerRole`, which admits co-commissioners)
 * and already writes a `settings_patch` audit row, so turning a recipe on shows
 * up in the hub's own timeline. No migration and no new route.
 *
 * ⚠ KNOWN RISK, RECORDED RATHER THAN HIDDEN: a forced re-import rebuilds
 * `League.settings` from the provider payload
 * (`ImportedLeagueCommitService.ts`, the `settingsJson` write) and drops every
 * key AllFantasy added — this one, `publicStandings` and the dues tracker alike.
 * A re-import therefore switches recipes back to their defaults. That bug is
 * tracked separately; the defaults below are chosen so the reset is the quiet
 * direction (everything off except the recap, which already runs today).
 *
 * ── What actually sends ──────────────────────────────────────────────────
 *
 * The weekly recap already runs for every Sleeper league (`/api/cron/weekly-awards`,
 * Tuesdays, no opt-in). Its switch here is an OPT-OUT that route now honours; it
 * defaults on for Sleeper. Native leagues can opt in; their recap reads finalized
 * AllFantasy matchups from the same Tuesday cron.
 *
 * The other four are sent by `runCommissionerRecipes`, riding the daily
 * `/api/cron/commissioner-workspace-refresh` fire. That sender is OFF until the
 * `commissioner_recipes_send_enabled` platform toggle is set — saving a switch
 * here never posts anything by itself, and the screen says so while it is off.
 *
 * Client-safe: no Prisma. `dueRecipeMessages` is the whole decision of what to
 * post; the job only reads rows and writes the messages it returns.
 */

export type RecipeKey = 'lineupReminder' | 'weeklyRecap' | 'inactivityWarning' | 'votingDeadline' | 'playoffAnnouncement'

export const RECIPE_KEYS: RecipeKey[] = [
  'lineupReminder',
  'weeklyRecap',
  'inactivityWarning',
  'votingDeadline',
  'playoffAnnouncement',
]

export const RECIPES_SEND_TOGGLE = 'commissioner_recipes_send_enabled'
export const RECIPES_JOB_TYPE = 'commissioner.recipes'

export type RecipeDefinition = {
  key: RecipeKey
  label: string
  description: string
  cadence: string
  /** Null when the recipe works for this league; otherwise why it cannot. */
  unavailableReason: (league: { platform: string; sport: string }) => string | null
}

const nflOnly = (league: { sport: string }) =>
  league.sport.toUpperCase() === 'NFL' ? null : 'Game-day timing is only known for NFL leagues today.'

export const RECIPES: RecipeDefinition[] = [
  {
    key: 'lineupReminder',
    label: 'Lineup reminders',
    description: 'On each NFL game day, a morning post naming teams with an empty starting slot.',
    cadence: 'Game days, early morning ET',
    unavailableReason: (league) => {
      const p = league.platform.toLowerCase()
      if (p === 'mfl' || p === 'fantrax') {
        return `${p === 'mfl' ? 'MFL' : 'Fantrax'} imports can’t tell an empty lineup from an unreported one.`
      }
      return nflOnly(league)
    },
  },
  {
    key: 'weeklyRecap',
    label: 'Weekly recap',
    description: 'Results, the top of the table and the week’s awards, counted from real matchups.',
    cadence: 'Tuesdays',
    unavailableReason: (league) => {
      const platform = league.platform.toLowerCase()
      return platform === 'sleeper' || ['manual', 'allfantasy', 'af', 'native'].includes(platform)
        ? null
        : 'Weekly recaps require a Sleeper week feed or finalized AllFantasy matchups.'
    },
  },
  {
    key: 'inactivityWarning',
    label: 'Inactivity warnings',
    description: 'A friendly weekly check-in naming managers with no trade, waiver claim or roster move in 14 days.',
    cadence: 'Once a week at most',
    unavailableReason: () => null,
  },
  {
    key: 'votingDeadline',
    label: 'Voting deadlines',
    description: 'A reminder when a league-chat poll closes within the next day.',
    cadence: 'The day before a poll closes',
    unavailableReason: () => null,
  },
  {
    key: 'playoffAnnouncement',
    label: 'Playoff announcement',
    description: 'When playoffs begin, a post with the seeds as the standings have them.',
    cadence: 'Once a season',
    unavailableReason: (league) => nflOnly(league),
  },
]

/**
 * The catalog's words in Spanish (2026-10-05), for the hub's Automations section. `RECIPES` itself stays
 * English: the recipes job reads it, and the posts it writes into league CHAT are league content, not
 * this reader's UI — they are deliberately left as written. Only the catalog the hub shows is worded.
 */
const RECIPE_COPY_ES: Record<RecipeKey, { label: string; description: string; cadence: string }> = {
  lineupReminder: {
    label: 'Recordatorios de alineación',
    description: 'Cada día de partido de la NFL, una publicación por la mañana que nombra a los equipos con un puesto titular vacío.',
    cadence: 'Días de partido, temprano por la mañana (ET)',
  },
  weeklyRecap: {
    label: 'Resumen semanal',
    description: 'Resultados, lo más alto de la tabla y los premios de la semana, calculados con los enfrentamientos reales.',
    cadence: 'Los martes',
  },
  inactivityWarning: {
    label: 'Avisos de inactividad',
    description: 'Un aviso semanal amistoso que nombra a los mánagers sin intercambios, solicitudes ni cambios de plantilla en 14 días.',
    cadence: 'Como mucho una vez por semana',
  },
  votingDeadline: {
    label: 'Fechas límite de votación',
    description: 'Un recordatorio cuando una encuesta del chat de la liga cierra en el próximo día.',
    cadence: 'El día antes de que cierre una encuesta',
  },
  playoffAnnouncement: {
    label: 'Anuncio de playoffs',
    description: 'Cuando empiezan los playoffs, una publicación con los cabezas de serie según la clasificación.',
    cadence: 'Una vez por temporada',
  },
}

const UNAVAILABLE_ES: Record<string, string> = {
  'Game-day timing is only known for NFL leagues today.': 'Por ahora solo se conoce el horario de los días de partido en las ligas de la NFL.',
  'MFL imports can’t tell an empty lineup from an unreported one.': 'Las importaciones de MFL no distinguen una alineación vacía de una no reportada.',
  'Fantrax imports can’t tell an empty lineup from an unreported one.': 'Las importaciones de Fantrax no distinguen una alineación vacía de una no reportada.',
  'Weekly recaps require a Sleeper week feed or finalized AllFantasy matchups.': 'Los resúmenes semanales necesitan los datos semanales de Sleeper o enfrentamientos finalizados de AllFantasy.',
}

/** One recipe as the hub's catalog shows it, in the reader's language (default English). */
export function recipeCatalogEntry(
  recipe: RecipeDefinition,
  league: { platform: string; sport: string },
  language = 'en',
): { key: RecipeKey; label: string; description: string; cadence: string; unavailable: string | null } {
  const unavailable = recipe.unavailableReason(league)
  const es = language === 'es'
  const copy = es ? RECIPE_COPY_ES[recipe.key] : recipe
  return {
    key: recipe.key,
    label: copy.label,
    description: copy.description,
    cadence: copy.cadence,
    // A reason with no Spanish stays whole English rather than vanishing.
    unavailable: unavailable == null ? null : es ? (UNAVAILABLE_ES[unavailable] ?? unavailable) : unavailable,
  }
}

export type RecipeSettings = {
  values: Record<RecipeKey, boolean>
  /** False when nothing has ever been saved — the values are the defaults. */
  saved: boolean
  updatedAt: string | null
}

export function defaultRecipeValue(key: RecipeKey, platform: string): boolean {
  // The recap already runs for Sleeper leagues; defaulting it off would silently stop it.
  return key === 'weeklyRecap' && platform.toLowerCase() === 'sleeper'
}

export function readRecipeSettings(settings: unknown, platform: string): RecipeSettings {
  const bag = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const raw = bag.commissionerRecipes && typeof bag.commissionerRecipes === 'object'
    ? (bag.commissionerRecipes as Record<string, unknown>)
    : null
  const stored = raw?.recipes && typeof raw.recipes === 'object' ? (raw.recipes as Record<string, unknown>) : {}
  const values = {} as Record<RecipeKey, boolean>
  for (const key of RECIPE_KEYS) {
    values[key] = typeof stored[key] === 'boolean' ? (stored[key] as boolean) : defaultRecipeValue(key, platform)
  }
  return {
    values,
    saved: raw != null,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
  }
}

/**
 * The whole `commissionerRecipes` object to send as a `settingsMerge`.
 *
 * ⚠ ALWAYS THE WHOLE OBJECT. `settingsMerge` merges one level deep, so sending
 * `{ commissionerRecipes: { recipes: { lineupReminder: true } } }` would replace
 * the stored `recipes` with that single key and silently switch the others back
 * to their defaults.
 *
 * `active` exists so the daily job can find leagues with ANY sender-run recipe
 * on in one indexed JSON-path query, instead of reading every league's settings.
 */
export function buildRecipeSettingsMerge(
  current: Record<RecipeKey, boolean>,
  change: { key: RecipeKey; enabled: boolean },
  now: Date,
): { commissionerRecipes: { version: 1; recipes: Record<RecipeKey, boolean>; active: boolean; updatedAt: string } } {
  const recipes = { ...current, [change.key]: change.enabled }
  const active = RECIPE_KEYS.some((k) => k !== 'weeklyRecap' && recipes[k])
  return { commissionerRecipes: { version: 1, recipes, active, updatedAt: now.toISOString() } }
}

/** Whether the weekly-awards cron may post to this league. */
export function weeklyRecapAllowed(settings: unknown, platform: string): boolean {
  return readRecipeSettings(settings, platform).values.weeklyRecap
}

// ── What is due ─────────────────────────────────────────────────────────────

export type RecipeFacts = {
  now: Date
  leagueName: string
  sport: string
  platform: string
  /** pre_draft | drafting | in_season | complete */
  status: string | null
  season: number | null
  currentWeek: number | null
  playoffStartWeek: number | null
  playoffSpots: number | null
  /** NFL regular-season kickoffs for the league's season. */
  kickoffs: Date[]
  emptyLineups: Array<{ name: string; empty: number }>
  inactiveTeams: string[]
  /**
   * True when an imported league has not synced for two days. Lineups and idle
   * time are then last week's picture, and posting "these five managers have gone
   * quiet" to the whole league off it would be a public accusation built on our
   * own outage — measured on a test league whose stale sync made 13 of 12 teams
   * look inactive. Both of those recipes wait for fresh data.
   */
  dataStale: boolean
  /** Open league-chat polls. */
  polls: Array<{ id: string; question: string; closesAt: string | null }>
  /** Teams by record, best first. */
  standings: Array<{ name: string; wins: number; losses: number; ties: number }>
}

export type DueMessage = {
  recipe: RecipeKey
  /**
   * Identity of the thing being announced — the job records it once posted, so
   * the same reminder is never sent twice however often the job runs.
   */
  windowKey: string
  text: string
}

function easternDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Monday-anchored week key, so one inactivity nudge per week at most. */
function weekKey(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const back = (day.getUTCDay() + 6) % 7
  return new Date(day.getTime() - back * 86_400_000).toISOString().slice(0, 10)
}

function list(names: string[], max = 6): string {
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} and ${names.length - max} more` : shown
}

export function dueRecipeMessages(values: Record<RecipeKey, boolean>, facts: RecipeFacts): DueMessage[] {
  const out: DueMessage[] = []
  const inSeason = (facts.status ?? '').toLowerCase() === 'in_season'
  const league = { platform: facts.platform, sport: facts.sport }
  const usable = (key: RecipeKey) =>
    values[key] && (RECIPES.find((r) => r.key === key)?.unavailableReason(league) ?? null) === null

  // Lineup reminder — only on a day with NFL kickoffs, only in season, only when someone has a hole.
  if (usable('lineupReminder') && inSeason && !facts.dataStale) {
    const today = easternDay(facts.now)
    const gameDay = facts.kickoffs.some((k) => easternDay(k) === today && k.getTime() > facts.now.getTime())
    if (gameDay && facts.emptyLineups.length > 0) {
      out.push({
        recipe: 'lineupReminder',
        windowKey: `lineup:${today}`,
        text: [
          `🏈 Game day${facts.currentWeek ? ` — Week ${facts.currentWeek}` : ''}. Before kickoff, check your lineup.`,
          `Starting with an empty slot right now: ${list(
            facts.emptyLineups.map((t) => `${t.name} (${t.empty})`),
          )}.`,
        ].join('\n'),
      })
    }
  }

  // Inactivity warning — at most weekly, never in the offseason.
  const status = (facts.status ?? '').toLowerCase()
  if (usable('inactivityWarning') && !facts.dataStale && status !== 'complete' && facts.inactiveTeams.length > 0) {
    out.push({
      recipe: 'inactivityWarning',
      windowKey: `inactive:${weekKey(facts.now)}`,
      text: [
        `👋 Checking in: ${list(facts.inactiveTeams)} ${
          facts.inactiveTeams.length === 1 ? 'hasn’t' : 'haven’t'
        } made a trade, waiver claim or roster move in two weeks.`,
        'If you’re stepping away, tell the commissioner so the team can be covered.',
      ].join('\n'),
    })
  }

  // Voting deadline — polls closing in the next 24 hours, each reminded once.
  if (usable('votingDeadline')) {
    for (const p of facts.polls) {
      if (!p.closesAt) continue
      const ms = Date.parse(p.closesAt) - facts.now.getTime()
      if (ms <= 0 || ms > 24 * 60 * 60 * 1000) continue
      const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)))
      out.push({
        recipe: 'votingDeadline',
        windowKey: `vote:${p.id}`,
        text: `🗳️ Voting closes in about ${hours} ${hours === 1 ? 'hour' : 'hours'}: “${p.question}”. Cast your vote in league chat.`,
      })
    }
  }

  // Playoff announcement — once per season, the week playoffs begin.
  if (
    usable('playoffAnnouncement') &&
    inSeason &&
    facts.playoffStartWeek != null &&
    facts.currentWeek === facts.playoffStartWeek &&
    facts.season != null
  ) {
    const spots = facts.playoffSpots ?? 0
    const seeds = spots > 0 ? facts.standings.slice(0, spots) : []
    const lines = [`🏆 The ${facts.leagueName} playoffs start this week (Week ${facts.playoffStartWeek}).`]
    if (seeds.length > 0) {
      lines.push(
        `Seeds as the standings have them: ${seeds
          .map((t, i) => `${i + 1}. ${t.name} (${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''})`)
          .join(' · ')}.`,
      )
      lines.push('Your platform’s bracket is the final word on seeding.')
    }
    out.push({ recipe: 'playoffAnnouncement', windowKey: `playoffs:${facts.season}`, text: lines.join('\n') })
  }

  return out
}
