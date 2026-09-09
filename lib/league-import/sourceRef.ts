/**
 * Structured provider source references and FAIL-CLOSED scope validation — IMP-01.
 *
 * 🛑 THE DEFECT THIS EXISTS FOR: a stored `externalLeagueId` is frequently a BARE
 * provider league id that does not encode sport or season, and three providers' parsers
 * fill that gap with `new Date().getFullYear()` (and, for Fleaflicker, `NFL`).
 * `fetchNormalizedForConnection` holds `connection.sport` and `connection.season` and was
 * passing only the bare id on, so a scheduled refresh of an imported NBA/2024 Fleaflicker
 * league issued an NFL/current-year request. An unavailable wrong scope fails; an
 * AVAILABLE wrong scope contaminates the existing league record and reports success.
 *
 * The encoding repair deliberately does NOT change any fetcher signature. Every parser
 * already accepts a composite form — `parseEspnSourceInput` and `parseMflSourceInput` both
 * match `/^(\d+)[@:](\d{4})$/`, and `parseFleaflickerSourceId` accepts `SPORT:id:season` —
 * so restoring scope is a matter of ENCODING what the connection already knows, at the one
 * call site that was dropping it.
 *
 * 🛑 VALIDATION IS FAIL-CLOSED, AND THAT IS A DELIBERATE REVERSION OF THE FIRST DESIGN.
 * The first version treated "absent on either side" as "no mismatch", which is exactly the
 * hole the encoding exists to close: a provider that answers without a season cannot be
 * shown to have honoured the requested season, and permitting the write means an
 * unverifiable payload overwrites a verified one. For a provider whose id space needs a
 * dimension, a MISSING dimension is now a rejection, not a pass. Opportunistic comparison
 * survives only for providers whose ids already carry scope — see the contracts below.
 */

/** A scope dimension a provider can report about the league it just returned. */
export type ScopeDimension = 'sport' | 'season'

export interface ProviderScopeContract {
  /**
   * Dimensions the provider MUST report for a refresh to be persistable. Absent or
   * unparseable is a rejection — an unverifiable payload never replaces a verified one.
   */
  required: readonly ScopeDimension[]
  /**
   * Dimensions compared when present and ignored when absent. Reserved for providers whose
   * league id already pins the dimension, so a silent adapter cannot cause a wrong-scope write.
   */
  opportunistic: readonly ScopeDimension[]
  /** Why this provider is shaped this way — read by the operator diagnostics, not by logic. */
  rationale: string
}

/**
 * ⚠ REQUIRED IS NOT A STYLE CHOICE — IT TRACKS WHICH IDS LOSE SCOPE.
 *
 * ESPN, MFL and Fleaflicker are the three providers whose BARE league id carries neither
 * season nor (for Fleaflicker) sport, so their parsers substitute a default. Those are
 * exactly the providers where an unverified answer can be a different league's data, and
 * they are therefore fail-closed on both dimensions their adapters populate.
 *
 * The other three pin scope in the id itself, so a wrong-scope answer is not reachable by
 * the mechanism this guard exists for:
 *   - Sleeper league ids are globally unique and season-scoped by the provider. Its adapter
 *     also returns `season: null` when the payload omits it, so requiring season here would
 *     reject healthy leagues for a defect that cannot occur.
 *   - A Yahoo league key (`423.l.12345`) encodes the game, which IS sport plus season.
 *   - A Fantrax `externalLeagueId` on this path is a LOCAL `FantraxLeague` record id, not a
 *     native one (see IMP-07); its scope comes from the stored snapshot, not from a parser
 *     default.
 * They still validate opportunistically: when the adapter does report a dimension and it
 * CONFLICTS, that is a real integrity failure whoever caused it, and it is rejected.
 */
