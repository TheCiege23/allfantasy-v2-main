import { isStale, type DataClass } from '@/lib/sports-data/freshnessPolicy'
import { normalizeSourcePlatform } from '@/lib/league-links/sourceLinkResolver'

/**
 * "When did the information behind this card last change?" — one shape for every /core home card.
 *
 * WHY ONE SHAPE. The home already knew its sync age (`syncAge`, computed once per render), but only
 * one card printed it, and the injury rows each carried their own "reported 30m ago". A reader had
 * no way to tell a card built from a roster read four minutes ago from one built from a read that
 * never happened. Each card now carries one or more stamps, each naming its SOURCE, because "updated
 * 4m ago" means nothing unless it says what was updated.
 *
 * ⚠ THE TIME IS A FACT ABOUT THE DATA, NEVER ABOUT THIS RENDER. `now` is not a freshness value: a
 * card computed this second from rosters read three days ago is three days old. A source whose time
 * we do not hold is `asOf: null` and says "not read yet" — it is never filled in with `now`.
 *
 * ⚠ `asOf` IS AN ISO STRING, NOT A `Date`, because the stamp is rendered by a client component and
 * re-derived there once a minute. `label` is the server's rendering of the same instant so the first
 * client paint matches the server's and hydration does not warn.
 */
export type CardFreshnessStamp = {
  /** What the time describes — "Rosters", "Injury reports". Shown to the reader. */
  source: string
  /** When that source last changed or was last read, as ISO. Null when we hold no time at all. */
  asOf: string | null
  /** The server's relative label for `asOf` ("4m ago"), or null when `asOf` is null. */
  label: string | null
  /** Past the source's own freshness rule (lib/sports-data/freshnessPolicy.ts). */
  stale: boolean
  /** What to say when `asOf` is null — see `MissingMeaning`. */
  missingLabel: string
  /**
   * What `source` was built from, so the stamp can be said in the reader's language (2026-10-04). The
   * stamp is built on the SERVER, which does not know the language; `source` stays the English as
   * written and lib/core-app/cardFreshnessCopy.ts rebuilds the Spanish from this at render. A stamp
   * without it renders whole English.
   */
  parts?: StampSourceParts
}

export type StampSourceParts =
  | { kind: 'injuries' }
  | { kind: 'summary' }
  | { kind: 'scores' }
  | { kind: 'sync-paused' }
  /** `leagueDataStamp`'s pieces: never-read count, "Oldest", "active", and the paused connections left out. */
  | { kind: 'league-data'; neverRead: number; oldest: boolean; active: boolean; paused: number }

/**
 * What an absent time MEANS, which differs by source and changes the wording and the warning:
 *   'never-read' — we should hold a time and do not: a league never synced. Stale, and says so.
 *   'none-yet'   — nothing has happened to stamp: no scored week yet, no injury reported. Not a
 *                  fault, so no warning; "not read yet" there would accuse a read that did happen.
 */
export type MissingMeaning = 'never-read' | 'none-yet'

export function freshnessStamp(
  source: string,
  at: Date | string | null | undefined,
  now: Date,
  options: {
    /**
     * Judge staleness by this data class's rule. ONLY for a time that says when WE last read the
     * source (a league sync). A time that says when the thing itself happened — an injury report, a
     * scored week — is not stale for being old: last Sunday's score is still last Sunday's score.
     */
    staleRule?: DataClass
    missing?: MissingMeaning
    /** What `source` was built from — see `CardFreshnessStamp.parts`. */
    parts?: StampSourceParts
  } = {},
): CardFreshnessStamp {
  const missing = options.missing ?? 'never-read'
  const missingLabel = missing === 'never-read' ? 'not read yet' : 'none yet'
  const parts = options.parts ? { parts: options.parts } : {}
  const date = toDate(at)
  if (!date) return { source, asOf: null, label: null, stale: missing === 'never-read', missingLabel, ...parts }
  return {
    source,
    asOf: date.toISOString(),
    label: relativeAge(date.getTime(), now.getTime()),
    stale: options.staleRule ? isStale(options.staleRule, date, now) : false,
    missingLabel,
    ...parts,
  }
}

/**
 * The stamp on every /core home card built from league syncs (moved here from HomeCards.tsx on
 * 2026-10-04, unchanged, so its Spanish can be tested against its real output).
 *
 * ⚠ THE OLDEST SYNC, NOT THE NEWEST. These cards cover every league in view at once, so one league
 * synced a minute ago said "updated 1m ago" over a portfolio whose other 59 leagues were days old —
 * a fresh timestamp laundering stale ones. The oldest is the only instant every row is at least as
 * new as. A league that has never synced makes the stamp stale whatever the others say; with none
 * synced at all it reads "not read yet". AllFantasy-native leagues have nothing to sync and are not
 * counted.
 */
