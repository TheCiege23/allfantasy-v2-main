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
  'app/api/commissioner/leagues/[leagueId]/league-settings/route.ts#1':
    'ADMIN: settings view over the full roster of seats, archived included.',
  'app/api/commissioner/leagues/[leagueId]/league-settings/route.ts#2':
    'ADMIN: settings view over the full roster of seats, archived included.',
  'app/api/commissioner/leagues/[leagueId]/managers/route.ts#1':
    'ADMIN: archived teams are shown deliberately — a commissioner needs to see that a seat left.',
  'app/api/cron/decision-os-activity-ingest/route.ts#1':
    'Identity map — a platformUserId-keyed Map consumed only by .get() to attribute imported activity to an AllFantasy user.',
  'app/api/devy/import/match/route.ts#1':
    'Import identity matching against existing league managers — it must see every seat to match one.',
  'app/api/dynasty-outlook/route.ts#1':
    'Multi-season outlook reads historical performance per seat.',
  'app/api/league/trend-board/route.ts#1':
    'Already branches on isOrphan explicitly.',
  'app/api/leagues/[leagueId]/downsize/handler.ts#1':
    'ADMIN: downsizing operates on the full seat list and branches on isOrphan explicitly.',
  'app/api/leagues/[leagueId]/draft/import/validate/route.ts#1':
    'Draft import validation compares against the stored seat set, archived included.',
  'app/api/leagues/[leagueId]/draft/settings/route.ts#1':
    'Draft settings operate on stored seats; a draft may predate an archival.',
  'app/api/leagues/[leagueId]/draft/settings/route.ts#2':
    'Draft settings operate on stored seats; a draft may predate an archival.',
  'app/api/leagues/[leagueId]/fill-empty-slots/handler.ts#1':
    'Explicitly works on empty/orphaned seats — filtering them is the opposite of its job.',
  'app/api/leagues/[leagueId]/fill-empty-slots/handler.ts#2':
    'Explicitly works on empty/orphaned seats — filtering them is the opposite of its job.',
  'app/api/leagues/[leagueId]/rivalries/[rivalryId]/head-to-head/route.ts#1':
    'Historical — an externalId-keyed lookup resolving display names for historical MatchupFact rows; no current-state consumer.',
  'app/api/leagues/[leagueId]/trades/rosters/route.ts#1':
    'Identity maps only — namedTeams feeds teamNameByPlatformId / externalIdByPlatformId / teamMetaByPlatformId, all keyed .get() lookups resolving a trade counterparty.',
  'app/api/leagues/[leagueId]/zombie/summary/route.ts#1':
    'Zombie format tracks eliminated seats; they must remain visible.',
  'lib/admin-dashboard/DuplicateManagerVerificationService.ts#1':
    'ADMIN verification tool operating on its own fixture manifest.',
  'lib/agents/anthropic-pipeline.ts#1':
    'Identity map — an externalId-keyed Map resolving the caller own team plus a find-by-id resolving an opponent reference; no current-state consumer.',
  'lib/ai/leagueSportsGroundingPacket.ts#1':
    'Grounding packet includes historical context; carries the flag rather than filtering.',
  'lib/ai/sim/groundedTradeDelta.ts#1':
    'Identity map — builds teamByExternal solely to resolve a scheduled opponent rosterId into a platformUserId for roster lookup.',
  'lib/chimmy-alerts/ChimmyAlertSignalHydrator.ts#1':
    'Queries isOrphan: true deliberately to raise an orphan-seat alert.',
  'lib/commissioner-hub/managerHealth.ts#1':
    'Identity maps — teamByPlatformId and teamByLegacyRosterId resolve a health row back to a seat; no count or list is derived from the array.',
  'lib/commissioner-ui/managers/managerNames.ts#1':
    'ADMIN: name resolution across all seats, archived included.',
  // ── ARCHIVED-ONLY BY DESIGN ─────────────────────────────────────────────────────────────
  // These select archived teams on purpose. They were exempt for the WRONG REASON until the
  // 2026-09-10 polarity fix: the old predicate test granted protection to any clause merely
  // MENTIONING isOrphan, so a query returning ONLY archived teams read as one that excludes
  // them. Classified explicitly now, which is the point — the guard should make a deliberate
  // archived read state its case, not wave it through on a substring.
  'lib/commissioner-workspace/rosterReads.ts#2':
    'ARCHIVED-ONLY on purpose — this is the orphan metric itself (`isOrphan: true`), read beside the unfiltered total so a commissioner can see how many seats left. Filtering it would zero the number it exists to report.',
  'app/api/commissioner/leagues/[leagueId]/renew/route.ts#1':
    'ARCHIVED-ONLY on purpose — counts orphaned seats after removal to set `dispersalDraftEligible` (>= 2). The decision is ABOUT departed seats, so excluding them would make the flag permanently false.',

  'lib/commissioner-workspace/rosterReads.ts#1':
    'ADMIN: counts orphans on purpose — that is the metric.',
  'lib/core-app/allPlay.ts#1':
    'Identity map via buildRosterIdMap; the all-play rows come from WeeklyMatchup, and a departed team that played must keep its name.',
  'lib/core-app/dash3aPanels.ts#2':
    'Identity map plus viewer resolution — leagueTeams.find(claimedByUserId) and buildRosterIdMap; the rival rows come from WeeklyMatchup, not from this array.',
  'lib/core-app/leagueActivity.ts#1':
    'Identity map — byKey indexes platformUserId / sleeper:manager: / claimedByUserId / externalId so an activity row resolves to whichever spelling it was ingested with.',
  'lib/core-app/leagueCareer.ts#1':
    'Career is a HISTORICAL surface read alongside season facts; a departed manager must keep his career rows and his name.',
  'lib/core-app/leagueScoreboard.ts#1':
    'Identity map via buildRosterIdMap; scoreboard rows come from WeeklyMatchup and a played week against a since-archived team still needs its label.',
  'lib/core-app/leagueStandings.ts#1':
    'loadSeasonHistory — nameByKey resolves SeasonStandingFact rows for PAST seasons. A team that played the season must keep its name.',
  'lib/core-app/leagueStandings.ts#3':
    'getLeagueStandings — nameByRoster only; the standings population comes from WeeklyMatchup, so filtering here would leave a played row unlabelled and remove nobody.',
  'lib/core-app/managerPresence.ts#1':
    'Identity map — byKey resolves a manager key to a seat for attribution; presence rows come from activity, not from this array.',
  'lib/core-app/matchup.ts#1':
    'Identity map keyed by unique externalId. An archived team has no current matchup, so it is unreachable; filtering would break resolution of a historical one.',
  'lib/core-app/matchupPulse.ts#1':
    'Identity map keyed leagueId:externalId across leagues, resolving a matchup to a name.',
  'lib/core-app/playerCard.ts#1':
    'Two keyed .find() lookups only — the viewer own seat and the holder of the player being carded.',
  'lib/core-app/playerFinder.ts#2':
    'Keyed .find() lookups resolving a holder platformUserId or externalId to an owner across leagues.',
  'lib/core-app/playerLeagueView.ts#1':
    'Keyed .find() lookups — the viewer own seat and the holder of the player.',
  'lib/core-app/playerSuggest.ts#1':
    'Identity map — ownerByRoster resolves a roster id to an owner name; suggestions come from roster rows.',
  'lib/core-app/playerTradeVisual.ts#1':
    'Keyed .find() lookups resolving the viewer seat and the holder of the player.',
  'lib/core-app/publicStandings.ts#1':
    'nameByRoster only; the published rows come from WeeklyMatchup, so a departed team that played keeps its name and no live team is affected.',
  'lib/core-app/trades.ts#2':
    'Counts seats for trade history context, not a current partner list.',
  'lib/core-app/tradesBoard.ts#1':
    'Identity maps — managersByLeague byUserId / byRoster resolve a trade row to a manager name across leagues.',
  'lib/data-warehouse/HistoricalFactGenerator.ts#1':
    'Ingests SEASON STANDING FACTS. A team that played the season must be attributed in it, whatever happened to the seat afterwards.',
  'lib/decision-os/world/port.ts#1':
    'Facts substrate. Carries isOrphan to consumers (league-pulse, leagueIntelEnrichedWorld already branch on it) rather than deciding for them; the id/externalId map resolves historical matchups.',
  'lib/decision-os/world/port.ts#2':
    'Facts substrate. Carries isOrphan to consumers (league-pulse, leagueIntelEnrichedWorld already branch on it) rather than deciding for them; the id/externalId map resolves historical matchups.',
  'lib/draft-intel/importedDraftReport.ts#1':
    'Identity map teamByKey; a draft predates any archival and a pick by a departed manager must keep its label.',
  'lib/dynasty-war-room/dynastyWarRoomContext.ts#1':
    'Identity map teamByUser, plus standingsAvailable which is a DATA-PRESENCE probe (does any row carry a result), not a ranking.',
  'lib/import-os/collector/applySleeperLeagueSync.ts#1':
    'The reconciliation writer itself. It must read ALL teams or it cannot find the absent one to archive.',
  'lib/league-history/leagueWarehouseReads.ts#1':
    'Historical, and MIXED on closer reading — three callers are pure label resolution with a `?? fallback` (filtering would degrade a label and remove no row), but readManagerActivity uses the map as a MEMBERSHIP GATE (`const team = names.get(...)`, then `if (!team) continue`, no fallback), so the query must stay unfiltered or historical activity rows silently vanish.',
  'lib/league-import/ImportedLeagueCommitService.ts#2':
    'Inside the import writer: it reads the stored seat set to detect shape and whether a seat is held by someone else, so it must see archived rows.',
  'lib/league-import/avatarMirror.ts#1':
    'Mirrors avatars by team id; harmless for an archived team and needed if it returns.',
  'lib/league-import/canonicalSeasonMaterialization.ts#1':
    'Materialises a SEASON snapshot — the teams that played that season, including ones later archived.',
  'lib/league-import/sleeper/SleeperLeagueCreationBootstrapService.ts#1':
    'Bootstrap upsert; re-activates a returning team, so it must see archived rows.',
  'lib/league/sleeper-import-process.ts#1':
    'Import lifecycle; branches on isOrphan explicitly.',
  'lib/psychological-profiles/TransactionFactBackfill.ts#1':
    'Historical backfill — the identity map resolves a LeagueTradeHistory row Sleeper user id to the roster id stamped onto dw_transaction facts.',
  'lib/rivalry-engine/rivalryBoard.ts#1':
    'Identity map nameById; a rivalry names managers from past seasons and must resolve a departed one.',
  'lib/schedule-runtime/resolveNflRedraftScheduleRuntime.ts#1':
    'Resolves a schedule that may include already-played weeks against a since-archived team.',
  'lib/scoring-engine/resolveTeamLabels.ts#1':
    'Label lookup keyed by team id — a historical scoreboard row still needs its team name.',
  'lib/sleeper-sync.ts#1':
    'Import lifecycle — the Sleeper writer reading its own prior rows by externalId to carry pointsAgainst/currentRank forward into its own upsert.',
  'lib/sports-media-engine/RecapGenerator.ts#1':
    'Season recap, read alongside SeasonResult. Recapping a season without the team that played it would be wrong.',
  'lib/survivor/SurvivorTimelineResolver.ts#1':
    'Timeline is a historical record; an eliminated or departed team must remain in it.',
  'lib/tournament/importTournamentFromLeagues.ts#1':
    'Import lifecycle; branches on isOrphan explicitly.',
  'lib/tournament/importedStandingsSource.ts#1':
    'Historical standings source — a departed team still played those games.',
  'lib/tournament/ingestWeeklyPlayerScores.ts#1':
    'Historical score ingestion, attributed per team.',
  'lib/tournament/rosterCompliance.ts#1':
    'Identity map — handleFor resolves a display handle for rows enumerated from the Roster table; it never gates compliance.',
  'lib/tournament/topPerformers.ts#1':
    'Identity map — a two-key index resolving a roster to its manager label; it never gates or ranks.',
  'lib/trending-players/trendCardEnrichment.ts#1':
    'Enriches trend cards by team id; an archived team still owned a trending player historically.',
  'lib/values/leagueDefenderBoard.ts#1':
    'Identity map teamByPlatformUser resolving a roster owner to a display name.',
  'lib/waiver-wire/process-engine.ts#1':
    'Identity map — rankByPlatformUserId is read as .get(claimant) ?? 999 to break ties BETWEEN CLAIMANTS. An archived seat adds an unreachable entry, shifts no live rank, and awards nothing; filtering would drop the rank of a seat archived between a claim and its processing.',
  'lib/zombie/ai/ZombieAIContext.ts#1':
    'Same: eliminated seats are the format.',
  'lib/zombie/rosterTeamMap.ts#1':
    'Roster→team identity map; archived teams must still resolve.',
}


