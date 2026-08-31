/**
 * Fantrax college ADP → `DevyPlayer.devyAdp`.
 *
 * 🛑 THE COLUMN IS READ EVERYWHERE AND WRITTEN BY NOTHING. `devyAdp` is consumed
 * by adp-data, the Chimmy devy context and the league-home player rows, and no
 * code path in this repo has ever set it — measured on production: 337 of 1,721
 * rows carry a value, the rest are null, and `lib/trade-intel/devyOutlook.ts`
 * states outright that no market prices college players. That was true of every
 * source we held. `getAdp?sport=NCAAF` is a market, and this is the writer.
 *
 * ⚠ INGESTION, NOT A REQUEST PATH. It calls a provider on purpose, on the same
 * footing as the CFBD devy ingestion: a scheduled writer fills the column and
 * request paths read Postgres. Never call this from a route handler.
 *
 * ⚠ NAME ALONE IS NOT AN IDENTITY, AND THIS IS THE WHOLE RISK. The ADP payload
 * carries no school, so matching a devy player on name only would attach a
 * market price to the wrong person whenever two players share a name — common
 * enough across ~130 FBS schools to be a certainty rather than a risk.
 * `getPlayerIds?sport=CFB` holds the school for the same Fantrax ids, so every
 * match here is name AND school, and anything ambiguous is skipped and counted
 * rather than guessed.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import {
  getFantraxAdp,
  getFantraxPlayerIds,
  type FantraxAdpEntry,
  type FantraxPlayerRef,
} from '@/lib/league-import/fantrax/fantraxApi'

/**
 * ⚠ A DAY, NOT A TICK. The intel cron fires every 6 hours; ADP moves on the
 * timescale of recruiting news and draft chatter, not hours. Running it every
 * tick costs two provider fetches (997 ADP rows + the 16,886-row CFB map) and up
 * to 997 database round trips for data that has not changed.
 *
 * The marker mirrors `devyIntelRefresh`'s: a `sportsDataCache` row whose TTL
 * outlives the cadence, so a lapsed phase stays visible rather than looking like
 * one that never ran.
 */
const ADP_CADENCE_MS = 24 * 60 * 60 * 1000
const ADP_MARKER_KEY = 'fantrax:devy-adp:last-run'
/* Outlives the cadence on purpose — see above. */
const ADP_MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type DevyAdpIngestResult = {
  /** Players Fantrax priced. */
  priced: number
  /** Of those, how many we could give a school to. */
  withSchool: number
  updated: number
  /** Priced players with no DevyPlayer at that name+school. */
  unmatched: number
  /**
   * Team defence / special-teams rows, which are not people.
   *
   * ⚠ COUNTED SEPARATELY RATHER THAN FOLDED INTO `unmatched`, because "we hold
   * no devy row for this player" and "this was never a player" are different
   * facts and only the first one is a coverage problem.
   */
  teamEntries: number
  /** Skipped because the name+school matched more than one row — never guessed. */
  ambiguous: number
  /**
   * True when the cadence gate declined to run.
   *
   * ⚠ SKIPPED IS NOT FAILED AND IS NOT A ZERO RUN. "Inside its cadence" and "it
   * found nothing" look identical in a bare result object, and the second is a
   * problem while the first is the system working.
   */
  skipped?: boolean
  reason?: string
  error?: string
}

/**
 * `"Abney, Christian"` → `"christian abney"`.
 *
 * ⚠ FANTRAX WRITES "LAST, FIRST" AND THE DEVY TABLE WRITES "FIRST LAST". Both
 * the ADP feed and the roster payload use the comma form; `DevyPlayer.name` is
 * "Noah Fox-Flores". Comparing them unflipped matches almost nothing, which
 * would read as "Fantrax has no ADP for our players" rather than as a format
 * mismatch.
 */