export const PROVIDER_SCOPE_CONTRACTS: Record<string, ProviderScopeContract> = {
  espn: {
    required: ['sport', 'season'],
    opportunistic: [],
    rationale: 'Bare ESPN league ids carry no season; the parser defaults to the current year.',
  },
  mfl: {
    required: ['sport', 'season'],
    opportunistic: [],
    rationale: 'Bare MFL league ids carry no season; the parser defaults to the current year.',
  },
  fleaflicker: {
    required: ['sport', 'season'],
    opportunistic: [],
    rationale:
      'Bare Fleaflicker league ids carry neither sport nor season; the parser defaults to NFL and the current year.',
  },
  sleeper: {
    required: [],
    opportunistic: ['sport', 'season'],
    rationale:
      'Sleeper league ids are globally unique and season-scoped by the provider; its adapter may legitimately report a null season.',
  },
  yahoo: {
    required: [],
    opportunistic: ['sport', 'season'],
    rationale: 'A Yahoo league key encodes the game, which is sport plus season.',
  },
  fantrax: {
    required: [],
    opportunistic: ['sport', 'season'],
    rationale:
      'The stored id on this path is a local FantraxLeague snapshot id, so scope comes from the snapshot rather than a parser default.',
  },
}

/**
 * The contract for a provider with no entry.
 *
 * ⚠ FAIL-CLOSED IS THE DEFAULT ON PURPOSE. An unrecognised provider is one nobody has
 * reasoned about, and the permissive default is how the original hole got shipped. A new
 * provider that legitimately cannot report a dimension gets an explicit entry above, which
 * is a visible, reviewable edit rather than a silent inheritance.
 */
export const DEFAULT_SCOPE_CONTRACT: ProviderScopeContract = {
  required: ['sport', 'season'],
  opportunistic: [],
  rationale: 'Unrecognised provider — validated fail-closed until a contract is written for it.',
}

export function scopeContractFor(provider: string): ProviderScopeContract {
  return PROVIDER_SCOPE_CONTRACTS[String(provider ?? '').toLowerCase()] ?? DEFAULT_SCOPE_CONTRACT
}

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

function normalizeSport(sport: string | null | undefined): string | null {
  const s = String(sport ?? '').trim().toUpperCase()
  return s.length > 0 ? s : null
}

function isBareNumericId(raw: string): boolean {
  return /^\d+$/.test(raw)
}

/**
 * Re-encode a connection's stored league id so the provider parser cannot substitute a
 * default sport or season for the scope the connection actually recorded.
 *
 * Returns the input unchanged whenever scope is already present, cannot be restored, or the
 * provider does not need it — this widens information only, and never rewrites an id a
 * caller supplied deliberately.
 */
