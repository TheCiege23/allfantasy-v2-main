/**
 * Batch A/A.1 integration — the active-team policy guard, backed by the census registry.
 *
 * 🛑 A BLANKET BAN WOULD BE WRONG, WHICH IS WHY THIS IS A REGISTRY AND NOT A GREP.
 * Most `leagueTeam.find*` readers correctly need no orphan filter: a lookup map keyed by a unique
 * id cannot be reached from current data, and a historical read MUST retain archived teams or the
 * attribution archival exists to preserve is lost. Forbidding them all would break history to fix
 * a display bug.
 *
 * So the guard watches ONE thing: a LEAGUE-WIDE ENUMERATION (`where: { leagueId }` with no
 * narrowing key) that neither filters nor is registered as a deliberate exception. New readers of
 * that exact shape fail until someone classifies them — which is the census being enforced rather
 * than merely written down.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

/**
 * League-wide enumerations that deliberately DO NOT filter archived teams.
 *
 * ⚠ EVERY ENTRY NEEDS A REASON, AND THE REASON IS THE REVIEW. An allowlist whose entries are bare
 * paths becomes a place to silence the guard; one that states why each is safe stays auditable.
 * Adding a line here is a visible decision in a diff, which is the whole point.
 */
const ENUMERATION_EXCEPTIONS: Record<string, string> = {
  // ── category 3: identity / reference maps ───────────────────────────────────────────────
  'lib/core-app/matchup.ts':
    'Identity map keyed by unique externalId. An archived team has no current matchup, so it is unreachable; filtering would break resolution of a historical one.',
  'lib/decision-os/world/port.ts':
    'Facts substrate. Carries isOrphan to consumers (league-pulse, leagueIntelEnrichedWorld already branch on it) rather than deciding for them; the id/externalId map resolves historical matchups.',
  'lib/scoring-engine/resolveTeamLabels.ts':
    'Label lookup keyed by team id — a historical scoreboard row still needs its team name.',
  'lib/zombie/rosterTeamMap.ts': 'Roster→team identity map; archived teams must still resolve.',
  'lib/import-os/collector/fantraxMatchupParity.ts':
    'Name-keyed map. Names collide, so it PREFERS the active team rather than excluding the archived one, which would break historical matchup resolution.',

  // ── category 6: import / reconciliation lifecycle ───────────────────────────────────────
  'lib/import-os/collector/applySleeperLeagueSync.ts':
    'The reconciliation writer itself. It must read ALL teams or it cannot find the absent one to archive.',
  'lib/league-import/sleeper/SleeperLeagueCreationBootstrapService.ts':
    'Bootstrap upsert; re-activates a returning team, so it must see archived rows.',
  'lib/league-import/placeholderClaim.ts': 'Claim path already branches on isOrphan explicitly.',
  'lib/league-import/canonicalSeasonMaterialization.ts':
    'Materialises a SEASON snapshot — the teams that played that season, including ones later archived.',
  'lib/league-import/avatarMirror.ts':
    'Mirrors avatars by team id; harmless for an archived team and needed if it returns.',
  'lib/league/sleeper-import-process.ts': 'Import lifecycle; branches on isOrphan explicitly.',
  'lib/tournament/importTournamentFromLeagues.ts': 'Import lifecycle; branches on isOrphan explicitly.',

  // ── category 4: historical / statistical ────────────────────────────────────────────────
  'lib/tournament/importedStandingsSource.ts':
    'Historical standings source — a departed team still played those games.',
  'lib/tournament/ingestWeeklyPlayerScores.ts': 'Historical score ingestion, attributed per team.',
  'lib/survivor/SurvivorTimelineResolver.ts':
    'Timeline is a historical record; an eliminated or departed team must remain in it.',
  'lib/schedule-runtime/resolveNflRedraftScheduleRuntime.ts':
    'Resolves a schedule that may include already-played weeks against a since-archived team.',
  'lib/data-warehouse/HistoricalFactGenerator.ts':
    'Ingests SEASON STANDING FACTS. A team that played the season must be attributed in it, whatever happened to the seat afterwards.',
  'lib/sports-media-engine/RecapGenerator.ts':
    'Season recap, read alongside SeasonResult. Recapping a season without the team that played it would be wrong.',
  'app/api/devy/import/match/route.ts':
    'Import identity matching against existing league managers — it must see every seat to match one.',

  // ── category 5: admin / commissioner monitoring ─────────────────────────────────────────
  'app/api/commissioner/leagues/[leagueId]/managers/route.ts':
    'ADMIN: archived teams are shown deliberately — a commissioner needs to see that a seat left.',
  'app/api/commissioner/leagues/[leagueId]/league-settings/route.ts':
    'ADMIN: settings view over the full roster of seats, archived included.',
  'app/api/commissioner/leagues/[leagueId]/renew/route.ts':
    'ADMIN: renewal decides which seats carry forward, so it must see archived ones.',
  'app/api/leagues/[leagueId]/downsize/handler.ts':
    'ADMIN: downsizing operates on the full seat list and branches on isOrphan explicitly.',
  'lib/commissioner-workspace/rosterReads.ts':
    'ADMIN: counts orphans on purpose — that is the metric.',
  'lib/chimmy-alerts/ChimmyAlertSignalHydrator.ts':
    'Queries isOrphan: true deliberately to raise an orphan-seat alert.',
  'lib/commissioner-ui/managers/managerNames.ts':
    'ADMIN: name resolution across all seats, archived included.',
  'lib/invite-engine/InviteEngine.ts':
    'ADMIN: counts seats to decide invite capacity; branches are commissioner-facing.',
  'lib/admin-dashboard/DuplicateManagerVerificationService.ts':
    'ADMIN verification tool operating on its own fixture manifest.',

  // ── surfaces reviewed and judged non-current ────────────────────────────────────────────
  'app/api/leagues/[leagueId]/draft/import/validate/route.ts':
    'Draft import validation compares against the stored seat set, archived included.',
  'app/api/leagues/[leagueId]/draft/settings/route.ts':
    'Draft settings operate on stored seats; a draft may predate an archival.',
  'app/api/leagues/[leagueId]/fill-empty-slots/handler.ts':
    'Explicitly works on empty/orphaned seats — filtering them is the opposite of its job.',
  'app/api/leagues/[leagueId]/zombie/summary/route.ts':
    'Zombie format tracks eliminated seats; they must remain visible.',
  'lib/zombie/ai/ZombieAIContext.ts': 'Same: eliminated seats are the format.',
  'app/api/dynasty-outlook/route.ts':
    'Multi-season outlook reads historical performance per seat.',
  'lib/ai/leagueSportsGroundingPacket.ts':
    'Grounding packet includes historical context; carries the flag rather than filtering.',
  'lib/core-app/draftHq.ts': 'Draft HQ counts stored seats, which may predate an archival.',
  'lib/core-app/trades.ts': 'Counts seats for trade history context, not a current partner list.',
  'lib/trending-players/trendCardEnrichment.ts':
    'Enriches trend cards by team id; an archived team still owned a trending player historically.',
  'app/api/league/trend-board/route.ts': 'Already branches on isOrphan explicitly.',

  // ── surfaced by the CORRECTED scanner, classified in the census pass ────────────────────
  // Identity maps: consumed only as keyed .get()/find lookups that resolve a reference.
  'lib/agents/anthropic-pipeline.ts':
    'Identity map — an externalId-keyed Map resolving the caller own team plus a find-by-id resolving an opponent reference; no current-state consumer.',
  'lib/ai/sim/groundedTradeDelta.ts':
    'Identity map — builds teamByExternal solely to resolve a scheduled opponent rosterId into a platformUserId for roster lookup.',
  'lib/league-history/leagueWarehouseReads.ts':
    'Historical, and MIXED on closer reading — three callers are pure label resolution with a `?? fallback` (filtering would degrade a label and remove no row), but readManagerActivity uses the map as a MEMBERSHIP GATE (`const team = names.get(...)`, then `if (!team) continue`, no fallback), so the query must stay unfiltered or historical activity rows silently vanish.',
  'lib/psychological-profiles/TransactionFactBackfill.ts':
    'Historical backfill — the identity map resolves a LeagueTradeHistory row Sleeper user id to the roster id stamped onto dw_transaction facts.',
  'lib/tournament/rosterCompliance.ts':
    'Identity map — handleFor resolves a display handle for rows enumerated from the Roster table; it never gates compliance.',
  'lib/tournament/topPerformers.ts':
    'Identity map — a two-key index resolving a roster to its manager label; it never gates or ranks.',
  'app/api/cron/decision-os-activity-ingest/route.ts':
    'Identity map — a platformUserId-keyed Map consumed only by .get() to attribute imported activity to an AllFantasy user.',
  'app/api/leagues/[leagueId]/rivalries/[rivalryId]/head-to-head/route.ts':
    'Historical — an externalId-keyed lookup resolving display names for historical MatchupFact rows; no current-state consumer.',
  'lib/sleeper-sync.ts':
    'Import lifecycle — the Sleeper writer reading its own prior rows by externalId to carry pointsAgainst/currentRank forward into its own upsert.',

  /*
   * 🛑 MIXED READS — DOCUMENTED DEBT, DELIBERATELY NOT FIXED IN THIS BRANCH.
   *
   * Each of these feeds BOTH a current-state consumer AND an identity map or historical consumer
   * from one read. The correct repair is consumer-level filtering inside each subsystem, not a
   * `where` clause — a query filter here would starve the historical half, which is exactly the
   * regression this branch already made once in BroadcastModeEngine and had to undo.
   *
   * They are LEFT UNFILTERED on purpose, because unfiltered is the SAFE side of that asymmetry:
   * an extra row on a screen versus silently losing attribution. They also predate this branch —
   * `origin/main` already archives vanishing claimed teams, so they leak there today and this
   * branch does not make them worse in kind.
   *
   * Listed here so they are visible and enforced-as-known rather than silently passing. Each
   * needs its own change in its own subsystem; that is the proposed follow-up, not this batch.
   */
  /*
   * ⚠ THREE OF THE ORIGINAL FOUR ARE GONE FROM THIS LIST BECAUSE THEY WERE FIXED, NOT BECAUSE
   * THEY WERE RECLASSIFIED. Each turned out to have a clean consumer split once its data flow
   * was read rather than summarised — see the corrective commit for the per-file evidence:
   *
   *   - `lib/shared-services/league-hub/userOsContext.ts` — never mixed at all. Its one consumer
   *     is `standings`, and `viewerTeam` is derived FROM `standings`, so the counterexample that
   *     justified deferring it ("absent from standings while viewerTeam is still non-null")
   *     cannot occur. Now filtered at the query.
   *   - `lib/ai-tools-start-sit/opponentMatchup.ts` — filtered at the two current-state consumers
   *     (`paSorted`, `n`); `oppTeam` resolution stays on the unfiltered array.
   *   - `lib/trade-value-console/roster-context-loader.ts` — `opponentTeams` filtered; the
   *     `externalId` resolver stays on the unfiltered array.
   */
  'app/api/leagues/[leagueId]/dynasty-projections/handler.ts':
    'MIXED (deferred) — `targetTeams` (which receives a PERSISTED projection, `persist: true`) and the `teamCount` fallback are current-state, while `buildFuturePicksByTeam` resolves future-pick ownership through the same array. The consumer split is clean in shape but the write is persistent, so it is deliberately left to its own change rather than folded into a corrective pass.',
}