/**
 * Call sites the CORRECTED scanner revealed and that have NOT been individually classified yet.
 *
 * ⚠ THIS IS DEBT, NOT A VERDICT. `ENUMERATION_EXCEPTIONS` above means "read, and correct to
 * retain archived teams". This means "the scanner can now see it, and nobody has read it". The
 * two are deliberately separate lists so a backlog can never be mistaken for a review.
 */
const PENDING_CLASSIFICATION: Record<string, string> = {}

/** The backlog may shrink. It may not grow — a new unfiltered enumeration must be dealt with. */
const PENDING_BUDGET = 0

/**
 * Every `.ts`/`.tsx` under a root, excluding tests and build output.
 *
 * Kept separate from the scanner so the scanner can be handed SYNTHETIC sources by its own
 * positive control. A control that re-implements the scan instead of running it proves nothing
 * about the scan — which is exactly the bug this file shipped for two commits.
 */
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

/**
 * Memoised: walking `lib/` + `app/` and reading every file takes ~35s on this box, and more than
 * one test needs it. Two walks put the suite over vitest's 30s per-test timeout.
 */
let SOURCE_CACHE: Source[] | null = null

function collectSources(): Source[] {
  if (SOURCE_CACHE) return SOURCE_CACHE
  SOURCE_CACHE = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))].map((abs) => ({
    rel: relative(ROOT, abs).split(sep).join('/'),
    src: readFileSync(abs, 'utf8'),
  }))
  return SOURCE_CACHE
}

