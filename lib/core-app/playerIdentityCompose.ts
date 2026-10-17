import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { betterCasedName, repairHyphenCasing } from '@/lib/player-match/displayNameCasing'
import { selectAuthoritativePlayerRow } from '@/lib/player-match/authoritativePlayerRow'

/**
 * One athlete, composed from every `SportsPlayer` row that shares his Sleeper id.
 *
 * ⚠ `sleeperId` IS NOT UNIQUE IN `SportsPlayer`, AND THE DUPLICATES ARE NOT
 * COPIES — THEY ARE THE SAME ATHLETE AS SEVERAL DIFFERENT VENDORS DESCRIBE HIM.
 * Mike Evans (sleeperId 2216) is three rows on production: `rolling_insights`
 * holds a BARE FILENAME where a headshot URL belongs, `thesportsdb` spells his
 * position "Wide Receiver" and his club "San Francisco 49ers", and only the
 * `sleeper` row carries a usable CDN headshot beside "WR" and "SF".
 *
 * Every reader that has met this took the FIRST row it happened to receive, and
 * `findMany` carries no `orderBy` — so which vendor won was arbitrary. When the
 * wrong one won, a starter rendered as a grey letter with no headshot at all.
 * Observed on `/core/matchup` for Mike Evans, David Montgomery and Evan Engram
 * in ONE lineup; Antonio Williams lost his position the same way.
 *
 * So the row is composed field by field rather than chosen. Every row reaching
 * here already shares one canonical Sleeper id, so this is not a guess about
 * identity — it is taking each fact from whichever vendor actually holds it.
 *
 * Measured on production 2026-08-30: 11,960 distinct NFL sleeperIds, of which
 * 1,420 carry duplicate rows and 153 hold an image on one row and none on
 * another. Composed this way, every one of the 11,960 resolves to BOTH a usable
 * headshot and a position — up from a coin toss on those 153.
 *
 * 🛑 BUT "EVERY ROW IS THE SAME ATHLETE" WAS WRONG, AND BLENDING MADE IT WORSE.
 * The vendor rows got their Sleeper id from a NAME match at ingest, and a free
 * agent's vendor row still holds his LAST club. Measured on production redraft
 * rosters 2026-10-12: 51 rostered ids (915 roster entries) are Sleeper free
 * agents whose vendor row carries a club, so a null team was filled with it —
 * Tyreek Hill printed as Miami, DeAndre Hopkins BAL, Nick Chubb HOU. 14 ids
 * (725 entries) have a vendor row in ANOTHER position group — Byron Murphy
 * (5864, CB MIN) could render as the Seahawks' DT, Ty Johnson (6039) as
 * "Tyler Johnson" WR DAL — whichever row Postgres returned first.
 *
 * So when a `source = 'sleeper'` row exists it is the identity, per
 * `lib/player-match/authoritativePlayerRow.ts`: another row only fills a gap,
 * only when it agrees on name and position group, and NEVER the club. Every
 * NFL Sleeper row already holds a usable headshot and a position (measured the
 * same day), so nothing the blend used to rescue is lost. Without a Sleeper row
 * (other sports) there is no authority to judge by and the field blend stands.
 */
export type ComposedPlayerIdentity = {
  name: string | null
  position: string | null
  /**
   * The player's own sport, as the vendor rows state it. Kept because it
   * decides whether the club below could be folded — see `foldClub`.
   */
  sport: string | null
  /**
   * Folded to a crest token by `normalizeTeamAbbrev` FOR NFL PLAYERS ONLY.
   * Anything else keeps the best raw value the vendors offered.
   */
  team: string | null
  /** Already vetted as something a `src` can take. Never a bare filename. */
  imageUrl: string | null
}

/** The shape this reads. A subset of `SportsPlayer`, so any select works. */
export type PlayerIdentityRow = {
  sleeperId: string | null
  /**
   * ⚠ REQUIRED, SO A CALLER CANNOT SILENTLY OPT OUT OF THE CLUB FOLD. It is the
   * only thing that decides whether `team` may be normalised, and a `select`
   * that omits it would leave every player unfolded — which on the two screens
   * that key a fixture map on the folded token is a silent regression, not a
   * type error. Making it required turns that into a compile failure.
   */
  sport: string | null
  /**
   * ⚠ REQUIRED FOR THE SAME REASON AS `sport`. It is what identifies the
   * authoritative `sleeper` row; a select that omits it silently falls back to
   * blending every vendor row, free agents' stale clubs included.
   */
  source: string | null
  /** Picks the freshest Sleeper row, and orders which agreeing row fills a gap first. */
  fetchedAt: Date | string | null
  name?: string | null
  position?: string | null
  team?: string | null
  imageUrl?: string | null
}

/**
 * A headshot we can actually put in a `src`.
 *
 * ⚠ 959 OF 24,135 NFL ROWS CARRY A BARE FILENAME, NOT A URL — production values
 * include `fde0b61a-db9e-57ac-8a3a-c6aff780a06f.png` (Adam Thielen). Rendered
 * straight into `<img src>` those resolve against the current route and 404, and
 * a broken-image glyph is worse than the initial it would have replaced.
 */
export function asHeadshotUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  return /^(https?:)?\/\//i.test(v) || v.startsWith('/') ? v : null
}