const FILTERED_MARKERS = [
  'selectActiveTeams',
  'isActiveTeam',
  'ACTIVE_TEAM_WHERE',
  'ORPHAN_TEAM_WHERE',
]

/**
 * Call sites the CORRECTED scanner revealed and that have NOT been individually classified yet.
 *
 * ⚠ THIS IS DEBT, NOT A VERDICT. `ENUMERATION_EXCEPTIONS` above means "read, and correct to
 * retain archived teams". This means "the scanner can now see it, and nobody has read it". The
 * two are deliberately separate lists so a backlog can never be mistaken for a review.
 */
const PENDING_CLASSIFICATION: Record<string, string> = {
  /* :57 */
  'lib/chimmy-context/providers/StandingsContextProvider.ts':
    'Chimmy standings context — league-wide read feeding a model-facing standings block; consumer trace not yet done.',
  /* :170 */
  'lib/commissioner-hub/managerHealth.ts':
    'getLeagueManagerHealth — a manager-health enumeration; may be admin-monitoring (retain) like its siblings, unread.',
  /* :155 */
  'lib/core-app/allPlay.ts':
    'getAllPlayBoard — all-play records over the league; denominator-sensitive, consumer trace not yet done.',
  /* :237 */
  'lib/core-app/commissionerHub.ts':
    'getCommissionerHub — likely admin-monitoring (retain), but not yet read against the category-5 rule.',
  /* :257 */
  'lib/core-app/dash3aPanels.ts':
    'getRivalRecords — rival records panel; historical-vs-current split unexamined.',
  /* :219 */
  'lib/core-app/leagueActivity.ts':
    'getLeagueActivity — activity feed; may need archived seats to attribute past rows, unread.',
  /* :139 */
  'lib/core-app/leagueCareer.ts':
    'getLeagueCareer — career records are historical by name; retain is plausible but unverified.',
  /* :166 */
  'lib/core-app/leagueScoreboard.ts':
    'getLeagueScoreboard — current scoreboard; strong active-enumeration candidate, consumer trace not yet done.',
  /* :205,299 */
  'lib/core-app/leagueStandings.ts':
    'getLeagueStandings and loadSeasonHistory in one file — one is current standings and one is season history, so they almost certainly need OPPOSITE treatment. Must be read as two.',
  /* :158 */
  'lib/core-app/managerPresence.ts':
    'getManagerPresence — presence is current by definition; strong active-enumeration candidate, unread.',
  /* :357 */
  'lib/core-app/matchupPulse.ts':
    'getMatchupPulse — matchup pulse mixes a current week with past weeks; split unexamined.',
  /* :978 */
  'lib/core-app/playerCard.ts':
    'loadLeague inside the player card — league seat list for the league context of a player, unread.',
  /* :667 */
  'lib/core-app/playerFinder.ts':
    'resolveLeagueSlots — resolves seats to slots; an archived seat may or may not hold a slot, unread.',
  /* :133 */
  'lib/core-app/playerLeagueView.ts':
    'getPlayerLeagueView — per-league view of a player; ownership resolution vs current roster unexamined.',
  /* :137 */
  'lib/core-app/playerSuggest.ts':
    'buildRosterIndex — index over league rosters; keyed-lookup vs enumeration not yet distinguished.',
  /* :368 */
  'lib/core-app/playerTradeVisual.ts':
    'getPlayerTradeVisual — trade visual may name a departed counterparty; retain is plausible, unverified.',
  /* :101 */
  'lib/core-app/publicStandings.ts':
    'getPublicLeagueStandings — a PUBLIC standings surface; strong active-enumeration candidate, unread.',
  /* :197 */
  'lib/core-app/scout.ts':
    'getScoutData — scouting over league seats; current-vs-historical split unexamined.',
  /* :371 */
  'lib/core-app/tradesBoard.ts':
    'getTradesBoard — a trades board names historical counterparties; retain is plausible, unverified.',
  /* :207 */
  'lib/draft-intel/importedDraftReport.ts':
    'buildImportedDraftReport — a draft predates an archival, so retain is plausible; not yet read.',
  /* :216 */
  'lib/dynasty-war-room/dynastyWarRoomContext.ts':
    'buildDynastyWarRoomContext — league context for the war room; consumer trace not yet done.',
  /* :973 */
  'lib/league-import/ImportedLeagueCommitService.ts':
    'persistImportedLeagueFromNormalization — inside the import writer, which category 6 says must see archived rows; almost certainly a legitimate exception but it is newly visible and unread.',
  /* :135 */
  'lib/rivalry-engine/rivalryBoard.ts':
    'getRivalryBoard — rivalries name departed managers, so retain is plausible; not yet read.',
  /* :1035,1124,1266 */
  'lib/trade-intel/tradeContextNotes.ts':
    'buildFormatNotes, buildScaleNotes and buildPostureAndPickNotes — THREE separate league-wide reads in one file that may not agree with each other; must be read individually.',
  /* :194 */
  'lib/values/leagueDefenderBoard.ts':
    'loadLeagueDefenderBoard — a defender board over league seats; denominator-sensitive, unread.',
  /* :109 */
  'lib/waiver-wire/process-engine.ts':
    'processWaiverClaimsForLeague — a WRITE path processing claims per seat; an archived seat receiving a waiver award would be a real defect, so this one is high priority.',
  /* :189 */
  'app/api/leagues/[leagueId]/trades/rosters/route.ts':
    'GET trades/rosters — roster list for the trade UI; selectable-partner exposure like roster-context-loader, unread.',
}

