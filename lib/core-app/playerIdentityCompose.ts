import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

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
 */
export type ComposedPlayerIdentity = {
  name: string | null
  position: string | null
  /** Already folded by `normalizeTeamAbbrev` — a crest token, not a long name. */
  team: string | null
  /** Already vetted as something a `src` can take. Never a bare filename. */
  imageUrl: string | null
}

/** The shape this reads. A subset of `SportsPlayer`, so any select works. */
export type PlayerIdentityRow = {
  sleeperId: string | null
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
 * ⚠ `normalizeTeamAbbrev` FOLDS THE 32 NFL FULL NAMES AND PASSES EVERYTHING
 * ELSE STRAIGHT THROUGH UPPER-CASED. So "San Francisco 49ers" resolves to "SF",
 * but a club it does not know comes back as its own name in capitals — which
 * `teamLogoUrl` then asks the CDN for and gets nothing. Folding at compose time
 * makes the difference visible in ONE place: a value of four characters or
 * fewer resolved; a longer one is a passthrough and no crest will come back
 * for it.
 */
function foldClub(raw: string | null | undefined): string | null {
  return normalizeTeamAbbrev(raw)
}

/** Whether a folded club is one the crest lookup can actually use. */
function isUsableClub(folded: string | null): boolean {
  return folded != null && folded.length <= 4
}

/**
 * Compose one identity per `sleeperId`, taking each field from the first row
 * that actually holds it.
 *
 * ⚠ ORDER-INDEPENDENT ON EVERY FIELD, which is the whole point — the input
 * order is whatever Postgres returned. Rows with no `sleeperId` are dropped:
 * they cannot be addressed by the callers, which all key on that id.
 */
export function composePlayerIdentities(
  rows: readonly PlayerIdentityRow[],
): Map<string, ComposedPlayerIdentity> {
  const out = new Map<string, ComposedPlayerIdentity>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const held = out.get(r.sleeperId)
    if (!held) {
      out.set(r.sleeperId, {
        name: r.name?.trim() || null,
        position: r.position ?? null,
        team: foldClub(r.team),
        imageUrl: asHeadshotUrl(r.imageUrl),
      })
      continue
    }
    held.name ??= r.name?.trim() || null
    held.position ??= r.position ?? null
    held.imageUrl ??= asHeadshotUrl(r.imageUrl)
    /*
     * The club is the one field where "already set" is not good enough: a name
     * that would not fold is not WRONG, it is unusable by the crest lookup. A
     * value that folds on a later row therefore REPLACES one that did not on an
     * earlier one, where every other field is first-wins.
     */
    const folded = foldClub(r.team)
    if (held.team == null) held.team = folded
    else if (!isUsableClub(held.team) && isUsableClub(folded)) held.team = folded
  }
  return out
}