/**
 * Comments replaced by spaces, newlines kept, so every offset and line number is unchanged.
 *
 * 🛑 A COMMENT MUST NEVER EXEMPT A CALL. The previous marker test was `src.includes(...)` over
 * the raw file, so writing "we deliberately do NOT use ACTIVE_TEAM_WHERE here" in prose marked
 * the file protected. It also worked in reverse: an absence assertion elsewhere in this suite
 * went red because a comment NAMED the constant. Both directions are the same defect — text is
 * not code.
 *
 * String and template bodies are skipped too, so a URL's `//` cannot start a comment and a
 * `/*` inside a string cannot swallow real code.
 */
function blankComments(src: string): string {
  const out = src.split('')
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') {
        out[i] = ' '
        i++
      }
    } else if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < n) {
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
      }
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i++
        i++
      }
      i++
    } else {
      i++
    }
  }
  return out.join('')
}

/**
 * 🛑 MATCH THE CALL ACROSS A LINE BREAK. A PER-LINE REGEX IS BLIND TO A WRAPPED CALL, AND THAT
 * BLINDNESS HID 55 OF 175 CALL SITES — INCLUDING ONE THIS BRANCH CREATED.
 *
 * Prettier wraps `prisma.leagueTeam.count({ ... })` onto two lines as soon as the line gets long:
 *
 *     prisma.leagueTeam
 *       .count({ where: { leagueId } })
 *
 * Adding `ACTIVE_TEAM_WHERE` to `lib/chimmy/tools/leagueByName.ts` pushed that exact call over
 * the width limit, so the fix took its own call site out of the guard's sight.
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

/** Just the `where: { ... }` object of a call, brace-balanced. */
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
 * which ROWS come back; a `select: { id: true }` or an `orderBy` naming an id says nothing.
 *
 * ⚠ AND A KEY IS ONLY NARROWING WHEN IT TESTS A VALUE. `claimedByUserId: userId` selects one
 * seat; `claimedByUserId: { not: null }` selects MANY and is a league-wide enumeration wearing
 * a key's clothes. Treating the two alike hid `app/api/leagues/join/route.ts`'s claimed-seat
 * count — the denominator of the "N of M teams claimed" bar — from the guard entirely. The
 * `[^{]` lookahead is what separates them, and `platformUserId` already had it.
 *
 * 🛑 AND `[^{]` ALONE IS NOT ENOUGH — IT WAS WRITTEN THAT WAY FIRST AND STILL DID NOT FIRE.
 * `\s*` backtracks to zero width, so `[^{]` happily matches the SPACE before the brace and the
 * key reads as narrowing again. The class has to exclude whitespace too: `[^{\s]`. Measured —
 * with `[^{]` the claimed-seat count stayed invisible; with `[^{\s]` it is reported.
 */
