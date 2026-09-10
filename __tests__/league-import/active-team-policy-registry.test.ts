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
  'app/api/leagues/[leagueId]/dynasty-projections/handler.ts':
    'MIXED (deferred) — one read feeds four consumers that disagree; needs consumer-level filtering in the projections builder.',
  'lib/ai-tools-start-sit/opponentMatchup.ts':
    'MIXED (deferred) — one read feeds four consumers in fetchNativeOpponentMatchup, current and resolution mixed.',
  'lib/shared-services/league-hub/userOsContext.ts':
    'MIXED (deferred) — and the naive consumer-side filter is DEMONSTRABLY UNSAFE, which is why it is deferred rather than patched: activeLeagueContext resolves viewerTeam from the UNFILTERED set, so an archived-but-claimed viewer would be absent from a filtered standings array; strategyRecommendations/playoffRecommendations guard only on viewerTeam truthiness, giving rankIndex -1 and percentile 1 + 1/(n-1) > 1 — rendering "#0 of 11 (109th percentile)" and classifying the seat strong_contender. Needs viewer-presence handling in those generators first.',
  'lib/trade-value-console/roster-context-loader.ts':
    'MIXED (deferred) — opponentTeams is current-state while the sibling consumer resolves references.',
}

const FILTERED_MARKERS = [
  'selectActiveTeams',
  'isActiveTeam',
  'ACTIVE_TEAM_WHERE',
  'ORPHAN_TEAM_WHERE',
]

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

/**
 * Exactly the text of ONE `leagueTeam.*(...)` call, from its opening paren to its matching close.
 *
 * 🛑 A FIXED-SIZE LINE WINDOW UNDER-DETECTS, AND THIS GUARD SHIPPED THAT BUG FIRST. The original
 * took 8 lines from the call site, which in `PowerRankingGenerator` bled into the NEXT query in the
 * same `Promise.all` — `prisma.league.findUnique({ where: { id: leagueId } })`. Its `id:` tripped
 * the "this is a narrowed lookup, skip it" test, so a genuinely unguarded enumeration was silently
 * passed over. Caught by mutating the guard, not by reading it.
 */
function callWindow(lines: string[], start: number): string {
  let depth = 0
  let seenOpen = false
  const out: string[] = []
  for (let i = start; i < Math.min(lines.length, start + 40); i++) {
    const line = lines[i]!
    out.push(line)
    for (const ch of line) {
      if (ch === '(') {
        depth++
        seenOpen = true
      } else if (ch === ')') depth--
    }
    if (seenOpen && depth <= 0) break
  }
  return out.join('\n')
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

/** A league-wide enumeration: `leagueTeam.findMany/count` whose `where` narrows only by leagueId. */
function findUnguardedEnumerations(): Array<{ file: string; line: number }> {
  const hits: Array<{ file: string; line: number }> = []
  for (const abs of [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]) {
    const rel = relative(ROOT, abs).split(sep).join('/')
    const src = readFileSync(abs, 'utf8')
    if (!src.includes('leagueTeam.')) continue

    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!/leagueTeam\.(findMany|count)\(/.test(lines[i]!)) continue
      const window = callWindow(lines, i)
      /* Only a league-wide read; a narrowing key means it is a lookup, not an enumeration. */
      if (!/where:\s*\{[^}]*leagueId/.test(window)) continue

      /*
       * 🛑 SCOPE THE NARROWING TEST TO THE `where` CLAUSE — THIS GUARD UNDER-DETECTED TWICE.
       *
       * First it used a fixed 8-line window that bled into the adjacent query. That was fixed.
       * It then still ran the narrowing-key test against the WHOLE call, so an innocuous
       * `select: { id: true }` or an `orderBy` mentioning an id read as "this is a narrowed
       * lookup, skip it" — and a genuinely unguarded league-wide enumeration was passed over.
       * Only keys inside `where` say anything about which ROWS are returned.
       */
      const whereClause = extractWhereClause(window)
      if (/externalId:|\bid:\s|claimedByUserId:|platformUserId:\s*[^{]/.test(whereClause)) continue
      if (FILTERED_MARKERS.some((m) => src.includes(m))) continue
      if (ENUMERATION_EXCEPTIONS[rel]) continue
      hits.push({ file: rel, line: i + 1 })
    }
  }
  return hits
}

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

  it('the guard is capable of finding something — it is not a dead scan', () => {
    /*
     * 🛑 THE POSITIVE CONTROL. A registry guard that silently stops matching (a changed API
     * surface, a walk that no longer reaches `lib/`) reports an empty array, which is
     * indistinguishable from success. This asserts the scanner still sees the shape it hunts.
     */
    const seen: string[] = []
    for (const abs of walk(join(ROOT, 'lib'))) {
      const src = readFileSync(abs, 'utf8')
      if (/leagueTeam\.(findMany|count)\(/.test(src)) seen.push(abs)
    }
    expect(seen.length).toBeGreaterThan(20)
  })

  it('every exception states a reason', () => {
    for (const [file, reason] of Object.entries(ENUMERATION_EXCEPTIONS)) {
      expect(reason.length, `${file} has no reason`).toBeGreaterThan(30)
    }
  })

  it('the census artifact is committed alongside the registry', () => {
    /* The registry is the enforcement; the census is the review record. Neither stands alone. */
    const census = readFileSync(
      join(ROOT, 'docs', 'import-integrity', 'LEAGUETEAM_READER_CENSUS.md'),
      'utf8',
    )
    expect(census).toMatch(/No reader is left unclassified/)
    expect(census).toMatch(/\| \*\*Total\*\* \| \*\*194\*\* \| \*\*146\*\* \|/)
  })
})
