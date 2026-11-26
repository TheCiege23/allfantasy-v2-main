/**
 * Which schools a college league drafts from: every school, a preset (Power 4, Group of 6, FBS only), or
 * the commissioner's own list of conferences. Stored in `League.settings.collegeConferenceScope`; read by
 * `getPlayerPoolForLeague`, so the draft room, autopick and the waiver wire all see the same players.
 *
 * Conference names are the ones `SportsTeam` holds for Rolling Insights teams ("Southeastern Conference"),
 * because that is the table every college player row's school is matched against
 * (`lib/college/collegeTeamConferences.ts`). Measured on production 2026-11-25: 99.97% of college football
 * and basketball player rows name a school that table has.
 *
 * Pure and client-safe: the settings panel uses the same presets and labels as the server filter.
 */

export const COLLEGE_CONFERENCE_SCOPE_KEY = 'collegeConferenceScope'

export const COLLEGE_SCOPE_SPORTS = ['NCAAF', 'NCAAB'] as const
export type CollegeScopeSport = (typeof COLLEGE_SCOPE_SPORTS)[number]

export type CollegeScopePreset = 'all' | 'power' | 'group' | 'fbs' | 'custom'

export type CollegeConferenceScope = {
  preset: CollegeScopePreset
  /** Only for `custom`: the conferences the commissioner picked. */
  conferences: string[]
}

export type CollegeScopePresetOption = { preset: CollegeScopePreset; label: string; description: string }

const POWER_FOUR = ['Southeastern Conference', 'Big Ten Conference', 'Atlantic Coast Conference', 'Big 12 Conference']
const GROUP_OF_SIX = [
  'American Athletic Conference',
  'Conference USA',
  'Mid-American Conference',
  'Mountain West Conference',
  'Sun Belt Conference',
  'Pac-12 Conference',
]
/**
 * Football independents, named by school: the stored "Independent" conference also holds East Tennessee
 * State, an FCS school, so "FBS only" cannot simply include every independent.
 */
const NOTRE_DAME = 'University of Notre Dame'
const UCONN = 'University of Connecticut'

type Membership = { conferences: readonly string[]; schools: readonly string[] }

const PRESET_MEMBERSHIP: Record<CollegeScopeSport, Partial<Record<CollegeScopePreset, Membership>>> = {
  NCAAF: {
    power: { conferences: POWER_FOUR, schools: [NOTRE_DAME] },
    group: { conferences: GROUP_OF_SIX, schools: [] },
    fbs: { conferences: [...POWER_FOUR, ...GROUP_OF_SIX], schools: [NOTRE_DAME, UCONN] },
  },
  NCAAB: {
    power: { conferences: [...POWER_FOUR, 'Big East Conference'], schools: [] },
  },
}

export function collegeScopePresets(sport: string): CollegeScopePresetOption[] {
  if (sport === 'NCAAF') {
    return [
      { preset: 'all', label: 'All schools', description: 'Every college player, FBS and FCS.' },
      { preset: 'fbs', label: 'FBS only', description: 'Every FBS school. No FCS players.' },
      { preset: 'power', label: 'Power 4', description: 'SEC, Big Ten, ACC, Big 12 and Notre Dame.' },
      { preset: 'group', label: 'Group of 6', description: 'American, C-USA, MAC, Mountain West, Sun Belt and Pac-12.' },
      { preset: 'custom', label: 'Pick conferences', description: 'Only the conferences you choose, like SEC + Big Ten.' },
    ]
  }
  if (sport === 'NCAAB') {
    return [
      { preset: 'all', label: 'All schools', description: 'Every Division I player.' },
      { preset: 'power', label: 'Power conferences', description: 'ACC, Big East, Big Ten, Big 12 and SEC.' },
      { preset: 'custom', label: 'Pick conferences', description: 'Only the conferences you choose.' },
    ]
  }
  return []
}

export function isCollegeScopeSport(sport: string | null | undefined): sport is CollegeScopeSport {
  return (COLLEGE_SCOPE_SPORTS as readonly string[]).includes(String(sport ?? ''))
}

function isPreset(sport: CollegeScopeSport, preset: unknown): preset is CollegeScopePreset {
  return collegeScopePresets(sport).some((option) => option.preset === preset)
}

function cleanConferences(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return [...new Set(list.map((c) => String(c ?? '').trim()).filter(Boolean))].sort()
}