/** The backlog may shrink. It may not grow — a new unfiltered enumeration must be dealt with. */
const PENDING_BUDGET = 27

/**
 * Every `.ts`/`.tsx` under a root, excluding tests and build output.
 *
 * Kept separate from the scanner so the scanner can be handed SYNTHETIC sources by its own
 * positive control. A control that re-implements the scan instead of running it proves nothing
 * about the scan — which is exactly the bug this file shipped for two commits.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.next-')) continue
    const p = join(dir, entry)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(entry) && !p.includes('__tests__')) out.push(p)
  }
  return out
}

type Source = { rel: string; src: string }

function collectSources(): Source[] {
  return [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))].map((abs) => ({
    rel: relative(ROOT, abs).split(sep).join('/'),
    src: readFileSync(abs, 'utf8'),
  }))
}

/**
 * 🛑 MATCH THE CALL ACROSS A LINE BREAK. A PER-LINE REGEX IS BLIND TO A WRAPPED CALL, AND THAT
 * BLINDNESS HID 55 OF 175 CALL SITES — INCLUDING ONE THIS VERY BRANCH CREATED.
 *
 * Prettier wraps `prisma.leagueTeam.count({ ... })` onto two lines as soon as the line gets long:
 *
 *     prisma.leagueTeam
 *       .count({ where: { leagueId } })
 *
 * The original scanner tested `lines[i]` against a per-line pattern, so the verb and the receiver
 * being on different lines made the call invisible. Adding `ACTIVE_TEAM_WHERE` to
 * `lib/chimmy/tools/leagueByName.ts` pushed that exact call over the width limit, so the fix took
 * its own call site out of the guard's sight — remove the filter again and nothing goes red.
 */
