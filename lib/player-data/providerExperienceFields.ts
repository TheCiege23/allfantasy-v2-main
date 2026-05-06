/**
 * Defensive extraction of experience/rookie/draft/debut signals from provider payloads.
 * Does not infer from age or college alone — only explicit stored fields.
 */

export type ExperienceSignalSource =
  | 'rolling_insights'
  | 'thesportsdb'
  | 'clearsports'
  | 'sleeper'
  | 'derived_from_draft_year'
  | 'derived_from_debut_year'
  | 'unknown'

/** Single-field extraction outcome (best-effort per provider bucket). */
export type ProviderExperienceSignal = {
  rookie: boolean | null
  proYears: number | null
  draftYear: number | null
  debutYear: number | null
  source: ExperienceSignalSource
  field: string | null
  reason: string
}

const WS = /\s+/g

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Pull integers/bools from flat object keys (case variants). */
function readLooseKeys(o: Record<string, unknown>, keys: string[]): { key: string; value: unknown } | null {
  const lowerMap = new Map<string, string>()
  for (const k of Object.keys(o)) {
    lowerMap.set(k.toLowerCase().replace(WS, '_'), k)
  }
  for (const want of keys) {
    const canon = want.toLowerCase()
    const orig = lowerMap.get(canon)
    if (orig !== undefined && o[orig] !== undefined && o[orig] !== null) {
      return { key: orig, value: o[orig] }
    }
  }
  return null
}

/** Shallow merge nested `player`, `bio`, `profile` one level. */
function flattenProviderObject(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  const root = input as Record<string, unknown>
  Object.assign(out, root)
  for (const nest of ['player', 'bio', 'profile', 'attributes', 'meta', 'metadata']) {
    const v = root[nest]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, v as Record<string, unknown>)
    }
  }
  return out
}

const ROOKIE_BOOL_KEYS = ['rookie', 'isrookie', 'is_rookie', 'isRookie']
const YEARS_KEYS = [
  'yearsexp',
  'years_exp',
  'yearsexperience',
  'years_experience',
  'experience',
  'proyears',
  'pro_years',
  'seasons',
  'yoe',
  'service_time',
  'servicetime',
  'servicetimeyears',
]
const DRAFT_KEYS = [
  'draftyear',
  'draft_year',
  'nfldraftyear',
  'nbadraftyear',
  'nhldraftyear',
  'mlbdraftyear',
  'nbaDraftYear',
  'nhlDraftYear',
]
const DEBUT_KEYS = ['debutyear', 'debut_year', 'mlbdebut', 'firstseason', 'first_season', 'first_year']

function parseRookieLike(v: unknown): boolean | null {
  if (v === true || v === false) return v
  if (typeof v === 'number') return v === 0 ? true : v === 1 ? false : null
  const s = String(v).trim().toLowerCase()
  if (!s) return null
  if (s === 'r' || s === 'rook' || s === 'rookie' || s === 'yes' || s === 'y') return true
  if (s === 'vet' || s === 'veteran' || s === 'no' || s === 'n') return false
  return null
}

function parseYearsLike(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v))
  const s = String(v).trim().toLowerCase()
  if (!s) return null
  const rookieParsed = parseRookieLike(s)
  if (rookieParsed === true) return 0
  const m = s.match(/(-?\d+(?:\.\d+)?)/)
  if (m && m[1]) {
    const n = Number(m[1])
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null
  }
  return null
}

export function normalizeExperienceNumber(value: unknown): { proYears: number | null; rookie: boolean | null } {
  const rookie = parseRookieLike(value)
  const proYears = parseYearsLike(value)
  return { proYears, rookie: rookie ?? null }
}

/**
 * Scan arbitrary JSON for known experience keys (flat + one nested tier already merged).
 */
