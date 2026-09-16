/**
 * Sports OS — point 9: last-known data, with an obvious timestamp.
 *
 * The rule this encodes: **a screen may show old data, but it may never show old data silently.**
 * Every value that can be stale travels in a `Fresh<T>` envelope carrying when it was fetched and
 * where it came from, so a card physically cannot render a number without being able to say how old
 * it is.
 *
 * ⚠ THIS IS THE `304` RULE'S SIBLING (see CLAUDE.md). Returning `[]` for "we could not reach the
 * provider" is indistinguishable from "there is genuinely nothing", and both read as fact. An
 * envelope makes the difference structural instead of a convention nobody enforces.
 *
 * PURE AND DEPENDENCY-FREE. No I/O, no clock reads except the ones passed in, so it is trivially
 * testable and safe on both sides of the wire.
 */

/** Where a value came from, most to least authoritative. */
export type FreshnessSource =
  /** Just computed or just fetched from the provider. */
  | 'live'
  /** A cache entry that is still inside its TTL. */
  | 'cache'
  /** A cache entry PAST its TTL, served because the refresh failed or is still running. */
  | 'last-known'
  /** We have nothing at all. `data` is null. */
  | 'none'

export type Fresh<T> = {
  data: T
  /** Epoch ms at which `data` was produced by its origin — not when it was read from cache. */
  fetchedAt: number
  source: FreshnessSource
  /** How long `data` is considered current. `null` means it does not go stale (an immutable fact). */
  staleAfterMs: number | null
}

/** A `Fresh<T>` with the derived fields a renderer actually wants. */
export type FreshnessView<T> = Fresh<T> & {
  ageMs: number
  isStale: boolean
  /** Short label for the UI: "just now", "4m ago", "2h ago", "3d ago". */
  label: string
}

export function fresh<T>(data: T, options?: { fetchedAt?: number; staleAfterMs?: number | null }): Fresh<T> {
  return {
    data,
    fetchedAt: options?.fetchedAt ?? Date.now(),
    source: 'live',
    staleAfterMs: options?.staleAfterMs ?? null,
  }
}

/** Re-label an existing envelope without touching `fetchedAt` — the age must survive a cache hop. */
export function withSource<T>(entry: Fresh<T>, source: FreshnessSource): Fresh<T> {
  return { ...entry, source }
}

export function emptyFreshness(staleAfterMs: number | null = null): Fresh<null> {
  return { data: null, fetchedAt: 0, source: 'none', staleAfterMs }
}

export function ageMs(entry: Pick<Fresh<unknown>, 'fetchedAt'>, nowMs: number = Date.now()): number {
  if (!Number.isFinite(entry.fetchedAt) || entry.fetchedAt <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, nowMs - entry.fetchedAt)
}

export function isStale(entry: Pick<Fresh<unknown>, 'fetchedAt' | 'staleAfterMs'>, nowMs: number = Date.now()): boolean {
  if (entry.staleAfterMs === null) return false
  return ageMs(entry, nowMs) > entry.staleAfterMs
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * A short human age. Deliberately coarse — a timestamp to the second invites the reader to believe
 * a precision the pipeline does not have.
 */
export function freshnessLabel(entry: Pick<Fresh<unknown>, 'fetchedAt'>, nowMs: number = Date.now()): string {
  const age = ageMs(entry, nowMs)
  if (!Number.isFinite(age)) return 'never'
  if (age < 45_000) return 'just now'
  if (age < HOUR) return `${Math.round(age / MINUTE)}m ago`
  if (age < DAY) return `${Math.round(age / HOUR)}h ago`
  return `${Math.round(age / DAY)}d ago`
}

/** The envelope plus everything a card needs to render its freshness chip. */
export function describeFreshness<T>(entry: Fresh<T>, nowMs: number = Date.now()): FreshnessView<T> {
  return {
    ...entry,
    ageMs: ageMs(entry, nowMs),
    isStale: isStale(entry, nowMs),
    label: freshnessLabel(entry, nowMs),
  }
}

/**
 * Should the UI warn about this value?
 *
 * `last-known` always warns — it means a refresh FAILED, which the user is entitled to know even if
 * the data is thirty seconds old. A merely stale `cache` entry warns too. A `live` value never does.
 */
/**
 * The freshness fields without the payload — what a renderer needs to draw a label.
 *
 * ⚠ THE PAYLOAD IS DELIBERATELY NOT IN THIS TYPE. A freshness chip must be usable from a client
 * component, and a `Fresh<T>` would drag `T` — for standings, the entire computed board — across the
 * server/client boundary as a serialized prop just to render "4m ago".
 */
export type FreshnessMeta = Pick<Fresh<unknown>, 'fetchedAt' | 'source' | 'staleAfterMs'>

/** Drop the payload, keeping every freshness field. */
export function freshnessMeta(entry: Fresh<unknown>): FreshnessMeta {
  return { fetchedAt: entry.fetchedAt, source: entry.source, staleAfterMs: entry.staleAfterMs }
}

export function shouldWarnAboutFreshness(entry: FreshnessMeta, nowMs: number = Date.now()): boolean {
  if (entry.source === 'none' || entry.source === 'last-known') return true
  return isStale(entry, nowMs)
}

/** Map an envelope's payload, keeping every freshness field intact. */
export function mapFresh<T, U>(entry: Fresh<T>, fn: (value: T) => U): Fresh<U> {
  return { ...entry, data: fn(entry.data) }
}

/**
 * Combine several envelopes into one. The result is as old as the OLDEST input and as weak as its
 * weakest source — a card built from a live read and a last-known read is a last-known card.
 *
 * ⚠ THE CONSERVATIVE DIRECTION IS THE WHOLE POINT. Taking the newest timestamp would let one fresh
 * value launder five stale ones, which is exactly the silent-staleness this module exists to stop.
 */
export function combineFreshness(entries: ReadonlyArray<Fresh<unknown>>): Omit<Fresh<null>, 'data'> {
  if (entries.length === 0) return { fetchedAt: Date.now(), source: 'live', staleAfterMs: null }
  const rank: Record<FreshnessSource, number> = { live: 0, cache: 1, 'last-known': 2, none: 3 }
  let worst: FreshnessSource = 'live'
  let oldest = Number.POSITIVE_INFINITY
  // `null` (never goes stale) must not win over a real TTL, so it is only kept if every input is null.
  let tightest: number | null = null
  let sawTtl = false
  for (const entry of entries) {
    if (rank[entry.source] > rank[worst]) worst = entry.source
    if (entry.fetchedAt > 0 && entry.fetchedAt < oldest) oldest = entry.fetchedAt
    if (entry.staleAfterMs !== null) {
      sawTtl = true
      tightest = tightest === null ? entry.staleAfterMs : Math.min(tightest, entry.staleAfterMs)
    }
  }
  return {
    fetchedAt: Number.isFinite(oldest) ? oldest : 0,
    source: worst,
    staleAfterMs: sawTtl ? tightest : null,
  }
}