const ENUMERATION_CALL = /leagueTeam\s*\.\s*(?:findMany|count)\s*\(/g

/** The exact text of one call, from the receiver to the paren that closes its argument list. */
function callText(src: string, from: number): string {
  const open = src.indexOf('(', from)
  if (open === -1) return src.slice(from, from + 4000)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return src.slice(from, i + 1)
    }
  }
  return src.slice(from, from + 4000)
}

/**
 * Just the `where: { ... }` object of a call, brace-balanced.
 *
 * Returns '' when there is no `where` — a caller must treat that as "no narrowing keys", which is
 * the conservative direction: an unparseable call gets INSPECTED rather than skipped.
 */
function extractWhereClause(window: string): string {
  const at = window.indexOf('where:')
  if (at === -1) return ''
  const open = window.indexOf('{', at)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < window.length; i++) {
    const ch = window[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return window.slice(open, i + 1)
    }
  }
  return window.slice(open)
}

/**
 * 🛑 SCOPE THE NARROWING TEST TO THE `where` CLAUSE. Only keys inside `where` say anything about
 * which ROWS come back; a `select: { id: true }` or an `orderBy` naming an id says nothing, and
 * reading them as "this is a narrowed lookup, skip it" silently passed over real enumerations.
 */
const NARROWING_KEY = /externalId:|\bid:\s|claimedByUserId:|platformUserId:\s*[^{]/

/**
 * The scanner. A league-wide enumeration is `leagueTeam.findMany`/`count` whose `where` narrows
 * only by `leagueId`, in a file that names no filtering helper and is not registered.
 *
 * Takes its sources as an argument so the positive control below can run THIS function against
 * planted code. `findUnguardedEnumerations()` is the production entry point.
 */
function scanSources(sources: Source[]): Array<{ file: string; line: number }> {
  const hits: Array<{ file: string; line: number }> = []
  for (const { rel, src } of sources) {
    if (!src.includes('leagueTeam')) continue
    ENUMERATION_CALL.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ENUMERATION_CALL.exec(src)) !== null) {
      const call = callText(src, m.index)
      /* Only a league-wide read; a narrowing key means it is a lookup, not an enumeration. */
      if (!/where:\s*\{[^}]*leagueId/.test(call)) continue
      if (NARROWING_KEY.test(extractWhereClause(call))) continue
      if (FILTERED_MARKERS.some((k) => src.includes(k))) continue
      if (ENUMERATION_EXCEPTIONS[rel] || PENDING_CLASSIFICATION[rel]) continue
      hits.push({ file: rel, line: src.slice(0, m.index).split('\n').length })
    }
  }
  return hits
}