export function normalizePlayerName(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''
  const parts = trimmed.split(',')
  const ordered = parts.length === 2 ? `${parts[1]!.trim()} ${parts[0]!.trim()}` : trimmed
  return ordered
    .toLowerCase()
    /* Punctuation varies between sources — O'Brien / OBrien, Fox-Flores / Fox Flores. */
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Is this Fantrax row a TEAM rather than a person?
 *
 * 🛑 BOTH FEEDS CARRY TEAM ROWS AND BOTH INGESTIONS WERE COUNTING THEM AS
 * MISSES. Fantrax lists team defence / special-teams units alongside players, so
 * "Defense/Special Teams" and "Ark" were being name-matched against a registry of
 * humans, failing, and landing in `unmatched` — which made coverage look worse
 * than it is and spent one database round trip per row learning nothing.
 *
 * Measured on production 2026-08-31:
 *   getPlayerIds?sport=CFB   690 of 16,904   5 distinct names
 *                            (Defense/Special Teams, Special Teams, Team,
 *                             Team Offense, Team Defense)
 *   getAdp?sport=NCAAF        80 of    997   school abbreviations (Ark, Army…)
 *
 * ⚠ THE TEST IS THE COMMA, AND THAT IS A MEASUREMENT RATHER THAN A GUESS.
 * Fantrax writes a person as "Last, First". On the CFB map the three candidate
 * signals agree EXACTLY — no-comma, no-school, and both — at 690 rows each, so
 * not one real player is missing a school and not one team row has a comma.
 *
 * ⚠ A MONONYM WOULD BE EXCLUDED BY THIS RULE. None exists in either feed today
 * (checked, not assumed), and the trade is deliberate: excluding a real player
 * leaves a visible gap, where admitting a team row risks attaching a defence's
 * ADP to a person.
 */
export function isTeamEntry(entry: { name?: unknown }): boolean {
  return !String(entry?.name ?? '').includes(',')
}

/** School strings differ in case and punctuation between the two sources. */
export function normalizeSchool(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * Join ADP rows to their school using the CFB player map. Pure, so the matching
 * rule is testable without calling Fantrax.
 */
export function attachSchools(
  adp: FantraxAdpEntry[],
  playerMap: Record<string, FantraxPlayerRef>,
): Array<FantraxAdpEntry & { school: string | null }> {
  return adp.map((entry) => {
    const ref = playerMap[entry.fantraxId]
    /* `team` on a CFB ref is the school. Absent for a graduated or inactive id,
       which is expected rather than an error — roughly one id in twenty. */
    const school = ref?.team ? String(ref.team) : null
    return { ...entry, school }
  })
}

export async function ingestFantraxDevyAdp(
  opts?: { force?: boolean },
): Promise<DevyAdpIngestResult> {
  const empty: DevyAdpIngestResult = {
    priced: 0,
    withSchool: 0,
    updated: 0,
    unmatched: 0,
    ambiguous: 0,
    teamEntries: 0,
  }

  if (opts?.force !== true) {
    const marker = await prisma.sportsDataCache
      .findUnique({ where: { cacheKey: ADP_MARKER_KEY } })
      .catch(() => null)
    const at =
      marker?.data && typeof marker.data === 'object' && !Array.isArray(marker.data)
        ? (marker.data as Record<string, unknown>).at
        : null
    const lastMs = typeof at === 'string' ? new Date(at).getTime() : NaN
    if (Number.isFinite(lastMs) && Date.now() - lastMs < ADP_CADENCE_MS) {
      const hours = Math.round((Date.now() - lastMs) / 3_600_000)
      return { ...empty, skipped: true, reason: `ran ${hours}h ago; cadence is 24h` }
    }
  }

  const [adpRes, mapRes] = await Promise.all([getFantraxAdp('NCAAF'), getFantraxPlayerIds('CFB')])
  if (!adpRes.ok) return { ...empty, error: adpRes.failure.message }
  /*
   * ⚠ NO SCHOOL MEANS NO WRITE. Without the player map every match would fall
   * back to name-only, which is the ambiguity this module exists to refuse. A
   * failed map is reported rather than silently downgrading the join.
   */
  if (!mapRes.ok) return { ...empty, priced: adpRes.data.length, error: mapRes.failure.message }

  const withSchools = attachSchools(adpRes.data, mapRes.data)
  const result: DevyAdpIngestResult = {
    priced: adpRes.data.length,
    withSchool: withSchools.filter((e) => e.school).length,
    updated: 0,
    unmatched: 0,
    ambiguous: 0,
    teamEntries: 0,
  }

  for (const entry of withSchools) {
    /* A team defence is not a player and can never match one. Counted on its
       own so it never reads as a coverage gap. */
    if (isTeamEntry(entry)) {
      result.teamEntries += 1
      continue
    }
    if (!entry.school) {
      result.unmatched += 1
      continue
    }
    const wantName = normalizePlayerName(entry.name)
    const wantSchool = normalizeSchool(entry.school)
    if (!wantName || !wantSchool) {
      result.unmatched += 1
      continue
    }

    /*
     * Candidates are narrowed in SQL by name, then filtered on the normalized
     * school in JS — school abbreviations differ between the two sources
     * ("BGSU" vs "Bowling Green"), so an equality filter in SQL would miss.
     */
    const parts = wantName.split(' ')
    const last = parts[parts.length - 1] ?? ''
    const candidates = await prisma.devyPlayer
      .findMany({
        where: { name: { contains: last, mode: 'insensitive' } },
        select: { id: true, name: true, school: true },
        take: 40,
      })
      .catch(() => [])

    const matches = candidates.filter(
      (c) =>
        normalizePlayerName(c.name) === wantName &&
        normalizeSchool(c.school ?? '').startsWith(wantSchool.slice(0, 4)),
    )

    if (matches.length === 0) {
      result.unmatched += 1
      continue
    }
    /* ⚠ MORE THAN ONE MATCH IS NOT A MATCH. Writing to either would price the
       wrong player, so it is counted and skipped. */
    if (matches.length > 1) {
      result.ambiguous += 1
      continue
    }

    await prisma.devyPlayer
      .update({ where: { id: matches[0]!.id }, data: { devyAdp: entry.adp } })
      .then(() => {
        result.updated += 1
      })
      .catch(() => {
        result.unmatched += 1
      })
  }

  /*
   * ⚠ THE MARKER IS WRITTEN EVEN WHEN NOTHING MATCHED. The run happened, and the
   * cost of the run is the two provider fetches — repeating them in an hour
   * because zero rows matched would burn the quota for exactly the league whose
   * players we cannot match yet. A failed marker write is swallowed for the same
   * reason devyIntelRefresh swallows its own: the ingest already succeeded.
   */
  const expiresAt = new Date(Date.now() + ADP_MARKER_TTL_MS)
  const data = {
    at: new Date().toISOString(),
    priced: result.priced,
    updated: result.updated,
    unmatched: result.unmatched,
    ambiguous: result.ambiguous,
  }
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: ADP_MARKER_KEY },
      update: { data, expiresAt },
      create: { cacheKey: ADP_MARKER_KEY, data, expiresAt },
    })
    .catch(() => {})

  return result
}