export function buildProviderSourceRef(input: ProviderSourceRefInput): string {
  const raw = String(input.externalLeagueId ?? '').trim()
  if (!raw) return raw

  const provider = String(input.provider ?? '').toLowerCase()
  const season = normalizeSeason(input.season)

  if (SPORT_AND_SEASON_SCOPED_PROVIDERS.has(provider)) {
    /*
     * Already scoped (`NBA:206154` / `NBA:206154:2024`) — the caller was explicit, and
     * double-encoding would produce `NBA:NBA:206154:2024`, which parses as garbage.
     */
    const head = raw.split(':')[0]?.trim().toUpperCase() ?? ''
    if (FLEAFLICKER_SPORTS.has(head)) return raw
    if (!isBareNumericId(raw)) return raw

    const sport = normalizeSport(input.sport)
    if (!sport || !FLEAFLICKER_SPORTS.has(sport)) return raw
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

export type ScopeProblemKind = 'mismatch' | 'missing_required'

export interface ScopeProblem {
  field: ScopeDimension
  kind: ScopeProblemKind
  requested: string
  /** `null` for `missing_required` — the provider did not report the dimension at all. */
  returned: string | null
}

export interface ScopeAssertionInput {
  provider: string
  /** What the refresh asked for. */
  requested: { sport?: string | null; season?: number | string | null }
  /** What the provider actually answered with, read off the normalized payload. */
  returned: { sport?: string | null; season?: number | string | null }
}

/**
 * Compare requested scope against the scope the provider actually answered with, under the
 * provider's own contract.
 *
 * 🛑 THE WRITER MUST NOT APPLY A PAYLOAD THAT RETURNS ANY PROBLEM. The audit's finding is
 * that an available-but-wrong scope is silently written over the existing league — a 2024
 * NBA league overwritten with 2026 NFL data looks like a successful refresh. Rejecting keeps
 * last-good data intact, which is always the safer direction.
 *
 * ⚠ A REQUESTED DIMENSION THAT IS ITSELF MISSING IS NOT A PROVIDER FAULT. When the
 * connection has no recorded season there is nothing to verify against, so the dimension is
 * skipped rather than reported — the guard exists to catch the provider answering about a
 * DIFFERENT league, not to fail a connection whose own record is thin. That gap is a
 * data-quality problem for enumeration to fix, not a reason to refuse every refresh.
 */
export function findScopeMismatches(input: ScopeAssertionInput): ScopeProblem[] {
  const contract = scopeContractFor(input.provider)
  const out: ScopeProblem[] = []

  const requested: Record<ScopeDimension, string | null> = {
    sport: normalizeSport(input.requested.sport),
    season: (() => {
      const s = normalizeSeason(input.requested.season)
      return s == null ? null : String(s)
    })(),
  }
  const returned: Record<ScopeDimension, string | null> = {
    sport: normalizeSport(input.returned.sport),
    season: (() => {
      const s = normalizeSeason(input.returned.season)
      return s == null ? null : String(s)
    })(),
  }

  const check = (field: ScopeDimension, required: boolean) => {
    const want = requested[field]
    /* Nothing recorded on our side — there is no claim to verify. */
    if (want == null) return
    const got = returned[field]
    if (got == null) {
      if (required) {
        out.push({ field, kind: 'missing_required', requested: want, returned: null })
      }
      return
    }
    if (got !== want) {
      out.push({ field, kind: 'mismatch', requested: want, returned: got })
    }
  }

  for (const field of contract.required) check(field, true)
  for (const field of contract.opportunistic) check(field, false)

  return out
}

/**
 * A provider answered about a different league scope than was requested, or could not show
 * that it answered about the right one.
 *
 * 🛑 THIS IS A DURABLE DATA-INTEGRITY STATE, NOT A PROVIDER OUTAGE, AND THE DIFFERENCE
 * DECIDES HOW THE RUNNER SHOULD TREAT IT. A throttle recovers on its own and deserves an
 * immediate retry; a connection whose recorded scope disagrees with what the provider serves
 * will disagree identically on the next tick, and every retry is a wasted provider request
 * against a problem only a human or a data repair can fix. `durable = true` is what lets the
 * collector record it, surface it, and stop paying for it.
 *
 * ⚠ THE MESSAGE CARRIES SCOPE AND NOTHING ELSE. No credential, no league name, no manager,
 * no source id — this string reaches `LeagueSyncState.lastError`, `SyncJobRun.errorMessage`
 * and operator diagnostics, and the repo has already paid once for a credential riding out
 * on an error path. The league is identified by the `runKey` the row is already keyed on.
 */
export class SyncScopeMismatchError extends Error {
  readonly provider: string
  readonly problems: ScopeProblem[]
  /** Marks this as a configuration/data-integrity condition rather than a transient failure. */
  readonly durable = true as const

  constructor(provider: string, problems: ScopeProblem[]) {
    const detail = problems
      .map((p) =>
        p.kind === 'missing_required'
          ? `${p.field}: requested ${p.requested}, provider reported none`
          : `${p.field}: requested ${p.requested}, provider returned ${p.returned}`,
      )
      .join('; ')
    super(
      `${provider}: refusing to apply refresh — the provider did not confirm the requested league scope (${detail}). Last-good data is unchanged.`,
    )
    this.name = 'SyncScopeMismatchError'
    this.provider = provider
    this.problems = problems
  }
}

/** True for any error the collector should treat as durable rather than retry-worthy. */
export function isDurableSyncError(e: unknown): boolean {
  return Boolean(e) && (e as { durable?: unknown }).durable === true
}