export function extractExperienceSignalsFromProviderPayload(
  input: unknown,
  sourceHint: ExperienceSignalSource = 'unknown',
): ProviderExperienceSignal {
  const flat = flattenProviderObject(input)
  const empty = (): ProviderExperienceSignal => ({
    rookie: null,
    proYears: null,
    draftYear: null,
    debutYear: null,
    source: sourceHint,
    field: null,
    reason: 'no_matching_fields',
  })

  const rb = readLooseKeys(flat, ROOKIE_BOOL_KEYS)
  if (rb) {
    const rk = parseRookieLike(rb.value)
    if (rk !== null) {
      return {
        rookie: rk,
        proYears: rk ? 0 : null,
        draftYear: null,
        debutYear: null,
        source: sourceHint,
        field: rb.key,
        reason: 'explicit_rookie_flag',
      }
    }
  }

  const yk = readLooseKeys(flat, YEARS_KEYS)
  if (yk) {
    const { proYears, rookie } = normalizeExperienceNumber(yk.value)
    if (proYears !== null) {
      return {
        rookie: rookie ?? (proYears === 0 ? true : proYears >= 1 ? false : null),
        proYears,
        draftYear: null,
        debutYear: null,
        source: sourceHint,
        field: yk.key,
        reason: 'years_or_experience_field',
      }
    }
  }

  const dk = readLooseKeys(flat, DRAFT_KEYS)
  if (dk) {
    const y = num(dk.value)
    if (y != null && y >= 1900 && y <= 2100) {
      return {
        rookie: null,
        proYears: null,
        draftYear: y,
        debutYear: null,
        source: sourceHint,
        field: dk.key,
        reason: 'draft_year_present',
      }
    }
  }

  const debut = readLooseKeys(flat, DEBUT_KEYS)
  if (debut) {
    const raw = debut.value
    let y: number | null = null
    if (typeof raw === 'number') y = raw
    else if (typeof raw === 'string') {
      const m = raw.match(/(19|20)\d{2}/)
      if (m) y = Number(m[0])
    }
    if (y != null && y >= 1900 && y <= 2100) {
      return {
        rookie: null,
        proYears: null,
        draftYear: null,
        debutYear: y,
        source: sourceHint,
        field: debut.key,
        reason: 'debut_year_present',
      }
    }
  }

  return empty()
}

export function extractRollingInsightsExperienceSignals(input: unknown): ProviderExperienceSignal {
  return extractExperienceSignalsFromProviderPayload(input, 'rolling_insights')
}

export function extractTheSportsDbExperienceSignals(input: unknown): ProviderExperienceSignal {
  return extractExperienceSignalsFromProviderPayload(input, 'thesportsdb')
}

export function extractClearSportsExperienceSignals(input: unknown): ProviderExperienceSignal {
  return extractExperienceSignalsFromProviderPayload(input, 'clearsports')
}

/** Maps `sports_players.data_source` strings to a coarse provider bucket for audits. */
export function inferExperienceSourceFromDataSource(ds: string): ExperienceSignalSource {
  const s = ds.toLowerCase()
  if (s.includes('thesportsdb')) return 'thesportsdb'
  if (s.includes('clear')) return 'clearsports'
  if (s.includes('rolling') || s === 'ri') return 'rolling_insights'
  return 'unknown'
}

type SportsPlayerLike = {
  stats?: unknown
  projections?: unknown
  news?: unknown
  dataSource?: string | null
}

/**
 * Read stats + projections + optional news JSON from `sports_players` row.
 */
export function getExperienceSignalsFromSportsPlayer(row: SportsPlayerLike): ProviderExperienceSignal {
  const ds = String(row.dataSource ?? '')
  const merged: Record<string, unknown> = {
    ...flattenProviderObject(row.stats),
    ...flattenProviderObject(row.projections),
    ...flattenProviderObject(row.news),
  }

  const labeled = extractExperienceSignalsFromProviderPayload(merged, inferExperienceSourceFromDataSource(ds))
  if (labeled.reason !== 'no_matching_fields') return labeled

  /** Same JSON may omit provider-specific labels — scan without assuming vendor. */
  return extractExperienceSignalsFromProviderPayload(merged, 'unknown')
}