export function leagueDataStamp(
  input: { oldestAt: string | null; neverSynced: number; syncable: number; paused?: number },
  now: Date,
): CardFreshnessStamp {
  if (input.syncable === 0 && input.paused) {
    return {
      source: 'Account sync paused',
      asOf: null,
      label: null,
      stale: false,
      missingLabel: 'history retained',
      parts: { kind: 'sync-paused' },
    }
  }
  /*
   * The warning has to say WHY. "⚠ Oldest league data updated 7 min ago" is a contradiction on its
   * face when the reason is a league that has never been read — so that case names the count.
   */
  const unread = input.neverSynced > 0 && input.oldestAt
    ? `${input.neverSynced} ${input.neverSynced === 1 ? 'league' : 'leagues'} never read · `
    : ''
  const scope = input.paused ? 'active league data' : 'league data'
  const excluded = input.paused ? ` · ${input.paused} paused ${input.paused === 1 ? 'connection' : 'connections'} excluded` : ''
  const source = `${unread}${input.syncable > 1 ? `Oldest ${scope}` : `${scope[0].toUpperCase()}${scope.slice(1)}`}${excluded}`
  const stamp = freshnessStamp(source, input.oldestAt, now, {
    staleRule: 'fantasy_league',
    missing: input.syncable === 0 ? 'none-yet' : 'never-read',
    parts: {
      kind: 'league-data',
      neverRead: unread ? input.neverSynced : 0,
      oldest: input.syncable > 1,
      active: Boolean(input.paused),
      paused: input.paused ?? 0,
    },
  })
  return unread ? { ...stamp, stale: true } : stamp
}

/** The oldest valid instant in a list — null when none parses. */
export function earliestInstant(values: Iterable<Date | string | null | undefined>): Date | null {
  let earliest: Date | null = null
  for (const value of values) {
    const date = toDate(value)
    if (date && (earliest == null || date < earliest)) earliest = date
  }
  return earliest
}

/**
 * What the "League data" stamp needs from a set of leagues: the oldest sync among the leagues that
 * CAN sync, and how many of those never have. AllFantasy-native leagues have no upstream and are
 * left out of both — "never synced" is not a fault for them.
 */
export function leagueDataFreshness(
  leagues: ReadonlyArray<{ id?: string; platform?: string | null; lastSyncedAt?: Date | string | null }>,
  pausedLeagueIds?: ReadonlySet<string> | null,
): { oldestAt: string | null; neverSynced: number; syncable: number; paused?: number } {
  const providers = leagues.filter((l) => normalizeSourcePlatform(l.platform) != null)
  const syncable = providers.filter((l) => !l.id || !pausedLeagueIds?.has(l.id))
  const paused = providers.length - syncable.length
  const synced = syncable.map((l) => toDate(l.lastSyncedAt)).filter((d): d is Date => d != null)
  const oldest = earliestInstant(synced)
  return {
    oldestAt: oldest ? oldest.toISOString() : null,
    neverSynced: syncable.length - synced.length,
    syncable: syncable.length,
    ...(paused > 0 ? { paused } : {}),
  }
}

/** The newest valid instant in a list — null when none parses. */
export function latestInstant(values: Iterable<Date | string | null | undefined>): Date | null {
  let latest: Date | null = null
  for (const value of values) {
    const date = toDate(value)
    if (date && (latest == null || date > latest)) latest = date
  }
  return latest
}

/**
 * "just now" / "4 min ago" / "3h ago" / "2d ago" / "3w ago". Shared by the server label and the
 * client ticker so the two never render the same instant differently. A time in the future (clock
 * skew) reads as "just now" rather than as a negative age.
 *
 * ⚠ THE SAME WORDS AS `formatAgo` IN lib/core-app/dash34.ts, AND A TEST HOLDS THEM TOGETHER. The
 * injury strip prints "reported 30 min ago" on each row from that function; a footer on the same
 * strip saying "updated 30m ago" is one fact in two spellings. That function cannot be imported
 * here — its module reads the database, and this one ships to the browser.
 */
export function relativeAge(asOfMs: number, nowMs: number): string {
  const ms = nowMs - asOfMs
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