/**
 * The club as the crest lookup needs it — folded here, once, rather than left
 * for each reader.
 *
 * ⚠ `normalizeTeamAbbrev` IS AN NFL TABLE AND IT DOES NOT SAY SO IN ITS RETURN.
 * It folds the 32 NFL full names and passes everything else through
 * UPPER-CASED, so it looks like it resolved either way. Run over an NBA roster
 * it turns "Atlanta Hawks" into "ATLANTA HAWKS" — not wrong exactly, but
 * shoutier than the vendor's own string and no closer to a crest.
 *
 * So the fold is gated on the player's own sport. A non-NFL player keeps the
 * best raw value the vendors offered, which for a club is the shortest token
 * on offer.
 *
 * ⚠ CLUB CODES ARE NOT UNIQUE ACROSS SPORTS — ATL, CHI, DET, MIA and PHI are
 * each both an NFL and an NBA club — which is the same reason `dash34.ts` gates
 * its kickoff join on sport. Folding an NBA club through an NFL table is how a
 * Hawks forward gets told he kicks off with the Falcons.
 */
function foldClub(raw: string | null | undefined, sport: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  return String(sport ?? '').toUpperCase() === 'NFL' ? normalizeTeamAbbrev(v) : v
}

/**
 * Whether a club value is one a crest lookup can actually use.
 *
 * Four characters or fewer means a code. Longer means either a name that no
 * table folded or a sport this module does not fold for — in both cases no
 * crest will come back for it, so a shorter sibling value replaces it.
 */
function isUsableClub(value: string | null): boolean {
  return value != null && value.length <= 4
}

/** Trimmed, with a lowercase letter after a hyphen repaired. Display only; matching lower-cases anyway. */
function displayName(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  return v ? repairHyphenCasing(v) : null
}

/**
 * Compose one identity per `sleeperId`.
 *
 * ⚠ ORDER-INDEPENDENT ON EVERY FIELD, which is the whole point — the input
 * order is whatever Postgres returned. Rows with no `sleeperId` are dropped:
 * they cannot be addressed by the callers, which all key on that id. Ids are
 * grouped exactly as given (no case folding), because callers look them up
 * with the same string they queried by.
 */
export function composePlayerIdentities(
  rows: readonly PlayerIdentityRow[],
): Map<string, ComposedPlayerIdentity> {
  const groups = new Map<string, PlayerIdentityRow[]>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const bucket = groups.get(r.sleeperId)
    if (bucket) bucket.push(r)
    else groups.set(r.sleeperId, [r])
  }
  const out = new Map<string, ComposedPlayerIdentity>()
  for (const [id, group] of groups) {
    out.set(id, group.some((r) => r.source === 'sleeper') ? fromSleeperRow(group) : blendVendorRows(group))
  }
  return out
}

/**
 * The Sleeper row is the identity; agreeing rows fill its gaps (see the header).
 *
 * Headshots are vetted BEFORE selection, so a bare filename counts as a gap an
 * agreeing row may fill rather than as a value that blocks the fill. The name
 * stays the Sleeper row's, re-cased only by a spelling of the SAME name from an
 * agreeing row — `betterCasedName` refuses any other.
 */
function fromSleeperRow(group: readonly PlayerIdentityRow[]): ComposedPlayerIdentity {
  const candidates = group.map((r) => ({
    source: r.source,
    sleeperId: r.sleeperId,
    fetchedAt: r.fetchedAt,
    sport: r.sport ?? null,
    name: displayName(r.name) ?? '',
    position: r.position?.trim() || null,
    team: r.team ?? null,
    imageUrl: asHeadshotUrl(r.imageUrl),
  }))
  const { row, base, ignored } = selectAuthoritativePlayerRow(candidates)!
  let name = base.name || null
  for (const c of candidates) {
    if (c === base || c.source === 'sleeper' || ignored.includes(c) || !name || !c.name) continue
    name = betterCasedName(name, c.name)
  }
  return {
    name,
    position: row.position,
    sport: base.sport,
    // The Sleeper row's club, or none: a null there means free agent or retired.
    team: foldClub(base.team, base.sport),
    imageUrl: row.imageUrl,
  }
}

/**
 * No Sleeper row, so no authority to judge the others by: take each field from
 * the first row that actually holds it.
 */
function blendVendorRows(group: readonly PlayerIdentityRow[]): ComposedPlayerIdentity {
  const [first, ...rest] = group
  const held: ComposedPlayerIdentity = {
    name: displayName(first!.name),
    position: first!.position ?? null,
    sport: first!.sport ?? null,
    team: foldClub(first!.team, first!.sport),
    imageUrl: asHeadshotUrl(first!.imageUrl),
  }
  for (const r of rest) {
    /*
     * ⚠ THE NAME WAS FIRST-ROW-WINS, WHICH THE HEADER ABOVE PROMISES IT IS NOT. One vendor writes
     * "Jaxon Smith-njigba"; whichever row Postgres returned first decided what /core/live printed
     * (2026-10-11). Among spellings of the same name the better-cased one now wins in any order.
     */
    const name = displayName(r.name)
    held.name = held.name == null ? name : name == null ? held.name : betterCasedName(held.name, name)
    held.position ??= r.position ?? null
    held.sport ??= r.sport ?? null
    held.imageUrl ??= asHeadshotUrl(r.imageUrl)
    /*
     * The club is the one field where "already set" is not good enough: a name
     * that would not fold is not WRONG, it is unusable by the crest lookup. A
     * value that folds on a later row therefore REPLACES one that did not on an
     * earlier one, where every other field is first-wins.
     */
    const folded = foldClub(r.team, r.sport ?? held.sport)
    if (held.team == null) held.team = folded
    else if (!isUsableClub(held.team) && isUsableClub(folded)) held.team = folded
  }
  return held
}