const NARROWING_KEY = /externalId:|\bid:\s|claimedByUserId:\s*[^{\s]|platformUserId:\s*[^{\s]/

/**
 * What a `where` clause says about archived teams — which is NOT the same question as whether it
 * mentions them.
 *
 * 🛑 A BARE `isOrphan` MENTION USED TO GRANT PROTECTION, AND THAT IS BACKWARDS FOR HALF OF THEM.
 * The old test was `/ACTIVE_TEAM_WHERE|ORPHAN_TEAM_WHERE|isOrphan\s*:/`. So `isOrphan: true` —
 * a query that returns ONLY archived teams — counted as "this call is protected from archived
 * teams". So did `ORPHAN_TEAM_WHERE`, whose entire purpose is to select them. A wrong-polarity
 * predicate silenced the guard exactly as effectively as a correct one.
 *
 * Four answers, and only ONE of them is protection:
 *
 *   active         `ACTIVE_TEAM_WHERE`, `NOT: { isOrphan: true }`, `isOrphan: false`
 *   archived-only  `ORPHAN_TEAM_WHERE`, `isOrphan: true`   → a deliberate archived read; REPORT it
 *                                                              so it is classified with a reason
 *   unknown        mentions the field in a shape not listed → REPORT it; review decides
 *   none           does not mention it at all              → the ordinary enumeration path
 *
 * ⚠ AND A SURROUNDING `OR:` DEFEATS ANY OF THEM. `where: { OR: [{ isOrphan: false }, { … }] }`
 * matches rows through the other branch, so the predicate constrains nothing. Rather than try to
 * reason about which branch dominates, an `OR` anywhere in the clause downgrades the verdict to
 * `unknown` — an unrecognised shape requires review, which is the safe direction.
 */
type OrphanPolarity = 'active' | 'archived-only' | 'unknown' | 'none'

function orphanPolarity(whereClause: string): OrphanPolarity {
  const w = whereClause
  const namesActiveHelper = /ACTIVE_TEAM_WHERE/.test(w)
  const namesOrphanHelper = /ORPHAN_TEAM_WHERE/.test(w)
  const namesField = /isOrphan/.test(w)
  if (!namesActiveHelper && !namesOrphanHelper && !namesField) return 'none'

  /* A disjunction can satisfy the query without the predicate ever applying. */
  if (/\bOR\s*:/.test(w)) return 'unknown'

  /* Checked before the active helper: a clause naming both is not a clean active filter. */
  if (namesOrphanHelper) return namesActiveHelper ? 'unknown' : 'archived-only'
  if (namesActiveHelper) return 'active'

  /*
   * ⚠ CONSUME THE NEGATED FORM BEFORE LOOKING FOR A BARE ONE. `NOT: { isOrphan: true }` — which
   * IS the active filter, and is literally what `ACTIVE_TEAM_WHERE` expands to — contains the
   * substring `isOrphan: true`. Testing both patterns against the raw clause classified the
   * canonical active predicate as "both polarities present", i.e. unknown. Caught by the control
   * for that exact shape, which is why the control is written against the real scanner.
   */
  const negatedConsumed = w.replace(/NOT\s*:\s*\{\s*isOrphan\s*:\s*true\s*\}/g, ' <negated> ')
  const active = negatedConsumed.includes('<negated>') || /isOrphan\s*:\s*false\b/.test(negatedConsumed)
  const archived = /isOrphan\s*:\s*true\b/.test(negatedConsumed)
  if (active && archived) return 'unknown'
  if (active) return 'active'
  if (archived) return 'archived-only'
  /* e.g. `isOrphan: someVariable` — the value is not readable here. */
  return 'unknown'
}

const CONSUMER_FILTER = ['selectActiveTeams', 'isActiveTeam']

/** Sentinel binding: the call is wrapped directly in a filter, so there is no name to trace. */
const INLINE_PROTECTED = '<inline>'

/**
 * The name(s) this call's result is bound to, or [] when it cannot be determined.
 *
 * 🛑 UNDETERMINED MEANS UNPROTECTED, NEVER PROTECTED. A binding we cannot read is a consumer we
 * cannot check, so the call is reported and a human looks at it. The opposite default is how a
 * scanner goes quiet.
 *
 * Two shapes cover almost everything here:
 *   const teams = await prisma.leagueTeam.findMany(...)
 *   const [teams, facts] = await Promise.all([ prisma.leagueTeam.findMany(...), ... ])
 *
 * The second matters — `BroadcastModeEngine` and `dynasty-projections` both use it, and a naive
 * "nearest const" would bind them to the wrong name.
 */
function bindingsFor(src: string, callStart: number): string[] {
  /*
   * 🛑 NO FIXED LOOKBACK WINDOW. A 1200-character window was tried and it under-detected
   * immediately: `BroadcastModeEngine` carries an 1800-character comment between its
   * `Promise.all([` and the call, so the window started INSIDE the comment, the destructure was
   * out of range, and a correctly consumer-filtered call was reported as unguarded. This file
   * has now been bitten by a fixed window three times — an 8-line one, a 40-line one, and this.
   * The whole prefix is cheap; use it, and let the structural checks below do the narrowing.
   */
  const before = src.slice(0, callStart)

  /* Promise.all([...]) — bind by POSITION among the array's top-level elements. */
  const allAt = before.lastIndexOf('Promise.all([')
  if (allAt !== -1) {
    const destructure = before
      .slice(0, allAt)
      .match(/const\s*\[([^\]]*)\]\s*=\s*await\s*$/)
    if (destructure) {
      const names = destructure[1]!.split(',').map((s) => s.trim()).filter(Boolean)
      /* Which element are we in? Count top-level commas between the `[` and the call. */
      const between = before.slice(allAt + 'Promise.all(['.length)
      let depth = 0
      let index = 0
      let escaped = false
      for (const ch of between) {
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') {
          depth--
          /* Depth below zero means that array closed before us — a DIFFERENT Promise.all. */
          if (depth < 0) {
            escaped = true
            break
          }
        } else if (ch === ',' && depth === 0) index++
      }
      if (!escaped) {
        const name = names[index]
        return name ? [name.replace(/[:.].*$/, '').trim()] : []
      }
    }
  }

  /*
   * const teams = await prisma.leagueTeam.findMany(...)
   *
   * ⚠ THE MATCH STARTS AT `leagueTeam`, NOT AT `prisma`. So the receiver chain (`prisma.`, `tx.`,
   * `this.db.`) still sits between the `=` and the anchor, and a regex ending at `await\s*$`
   * matches nothing. That bug reported SIX correctly-filtered readers as unguarded — including
   * three this batch had just fixed — which is a false POSITIVE, but the same carelessness in
   * the other direction is a false negative.
   */
  /**
   * `prisma.`, `tx.`, `this.db.`, `(prisma as any).` — the receiver chain before `leagueTeam`.
   *
   * ⚠ A SEGMENT CAN BE PARENTHESISED. `app/api/rankings/route.ts` writes
   * `selectActiveTeams(await (prisma as any).leagueTeam.findMany(...))`, and an identifier-only
   * chain does not match `(prisma as any)` — so a correctly filtered read was reported.
   */
  const SEG = String.raw`(?:\([^()]*\)|[A-Za-z_$][\w$]*)`
  const RECEIVER = String.raw`${SEG}(?:\s*\.\s*${SEG})*\s*\.\s*`

  const direct = before.match(
    new RegExp(
      String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:${RECEIVER})?$`,
    ),
  )
  if (direct) return [direct[1]!]

  /* return selectActiveTeams(await prisma.leagueTeam.findMany(...)) — protection is inline. */
  if (new RegExp(String.raw`selectActiveTeams\s*\(\s*(?:await\s+)?(?:${RECEIVER})?$`).test(before)) {
    return [INLINE_PROTECTED]
  }

  return []
}

/**
 * Is THIS call protected? Per call and per consumer — never per file.
 *
 * 🛑 THE OLD TEST WAS `FILTERED_MARKERS.some((k) => src.includes(k))` OVER THE WHOLE FILE, so a
 * single protected query anywhere exempted every other enumeration in the same file, an
 * unrelated consumer's `selectActiveTeams(other)` exempted this one, and a comment naming the
 * constant exempted all of them. Three ways to be silently wrong, in one line.
 */
function isProtected(src: string, callStart: number, call: string): boolean {
  /*
   * Query-level, and ONLY when the predicate actually selects ACTIVE teams. `archived-only` and
   * `unknown` fall through to be reported, so a deliberate archived read is classified with a
   * reason rather than silently exempted by the mere presence of the field.
   */
  if (orphanPolarity(extractWhereClause(call)) === 'active') return true

  /* Consumer-level: THIS call's binding is what gets filtered. */
  const names = bindingsFor(src, callStart)
  if (names.includes(INLINE_PROTECTED)) return true
  return names.some((name) =>
    CONSUMER_FILTER.some((fn) =>
      new RegExp(`${fn}\\s*\\(\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,)]`).test(src),
    ),
  )
}

/**
 * A stable identity for a call site: the file plus its ordinal among that file's LeagueTeam
 * enumerations. Line numbers move with every edit above them; the ordinal does not, so a
 * pending entry keeps pointing at the same call while the file is worked on.
 */
function siteId(rel: string, ordinal: number): string {
  return `${rel}#${ordinal}`
}

function scanSources(
  sources: Source[],
  options?: { ignoreRegistry?: boolean },
): Array<{ id: string; file: string; line: number }> {
  const hits: Array<{ id: string; file: string; line: number }> = []
  for (const { rel, src: raw } of sources) {
    if (!raw.includes('leagueTeam')) continue
    const src = blankComments(raw)
    ENUMERATION_CALL.lastIndex = 0
    let m: RegExpExecArray | null
    let ordinal = 0
    while ((m = ENUMERATION_CALL.exec(src)) !== null) {
      const call = callText(src, m.index)
      /* Only a league-wide read; a narrowing key means it is a lookup, not an enumeration. */
      if (!/where:\s*\{[^}]*leagueId/.test(call)) continue
      ordinal++
      if (NARROWING_KEY.test(extractWhereClause(call))) continue
      if (isProtected(src, m.index, call)) continue
      const id = siteId(rel, ordinal)
      if (!options?.ignoreRegistry && (ENUMERATION_EXCEPTIONS[id] || PENDING_CLASSIFICATION[id])) {
        continue
      }
      hits.push({ id, file: rel, line: src.slice(0, m.index).split('\n').length })
    }
  }
  return hits
}

function findUnguardedEnumerations(): Array<{ id: string; file: string; line: number }> {
  return scanSources(collectSources())
}

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
        .map((h) => `  ${h.id}   (line ${h.line})`)
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

  /*
   * 🛑 PROTECTION IS PER CALL, AND THIS IS THE CASE THAT PROVES IT.
   *
   * The old test was `FILTERED_MARKERS.some((k) => src.includes(k))` over the WHOLE FILE, so one
   * protected query anywhere exempted every other enumeration beside it. `app/api/leagues/join`
   * is that shape in production: line 302 filters, line 395 did not, and the guard saw a clean
   * file. Eight files in the current tree hold more than one reported call.
   */
  it('one protected and one unprotected enumeration in the SAME file: only the second is reported', () => {
    const mixed: Source = {
      rel: '__control__/mixed.ts',
      src: [
        'const guarded = await prisma.leagueTeam.count({',
        '  where: { ...ACTIVE_TEAM_WHERE, leagueId },',
        '})',
        '',
        'const leaky = await prisma.leagueTeam.count({ where: { leagueId } })',
        '',
      ].join('\n'),
    }
    const hits = scanSources([mixed])
    expect(hits.map((h) => h.id)).toEqual(['__control__/mixed.ts#2'])
    expect(hits[0]!.line).toBe(5)
  })

  it('a filter named only in a COMMENT does not exempt the call', () => {
    const commented: Source = {
      rel: '__control__/commented.ts',
      src: [
        /*
         * The comment names the exact call the checker looks for — `selectActiveTeams(teams)`
         * — so without comment-blanking this file reads as protected and the leak below is
         * invisible. Explaining why you are NOT filtering must not count as filtering.
         */
        '/* Do NOT write selectActiveTeams(teams) here: the maps below need archived rows. */',
        'const teams = await prisma.leagueTeam.findMany({ where: { leagueId } })',
        '',
      ].join('\n'),
    }
    expect(scanSources([commented]).map((h) => h.id)).toEqual(['__control__/commented.ts#1'])
  })

  it('an UNRELATED consumer being filtered does not exempt the call', () => {
    const unrelated: Source = {
      rel: '__control__/unrelated.ts',
      src: [
        'const other = await prisma.roster.findMany({ where: { leagueId } })',
        'const safeOther = selectActiveTeams(other)',
        'const teams = await prisma.leagueTeam.findMany({ where: { leagueId } })',
        '',
      ].join('\n'),
    }
    expect(scanSources([unrelated]).map((h) => h.id)).toEqual(['__control__/unrelated.ts#1'])
  })

  it('the call whose OWN binding is filtered is the one exempted', () => {
    const both: Source = {
      rel: '__control__/both.ts',
      src: [
        'const a = await prisma.leagueTeam.findMany({ where: { leagueId } })',
        'const b = await prisma.leagueTeam.findMany({ where: { leagueId } })',
        'const activeA = selectActiveTeams(a)',
        '',
      ].join('\n'),
    }
    /* `a` is consumed by the filter, `b` is not — and only `b` is reported. */
    expect(scanSources([both]).map((h) => h.id)).toEqual(['__control__/both.ts#2'])
  })

  /*
   * 🛑 PREDICATE POLARITY. A `where` that MENTIONS `isOrphan` is not thereby a `where` that
   * EXCLUDES archived teams. These run through the production scanner, so the classifier cannot
   * drift from what the guard actually does.
   */
  const POLARITY_CASES: Array<{ label: string; where: string; reported: boolean }> = [
    { label: 'ACTIVE_TEAM_WHERE spread', where: '{ ...ACTIVE_TEAM_WHERE, leagueId }', reported: false },
    { label: 'NOT isOrphan true', where: '{ leagueId, NOT: { isOrphan: true } }', reported: false },
    { label: 'isOrphan false', where: '{ leagueId, isOrphan: false }', reported: false },

    /* Wrong polarity — these SELECT archived teams. They must be reported and classified. */
    { label: 'isOrphan true (archived-only)', where: '{ leagueId, isOrphan: true }', reported: true },
    { label: 'ORPHAN_TEAM_WHERE (archived-only)', where: '{ ...ORPHAN_TEAM_WHERE, leagueId }', reported: true },

    /* Weakened or overridden by surrounding query logic. */
    {
      label: 'OR branch bypasses the predicate',
      where: '{ leagueId, OR: [{ isOrphan: false }, { claimedByUserId: { not: null } }] }',
      reported: true,
    },
    {
      label: 'both polarities in one clause',
      where: '{ leagueId, isOrphan: false, NOT: { isOrphan: true }, ...ORPHAN_TEAM_WHERE }',
      reported: true,
    },

    /* Unrecognised shape — the value is not readable here, so review decides. */
    { label: 'isOrphan bound to a variable', where: '{ leagueId, isOrphan: wantArchived }', reported: true },
  ]

  it.each(POLARITY_CASES)('polarity: $label', ({ where, reported }) => {
    const fixture: Source = {
      rel: '__control__/polarity.ts',
      src: `const t = await prisma.leagueTeam.findMany({ where: ${where} })\n`,
    }
    const hits = scanSources([fixture]).map((h) => h.id)
    expect(hits).toEqual(reported ? ['__control__/polarity.ts#1'] : [])
  })

  it('a bare isOrphan mention alone never grants protection', () => {
    /*
     * The single assertion that would have caught the old rule. Under
     * `/ACTIVE_TEAM_WHERE|ORPHAN_TEAM_WHERE|isOrphan\s*:/` every one of these was silently
     * exempt; only the first is a filter for ACTIVE teams.
     */
    const grantsProtection = (where: string) =>
      scanSources([
        {
          rel: '__control__/bare.ts',
          src: `const t = await prisma.leagueTeam.findMany({ where: ${where} })\n`,
        },
      ]).length === 0

    expect(grantsProtection('{ leagueId, isOrphan: false }')).toBe(true)
    expect(grantsProtection('{ leagueId, isOrphan: true }')).toBe(false)
    expect(grantsProtection('{ ...ORPHAN_TEAM_WHERE, leagueId }')).toBe(false)
    expect(grantsProtection('{ leagueId, isOrphan: maybe }')).toBe(false)
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

  /*
   * 🛑 A DEAD EXEMPTION IS A SILENT WIDENING. Once a call is fixed or deleted, its entry stops
   * describing anything — but it keeps matching, so if that id is ever reused by a NEW call the
   * guard waves it straight through on a reason written about different code. This caught the
   * `dynasty-projections` entry the moment A.2 filtered it.
   */
  it('every registered exception still corresponds to a real unprotected call', () => {
    const live = new Set(scanSources(collectSources(), { ignoreRegistry: true }).map((h) => h.id))
    const dead = Object.keys(ENUMERATION_EXCEPTIONS).filter((id) => !live.has(id))
    expect(
      dead,
      `These exceptions no longer match an unprotected call — the code was fixed or moved. ` +
        `Delete them:\n${dead.map((d) => `  ${d}`).join('\n')}`,
    ).toEqual([])
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