function findUnguardedEnumerations(): Array<{ file: string; line: number }> {
  return scanSources(collectSources())
}

/**
 * Sources the scanner MUST report, and sources it MUST NOT.
 *
 * These are the real shapes that defeated earlier revisions, kept as executable fixtures rather
 * than prose. Blinding the scanner in any of the ways it has actually been blinded — returning
 * early, matching per line, widening the narrowing test back to the whole call — turns these red.
 */
const MUST_REPORT: Source[] = [
  {
    rel: '__control__/bare.ts',
    src: 'const t = await prisma.leagueTeam.findMany({ where: { leagueId } })\n',
  },
  {
    /* The form the where-scoping repair was written for. */
    rel: '__control__/select-id.ts',
    src: 'const t = await prisma.leagueTeam.findMany({\n  where: { leagueId },\n  select: { id: true, teamName: true },\n})\n',
  },
  {
    /* The form the per-line regex could not see at all. */
    rel: '__control__/wrapped.ts',
    src: 'const n = await prisma.leagueTeam\n  .count({ where: { leagueId: l.id } })\n  .catch(() => 0)\n',
  },
  {
    /* An `orderBy` naming an id is not a narrowing key either. */
    rel: '__control__/order-by-id.ts',
    src: 'const t = await prisma.leagueTeam.findMany({\n  where: { leagueId },\n  orderBy: { id: "asc" },\n})\n',
  },
]

