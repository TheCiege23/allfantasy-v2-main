/**
 * Structured provider source references — IMP-01.
 *
 * 🛑 THE DEFECT THIS EXISTS FOR: a stored `externalLeagueId` is frequently a BARE
 * provider league id that does not encode sport or season, and three providers'
 * parsers fill that gap with `new Date().getFullYear()` (and, for Fleaflicker, `NFL`).
 * `fetchNormalizedForConnection` holds `connection.sport` and `connection.season` and
 * was passing only the bare id on, so a scheduled refresh of an imported NBA/2024
 * Fleaflicker league issued an NFL/current-year request. An unavailable wrong scope
 * fails; an AVAILABLE wrong scope contaminates the existing league record.
 *
 * The repair deliberately does NOT change any fetcher signature. Every parser already
 * accepts a composite form — `parseEspnSourceInput` and `parseMflSourceInput` both
 * match `/^(\d+)[@:](\d{4})$/`, and `parseFleaflickerSourceId` accepts `SPORT:id:season`
 * — so restoring scope is a matter of ENCODING what the connection already knows,
 * at the one call site that was dropping it. Narrower change, same guarantee.
 *
 * ⚠ Providers whose ids ALREADY carry scope are left untouched on purpose:
 *   - Sleeper league ids are globally unique and season-scoped by the provider.
 *   - A Yahoo league key (`423.l.12345`) encodes the game, which is sport + season.
 *   - A Fantrax `externalLeagueId` on this path is a LOCAL `FantraxLeague` record id,
 *     not a native id; re-encoding it would corrupt the snapshot lookup (see IMP-07).
 */

/** Providers whose bare league id loses season when it round-trips through a parser. */
const SEASON_SCOPED_PROVIDERS = new Set(['espn', 'mfl'])

/** Providers whose bare league id loses BOTH sport and season. */
const SPORT_AND_SEASON_SCOPED_PROVIDERS = new Set(['fleaflicker'])

/** Sports `parseFleaflickerSourceId` recognises as a leading segment. */
const FLEAFLICKER_SPORTS = new Set(['NFL', 'MLB', 'NBA', 'NHL'])

export interface ProviderSourceRefInput {
  provider: string
  externalLeagueId: string
  sport?: string | null
  season?: number | string | null
}

function normalizeSeason(season: number | string | null | undefined): number | null {
  if (season == null) return null
  const n = typeof season === 'number' ? season : Number(String(season).trim())
  if (!Number.isFinite(n)) return null
  /* Same clamp `parseFleaflickerSourceId` applies; a year outside it is not a season. */
  if (n < 2000 || n > 2100) return null
  return Math.trunc(n)
}

function isBareNumericId(raw: string): boolean {
  return /^\d+$/.test(raw)
}

/**
 * Re-encode a connection's stored league id so the provider parser cannot substitute
 * a default sport or season for the scope the connection actually recorded.
 *
 * Returns the input unchanged whenever scope is already present, cannot be restored,
 * or the provider does not need it — this is a widening of information only, never a
 * rewrite of an id a caller supplied deliberately.
 */
export function buildProviderSourceRef(input: ProviderSourceRefInput): string {
  const raw = String(input.externalLeagueId ?? '').trim()
  if (!raw) return raw

  const provider = String(input.provider ?? '').toLowerCase()
  const season = normalizeSeason(input.season)

  if (SPORT_AND_SEASON_SCOPED_PROVIDERS.has(provider)) {
    /*
     * Already scoped (`NBA:206154` / `NBA:206154:2024`) — the caller was explicit and
     * double-encoding would produce `NBA:NBA:206154:2024`, which parses as garbage.
     */
    const head = raw.split(':')[0]?.trim().toUpperCase() ?? ''
    if (FLEAFLICKER_SPORTS.has(head)) return raw
    if (!isBareNumericId(raw)) return raw

    const sport = String(input.sport ?? '').trim().toUpperCase()
    if (!FLEAFLICKER_SPORTS.has(sport)) return raw
    return season != null ? `${sport}:${raw}:${season}` : `${sport}:${raw}`
  }

  if (SEASON_SCOPED_PROVIDERS.has(provider)) {
    /* A non-bare id is a URL or an already-composite form; both already carry season. */
    if (!isBareNumericId(raw)) return raw
    if (season == null) return raw
    return `${raw}:${season}`
  }

  return raw
}

export interface ScopeAssertionInput {
  provider: string
  /** What the refresh asked for. */
  requested: { sport?: string | null; season?: number | string | null }
  /** What the provider actually answered with, read off the normalized payload. */
  returned: { sport?: string | null; season?: number | string | null }
}

export interface ScopeMismatch {
  field: 'sport' | 'season'
  requested: string
  returned: string
}

/**
 * Compare requested scope against the scope the provider actually answered with.
 *
 * 🛑 THE WRITER MUST NOT APPLY A PAYLOAD THAT FAILS THIS. The audit's finding is that
 * an available-but-wrong scope is silently written over the existing league — a 2024
 * NBA league overwritten with 2026 NFL data looks like a successful refresh. Rejecting
 * on mismatch keeps last-good data intact, which is always the safer direction.
 *
 * ⚠ An ABSENT value on either side is not a mismatch. Not every adapter reports both
 * fields, and treating "unknown" as "wrong" would refuse every refresh for providers
 * that never carried the field — turning a data-integrity guard into an outage.
 */
export function findScopeMismatches(input: ScopeAssertionInput): ScopeMismatch[] {
  const out: ScopeMismatch[] = []

  const reqSport = String(input.requested.sport ?? '').trim().toUpperCase()
  const retSport = String(input.returned.sport ?? '').trim().toUpperCase()
  if (reqSport && retSport && reqSport !== retSport) {
    out.push({ field: 'sport', requested: reqSport, returned: retSport })
  }

  const reqSeason = normalizeSeason(input.requested.season)
  const retSeason = normalizeSeason(input.returned.season)
  if (reqSeason != null && retSeason != null && reqSeason !== retSeason) {
    out.push({ field: 'season', requested: String(reqSeason), returned: String(retSeason) })
  }

  return out
}

/** Thrown when a provider answered with a different league scope than was requested. */
export class SyncScopeMismatchError extends Error {
  readonly mismatches: ScopeMismatch[]

  constructor(provider: string, mismatches: ScopeMismatch[]) {
    const detail = mismatches
      .map((m) => `${m.field}: requested ${m.requested}, provider returned ${m.returned}`)
      .join('; ')
    super(
      `${provider}: refusing to apply refresh — the provider answered a different league scope than was requested (${detail}). Last-good data is unchanged.`,
    )
    this.name = 'SyncScopeMismatchError'
    this.mismatches = mismatches
  }
}