/**
 * The league's scope, or null when it drafts from every school. Anything unreadable, a preset the sport
 * does not have, or a custom list with no conferences reads as every school: a broken setting must
 * never leave a league with an empty player pool.
 */
export function readCollegeConferenceScope(settings: unknown, sport: string | null | undefined): CollegeConferenceScope | null {
  if (!isCollegeScopeSport(sport)) return null
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[COLLEGE_CONFERENCE_SCOPE_KEY] : null
  if (!raw || typeof raw !== 'object') return null
  const preset = (raw as { preset?: unknown }).preset
  if (!isPreset(sport, preset) || preset === 'all') return null
  const conferences = cleanConferences((raw as { conferences?: unknown }).conferences)
  if (preset === 'custom') return conferences.length > 0 ? { preset, conferences } : null
  return { preset, conferences: [] }
}

/** The conferences and named schools a scope admits. */
export function scopeMembership(sport: CollegeScopeSport, scope: CollegeConferenceScope): Membership {
  if (scope.preset === 'custom') return { conferences: scope.conferences, schools: [] }
  return PRESET_MEMBERSHIP[sport][scope.preset] ?? { conferences: [], schools: [] }
}

/**
 * Builds the per-player test. A player whose school is unknown is left out: in a Power 4 league "we could
 * not tell" must not mean "include him".
 */
export function collegeSchoolFilter(
  sport: CollegeScopeSport,
  scope: CollegeConferenceScope,
): (school: { conference: string | null; name: string | null }) => boolean {
  const membership = scopeMembership(sport, scope)
  const conferences = new Set(membership.conferences.map((c) => c.toLowerCase()))
  const schools = new Set(membership.schools.map((s) => s.toLowerCase()))
  return ({ conference, name }) => {
    if (name && schools.has(name.trim().toLowerCase())) return true
    return conference != null && conferences.has(conference.trim().toLowerCase())
  }
}

/** A stable string for cache keys: changes whenever the set of admitted schools changes. */
export function collegeScopeSignature(scope: CollegeConferenceScope | null): string {
  if (!scope) return 'all'
  return scope.preset === 'custom' ? `custom:${scope.conferences.join('|')}` : scope.preset
}

/** One line for the settings page and the draft room: "Power 4", "SEC + Big Ten". */
export function describeCollegeScope(sport: string, scope: CollegeConferenceScope | null): string {
  if (!scope) return 'All schools'
  if (scope.preset === 'custom') return scope.conferences.map(shortConferenceName).join(' + ')
  return collegeScopePresets(sport).find((option) => option.preset === scope.preset)?.label ?? 'All schools'
}

const SHORT_NAMES: Record<string, string> = {
  'Southeastern Conference': 'SEC',
  'Big Ten Conference': 'Big Ten',
  'Atlantic Coast Conference': 'ACC',
  'Big 12 Conference': 'Big 12',
  'Big East Conference': 'Big East',
  'American Athletic Conference': 'American',
  'Conference USA': 'C-USA',
  'Mid-American Conference': 'MAC',
  'Mountain West Conference': 'Mountain West',
  'Pac-12 Conference': 'Pac-12',
  'Atlantic 10 Conference': 'A-10',
  'West Coast Conference': 'WCC',
  'Missouri Valley Conference': 'Missouri Valley',
}

export function shortConferenceName(conference: string): string {
  return SHORT_NAMES[conference] ?? conference.replace(/ Conference$/, '')
}

export type CollegeScopeInputResult = { ok: true; scope: CollegeConferenceScope | null } | { ok: false; error: string }

/** Validates what the settings panel sends. A custom list may only name conferences the sport has. */
export function parseCollegeScopeInput(
  sport: CollegeScopeSport,
  body: unknown,
  knownConferences: readonly string[],
): CollegeScopeInputResult {
  const preset = body && typeof body === 'object' ? (body as { preset?: unknown }).preset : undefined
  if (!isPreset(sport, preset)) return { ok: false, error: 'Choose one of the player pool options.' }
  if (preset === 'all') return { ok: true, scope: null }
  if (preset !== 'custom') return { ok: true, scope: { preset, conferences: [] } }
  const conferences = cleanConferences((body as { conferences?: unknown }).conferences)
  if (conferences.length === 0) return { ok: false, error: 'Pick at least one conference.' }
  const known = new Set(knownConferences)
  const unknown = conferences.filter((c) => !known.has(c))
  if (unknown.length > 0) return { ok: false, error: `Unknown conference: ${unknown.join(', ')}` }
  return { ok: true, scope: { preset, conferences } }
}