const MUST_NOT_REPORT: Source[] = [
  {
    rel: '__control__/filtered.ts',
    src: 'const t = await prisma.leagueTeam.findMany({ where: { ...ACTIVE_TEAM_WHERE, leagueId } })\n',
  },
  {
    /*
     * ⚠ A narrowing key must be written `key: value`. Object shorthand (`{ leagueId, externalId }`)
     * carries no colon and is NOT recognised, so a shorthand lookup is reported as an enumeration.
     * That is a false positive in the SAFE direction — it gets inspected — and is left as-is.
     */
    rel: '__control__/narrowed.ts',
    src: 'const t = await prisma.leagueTeam.findMany({ where: { leagueId, externalId: ref } })\n',
  },
  {
    rel: '__control__/not-a-team-read.ts',
    src: 'const t = await prisma.league.findMany({ where: { leagueId } })\n',
  },
]

describe('active-team policy guard', () => {
  it('every league-wide enumeration filters archived teams or is a registered exception', () => {
    const unguarded = findUnguardedEnumerations()
    expect(
      unguarded,
      `Unregistered league-wide LeagueTeam enumeration(s):\n${unguarded
        .map((h) => `  ${h.file}:${h.line}`)
        .join('\n')}\n\nEither filter with selectActiveTeams/ACTIVE_TEAM_WHERE, or add the file to ` +
        `ENUMERATION_EXCEPTIONS with the reason it must retain archived teams.`,
    ).toEqual([])
  })

  /*
   * 🛑 THE POSITIVE CONTROL, AND IT RUNS THE PRODUCTION SCANNER.
   *
   * The version this replaced re-implemented a one-line regex scan and asserted it saw more than
   * 20 files. That passed with `findUnguardedEnumerations` hard-coded to `[]`: it proved `walk()`
   * reached `lib/` and nothing whatsoever about the scan. It went green through two separate
   * under-detection bugs, including the wrapped-call blindness it was written to catch.
   */
  it.each(MUST_REPORT)('the scanner reports the $rel shape', (fixture) => {
    expect(scanSources([fixture]).map((h) => h.file)).toEqual([fixture.rel])
  })

  it.each(MUST_NOT_REPORT)('the scanner stays silent on the $rel shape', (fixture) => {
    expect(scanSources([fixture])).toEqual([])
  })

  it('the scanner reaches the real tree — it is not scanning an empty source set', () => {
    /* Separate from the fixtures above: those prove it can SEE, this proves it is LOOKING here. */
    const sources = collectSources()
    expect(sources.length).toBeGreaterThan(500)
    expect(
      sources.filter((s) => {
        ENUMERATION_CALL.lastIndex = 0
        return ENUMERATION_CALL.test(s.src)
      }).length,
    ).toBeGreaterThan(20)
  })

  it('every exception states a reason', () => {
    for (const [file, reason] of Object.entries(ENUMERATION_EXCEPTIONS)) {
      expect(reason.length, `${file} has no reason`).toBeGreaterThan(30)
    }
  })

  /*
   * The debt ratchet. `PENDING_CLASSIFICATION` holds call sites the corrected scanner revealed
   * that have NOT yet been read individually. They are suppressed so the guard is usable, and
   * counted so the suppression cannot quietly grow. This list may shrink; it may not grow.
   */
  it('the pending-classification backlog does not grow', () => {
    expect(Object.keys(PENDING_CLASSIFICATION).length).toBeLessThanOrEqual(PENDING_BUDGET)
  })

  it('every pending entry states what is unknown about it', () => {
    for (const [file, note] of Object.entries(PENDING_CLASSIFICATION)) {
      expect(note.length, `${file} has no note`).toBeGreaterThan(30)
    }
  })

  it('the census artifact is committed alongside the registry', () => {
    /* The registry is the enforcement; the census is the review record. Neither stands alone. */
    const census = readFileSync(
      join(ROOT, 'docs', 'import-integrity', 'LEAGUETEAM_READER_CENSUS.md'),
      'utf8',
    )
    expect(census).toMatch(/\| \*\*Total \(same-line scan\)\*\* \| \*\*194\*\* \| \*\*146\*\* \|/)
    expect(census).toMatch(/263/)
  })
})
