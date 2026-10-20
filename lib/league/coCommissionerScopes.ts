/**
 * Co-commissioner permissions (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free): up to two
 * co-commissioners, each limited to the areas the head commissioner grants instead of all-or-nothing.
 *
 *   scoring   scoring rules and presets
 *   rosters   roster rules, lineups, keepers, taxi, IR, commissioner roster moves
 *   trades    trade rules, review, vetoes
 *   money     dues, payments, payouts
 *   chat      league announcements and broadcasts
 *   league    everything else: setup, draft, waivers, schedule, playoffs, members
 *
 * ⚠ NO ENTRY MEANS EVERY SCOPE. Co-commissioners named before this existed had full rights, and a
 * co-commissioner the head commissioner has not configured keeps them — nobody loses access because
 * a feature shipped. An entry, once saved, is exactly what it lists (an empty list = view only).
 *
 * Stored in `League.settings.co_commissioner_scopes`, keyed by the co-commissioner's `LeagueTeam.id`
 * (that is where the co-commissioner flag lives). Pure.
 */

export const CO_COMMISSIONER_SCOPES = ['scoring', 'rosters', 'trades', 'money', 'chat', 'league'] as const
export type CoCommissionerScope = (typeof CO_COMMISSIONER_SCOPES)[number]

export const CO_COMMISSIONER_SCOPES_KEY = 'co_commissioner_scopes'
export const MAX_CO_COMMISSIONERS = 2

export const CO_COMMISSIONER_SCOPE_LABELS: Record<CoCommissionerScope, { label: string; help: string }> = {
  scoring: { label: 'Scoring', help: 'Scoring rules and presets' },
  rosters: { label: 'Rosters', help: 'Roster rules, lineups, keepers, taxi, IR and roster moves for any team' },
  trades: { label: 'Trades', help: 'Trade rules, trade review and vetoes' },
  money: { label: 'Money', help: 'Dues, payments and payouts' },
  chat: { label: 'Chat', help: 'League announcements' },
  league: { label: 'League setup', help: 'Draft, waivers, schedule, playoffs and everything else' },
}

const isScope = (x: unknown): x is CoCommissionerScope =>
  typeof x === 'string' && (CO_COMMISSIONER_SCOPES as readonly string[]).includes(x)

function scopeMap(settings: unknown): Record<string, unknown> {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[CO_COMMISSIONER_SCOPES_KEY] : null
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : {}
}

/** The scopes one co-commissioner team holds. Not configured = every scope. */
export function readCoCommissionerScopes(settings: unknown, teamId: string): CoCommissionerScope[] {
  const entry = scopeMap(settings)[teamId]
  if (!Array.isArray(entry)) return [...CO_COMMISSIONER_SCOPES]
  return CO_COMMISSIONER_SCOPES.filter((s) => entry.includes(s))
}

/** Whether a scope list has been saved for this team (vs. the full-rights default). */
export function hasConfiguredScopes(settings: unknown, teamId: string): boolean {
  return Array.isArray(scopeMap(settings)[teamId])
}

/** A copy of `settings` with this team's scopes set, or removed when `scopes` is null. */
export function withCoCommissionerScopes(settings: unknown, teamId: string, scopes: readonly CoCommissionerScope[] | null): Record<string, unknown> {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {}
  const map = { ...scopeMap(base) }
  if (scopes == null) delete map[teamId]
  else map[teamId] = CO_COMMISSIONER_SCOPES.filter((s) => scopes.includes(s))
  if (Object.keys(map).length) base[CO_COMMISSIONER_SCOPES_KEY] = map
  else delete base[CO_COMMISSIONER_SCOPES_KEY]
  return base
}

/** Strict parse of a scope list from a request: every entry must be a known scope. */
export function parseScopeList(value: unknown): CoCommissionerScope[] | null {
  if (!Array.isArray(value) || !value.every(isScope)) return null
  return CO_COMMISSIONER_SCOPES.filter((s) => value.includes(s))
}

/**
 * May a co-commissioner holding these teams act in every one of `required`? True when ANY of the
 * teams holds all of them (a user with two co-commissioner teams gets the wider grant).
 */
export function coCommissionerAllowed(settings: unknown, coTeamIds: readonly string[], required: readonly CoCommissionerScope[]): boolean {
  if (!required.length) return true
  return coTeamIds.some((id) => {
    const held = readCoCommissionerScopes(settings, id)
    return required.every((r) => held.includes(r))
  })
}

// Order matters: a draft-pick-trading key is a trade rule, a keeper-slot key is a roster rule, and
// the draft-order and draft-slot keys are league setup.
const KEY_RULES: Array<[RegExp, CoCommissionerScope]> = [
  [/trad(e|ing)|veto/i, 'trades'],
  [/keeper|taxi|roster|lineup|bench|starter|positions?$|^ir|Ir[A-Z_]|injur|devy/i, 'rosters'],
  [/^draft|Draft[A-Z]|pickTimer|autostart|autoPick|^ai[A-Z]|^rounds$|playerPool|alphabetical|randomize/i, 'league'],
  [/scor|median|ppr|points|stat[A-Z_]/i, 'scoring'],
  [/fee|dues|payout|buyIn|payment|prize|finance|money/i, 'money'],
]

/** The scope one settings key belongs to. Anything unrecognised is league setup. */
export function scopeForSettingsKey(key: string): CoCommissionerScope {
  for (const [re, scope] of KEY_RULES) if (re.test(key)) return scope
  return 'league'
}

const SECTION_SCOPES: Record<string, CoCommissionerScope> = {
  scoring: 'scoring',
  roster: 'rosters',
  rosters: 'rosters',
  keepers: 'rosters',
  trades: 'trades',
  trade: 'trades',
}

/**
 * Every scope a league-settings patch touches: the section it came through, plus each top-level key
 * and each `settingsMerge` key. `leagueId` is the target, not a setting, and is ignored.
 */
export function scopesForSettingsPatch(body: Record<string, unknown>, section?: string): CoCommissionerScope[] {
  const out = new Set<CoCommissionerScope>()
  if (section) out.add(SECTION_SCOPES[section] ?? 'league')
  for (const key of Object.keys(body)) {
    if (key === 'leagueId') continue
    if (key === 'settingsMerge' && body.settingsMerge && typeof body.settingsMerge === 'object') {
      for (const inner of Object.keys(body.settingsMerge as Record<string, unknown>)) out.add(scopeForSettingsKey(inner))
      continue
    }
    out.add(scopeForSettingsKey(key))
  }
  return CO_COMMISSIONER_SCOPES.filter((s) => out.has(s))
}

export function missingScopeMessage(scopes: readonly CoCommissionerScope[]): string {
  const names = scopes.map((s) => CO_COMMISSIONER_SCOPE_LABELS[s].label.toLowerCase())
  return `The head commissioner hasn’t given you ${names.join(' and ')} permission in this league.`
}
