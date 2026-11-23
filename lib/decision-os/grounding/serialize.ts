import { isCanonicalLeagueRules, renderLeagueRules } from './leagueRulesText'
import { isImportAssertions, renderImportAssertions } from './importAssertionsText'
import { isMatchupSlice, isRosterSlice, isStandingsSlice, renderMatchupSlice, renderRosterSlice, renderStandingsSlice } from './contextSliceText'
import type { DecisionOsGroundingPacket, GroundedSlice } from './packet'

/**
 * Render a {@link DecisionOsGroundingPacket} for a prompt.
 *
 * PURE — no IO, no clock — so what the model is told can be asserted in a test rather than
 * inspected in a log.
 *
 * ── 🛑 THE GAPS ARE THE POINT, NOT AN APPENDIX ──────────────────────────────────────────────
 * The existing `chimmyGroundingPacket` header already states the rule this serializer has to
 * serve: "Only answer using facts in this packet. If the packet does not contain the fact, say
 * what data is missing and suggest where the user can check."
 *
 * A serializer that renders only what is PRESENT satisfies the first half and silently drops the
 * second. The model then has no way to distinguish "we have no projections" from "you did not ask
 * about projections", and the honest refusal D8 requires becomes impossible to phrase. So gaps are
 * rendered explicitly, with their remedies, and they come FIRST when the answer is blocked.
 *
 * ⚠ AND STALENESS IS RENDERED AS AN INSTRUCTION, NOT A FOOTNOTE. The route already does this for
 * its own freshness warning — "Always include this warning when answering" — because a caveat the
 * model may drop is a caveat that will be dropped.
 */

function ageLine(asOf: string | null, now: number): string | null {
  if (!asOf) return null
  const ms = now - Date.parse(asOf)
  if (!Number.isFinite(ms) || ms < 0) return null
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} old`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} old`
  return `${Math.round(hours / 24)} days old`
}

/**
 * How many items of a collection reach the prompt.
 *
 * 🛑 BOUNDED, AND THE BOUND IS NOT TIMIDITY. `marketAdapter` takes up to 2,000 rows and the
 * `rankings` provider carries difficulty for ~400 leagues (measured, `packet.ts`). Rendering a
 * collection raw would blow the context window and recreate the latency problem in tokens — the
 * packet would go from saying nothing to saying far too much, which is not an improvement.
 *
 * ⚠ AND THE HIDDEN COUNT IS ALWAYS STATED. A truncated list that does not say it is truncated
 * reads as the complete set, which is the same class of lie this file exists to prevent.
 */
const MAX_ITEMS = 8

/** The roster's league-scored projections list the whole roster: a 25-man roster cut to eight reads as complete. */
const ROSTER_PROJECTIONS_SLICE = "Your roster this week (this league's scoring)"
const MAX_ITEMS_BY_SLICE: Readonly<Record<string, number>> = { [ROSTER_PROJECTIONS_SLICE]: 30 }

/** My Team's best lineup — the lineup tool's own text, whole: a lineup cut short reads as complete. */
const MY_TEAM_LINEUP_SLICE = 'Best lineup (My Team)'

/** The trades waiting on the asker, each graded — the trade tool's own text, whole: an inbox cut short reads as complete. */
const PENDING_TRADES_SLICE = 'Trades waiting on you (graded)'

/** The draft and Draft OS's pick for the asker — the draft board tool's own text, whole. */
const DRAFT_BOARD_SLICE = 'The draft (board and your pick)'

/** Every leaguemate's record, facts only — the manager-record tool's own text, whole: a cut list reads as everyone. */
const MANAGER_RECORDS_SLICE = 'Leaguemates’ records (facts only)'

/** NBA/MLB/NHL: the asker's roster on the league's value board — whole, for the same reason. */
const ROSTER_BOARD_VALUES_SLICE = 'Your roster values (this league\'s board)'

/** Trim a prose slice so one long saved analysis cannot crowd out every other fact. */
const MAX_PROSE = 1200

/*
 * ⚠ LEAGUE INTELLIGENCE GETS MORE, BECAUSE IT IS THE ONLY SLICE THAT NAMES THE LEAGUE'S TEAMS. The
 * standings slice is not itemised ("rows: 20 items"), so this prose is the one place the model can
 * learn which team is in which division/tribe. A 22-team league's groups plus the format summary
 * run past 1200, and the cut falls from the END: the tail of a tribe list, then the "these are the
 * ONLY league truths" instruction. A truncated member list reads as complete. The slice builder
 * orders its lines most-important first, so the cap still falls on the least important.
 */
// Measured 2026-09-28: a 22-team survivor league with long team names is ~1,960 characters before
// the values, trade-ledger and history lines (~500-600 more). 3200 leaves room; 2600 did not.
const MAX_PROSE_BY_SLICE: Readonly<Record<string, number>> = { 'League intelligence': 3200, [MY_TEAM_LINEUP_SLICE]: 3200, [PENDING_TRADES_SLICE]: 4000, [DRAFT_BOARD_SLICE]: 4000, [MANAGER_RECORDS_SLICE]: 3600, [ROSTER_BOARD_VALUES_SLICE]: 3600 }

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

/**
 * Render the CONTENT of a slice.
 *
 * ── 🛑 THIS IS G11. `sliceLine` NEVER READ `slice.value` — ZERO OCCURRENCES IN THIS FILE ─────
 * The packet spent ~1.7s assembling `ValueLookup[]`, `ProjectionFact[]` and three-brain's saved
 * conclusion, and the serializer emitted the word "available". Every test in the suite passed,
 * because every one of them asserted on the gaps half.
 *
 * ⚠ TYPED SLICES ONLY, DELIBERATELY. `leagueRules` and the eight `contextFacts` are typed
 * `unknown` — they are `ChimmyContextEngine` payloads whose shapes this module does not own.
 * Dumping an unknown object would be how ~400 leagues of ranking data reaches a prompt. They keep
 * their manifest line until each has a shape worth rendering; that is R1.1b, not an oversight.
 */
function renderValue(name: string, value: unknown, onRoster?: ReadonlySet<string>): string[] {
  // The four `GroundedSlice<string>` slices are already prompt-ready prose. Reducing them to
  // "available" is what silenced three-brain's saved conclusion — the substance of plan item 6.2.
  if (typeof value === 'string') {
    const cap = MAX_PROSE_BY_SLICE[name] ?? MAX_PROSE
    const trimmed = value.length > cap ? `${value.slice(0, cap)}…` : value
    return trimmed.split('\n').map((l) => `    ${l}`)
  }

  /*
   * DecisionFact (R2.1) — a bridged decision from one of the live engines.
   *
   * 🛑 THIS BRANCH MUST PRECEDE THE ARRAY CHECK BELOW, AND ITS ABSENCE WAS G11 IN MINIATURE. A
   * DecisionFact is a plain object, so without it `!Array.isArray(value)` returns [] and a decision
   * slice serialises to its header line and nothing else — "waiverDecision: available", which is
   * precisely the failure this file was rewritten to fix for values.
   */
  if (isDecisionFact(value)) return renderDecision(value)

  /*
   * The league ruleset (`CanonicalLeagueRules`), field by field. 🛑 THIS BRANCH MUST PRECEDE `renderObject`, which
   * prints every nested object as "present" — so the whole slice read `scoring: present`, `trades: present`, and
   * Chimmy guessed PPR, the trade deadline and the FAAB budget (2026-11-16 re-score item 5).
   */
  if (isCanonicalLeagueRules(value)) return renderLeagueRules(value)

  /*
   * The import assertions, field by field. Same reason as the rules above: through `renderObject` the 8-row cap
   * kept the two timestamps and cut parity, coverage and the incomplete scopes (2026-11-20 re-score push).
   */
  if (isImportAssertions(value)) return renderImportAssertions(value)

  /*
   * The three most-asked context slices, field by field (hub serialization, 2026-11-20). Through `renderObject` the
   * roster printed "starters: 10 items (not itemised here)", the standings "rows: 12 items", and the matchup was cut
   * after 8 fields. Keyed on the slice name AND the shape, so an unexpected payload still falls through.
   */
  if (name === 'Matchup' && isMatchupSlice(value)) return renderMatchupSlice(value)
  if (name === 'Roster' && isRosterSlice(value)) return renderRosterSlice(value)
  if (name === 'Standings' && isStandingsSlice(value)) return renderStandingsSlice(value)

  /*
   * 🛑 PLAIN OBJECTS RENDERED AS THE WORD "available" AND NOTHING ELSE — G11, STILL LIVE.
   *
   * `renderValue` handled strings and arrays. All EIGHT `contextFacts` slices are plain objects,
   * so every one printed its header and no substance: matchup, roster, standings, rankings,
   * leagueDifficulty, importedHistory, replayInsights, devy. Measured by feeding a real roster
   * carrying `weaknessSignals: ['shallow_depth:RB']` through this function — the output was
   * exactly `- Roster: available (served from live)`.
   *
   * That is the bug this file was rewritten to fix for values, and it had been true the whole time
   * for the eight slices that predate the rewrite. `computeRosterIntel` has been producing "where
   * am I weak" signals that reached the packet and stopped here.
   */
  /*
   * ⚠ `!Array.isArray` IS LOAD-BEARING, NOT DEFENSIVE. `typeof [] === 'object'`, so without it this
   * branch swallows every ARRAY slice — market values, projections, psychology — and renders their
   * indices as field names. Five existing serializer tests caught exactly that, which is what a
   * regression suite is for.
   */
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return renderObject(value as Record<string, unknown>)
  }

  if (!Array.isArray(value) || value.length === 0) return []

  const { ordered, promoted } = orderByRosterRelevance(value, onRoster)

  const cap = MAX_ITEMS_BY_SLICE[name] ?? MAX_ITEMS
  const rows: string[] = []
  if (name === ROSTER_PROJECTIONS_SLICE) {
    const first = value[0] as { week?: unknown; season?: unknown; basis?: unknown } | null
    const when = typeof first?.week === 'number' ? `Week ${first.week}${first.season ? ` ${String(first.season)}` : ''}` : 'This week'
    rows.push(
      first?.basis === 'season_rate'
        ? // NBA / NHL / MLB / NCAAB / soccer (2026-11-20): the league value board's per-game rate, the numbers My Team and the Trade Center use.
          `    ${when}, priced on this league's own value board: each player's per-game rate under this league's points, times his games this week where the schedule is known — the same per-game numbers My Team, the Trade Center and the value answer use. A season rate, NOT a game-by-game forecast: rest days and changed roles are not in it, and a daily league's My Team prices one day. For anyone on this list, quote THIS number, not the canonical Projections row. Injuries are not applied here.`
        : `    ${when}, scored under this league's own rules — the same numbers My Team shows. For anyone on this list, quote THIS number, not the canonical Projections row. Byes and injuries are not applied here (My Team counts a bye or ruled-out player as 0).`,
    )
  }
  for (const item of ordered.slice(0, cap)) {
    const line = renderItem(item)
    if (line) rows.push(`    · ${line}`)
  }
  const hidden = ordered.length - cap
  if (hidden > 0) {
    /*
     * ⚠ THE MODEL MUST BE TOLD WHICH EIGHT THESE ARE. Showing the asker's own players without
     * saying so invites "the top players are …" — reading a roster-scoped sample as a ranked
     * one. The unordered case keeps its original wording exactly, so nothing changes for a
     * slice with no roster to sort against.
     */
    rows.push(
      promoted > 0
        ? `    · …and ${hidden} more not shown (${name} holds ${ordered.length}; your own players are listed first, NOT the highest-valued)`
        : `    · …and ${hidden} more not shown (${name} holds ${ordered.length})`,
    )
  }
  return rows
}

/**
 * A bridged engine decision. Structural detection, like every other branch here — only a
 * `DecisionFact` carries `decisionType` alongside the four contract answers.
 */
/** Fields never worth a line: ids the model cannot use. */
const SKIP_KEYS = new Set(['leagueId', 'teamId', 'yourTeamId', 'opponentTeamId', 'rosterId', 'userId'])

/**
 * One plain object, bounded and NON-RECURSIVE.
 *
 * 🛑 IT NEVER DESCENDS INTO A NESTED OBJECT, AND THAT IS THE WHOLE SAFETY PROPERTY. `packet.ts`
 * records that the `ranking` provider returns difficulty ratings for ~400 leagues and dominates the
 * payload; a renderer that recursed would put that in every prompt. Refusing to descend makes an
 * unbounded dump IMPOSSIBLE rather than merely unlikely — the same reason `toEvidencePacket`
 * forbids `JSON.stringify` outright.
 *
 * A nested object is reported as PRESENT and not summarised. "We have a ranking snapshot" is true
 * and useful; inventing a summary of a shape this function has never seen is not.
 */
function renderObject(o: Record<string, unknown>): string[] {
  const rows: string[] = []
  /*
   * 🛑 A FIELD PAST THE CAP IS NAMED, NEVER SILENTLY DROPPED (hub serialization, 2026-11-20). The cap stopped the loop
   * and said nothing, which is how the import slice's parity and coverage, and the matchup's playoff fields, went
   * missing without a trace. The model is now told which fields exist but are not shown, so it can call the tool.
   */
  const dropped: string[] = []
  for (const [k, v] of Object.entries(o)) {
    if (SKIP_KEYS.has(k) || v == null) continue
    if (rows.length >= MAX_ITEMS) {
      dropped.push(k)
      continue
    }

    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      rows.push(`    ${k}: ${typeof v === 'number' ? fmt(v) : String(v)}`)
      continue
    }

    if (Array.isArray(v)) {
      if (v.length === 0) continue
      // A string array IS the substance for weaknessSignals/strengthSignals — the answer to
      // "where am I weak" has been sitting in one of these the whole time.
      const strings = v.filter((x): x is string => typeof x === 'string')
      if (strings.length === v.length) {
        const shown = strings.slice(0, MAX_ITEMS)
        const more = strings.length > shown.length ? `, and ${strings.length - shown.length} more` : ''
        rows.push(`    ${k}: ${shown.join(', ')}${more}`)
        continue
      }
      // Objects: only those a known branch can name. The COUNT is always stated, so a collection
      // this function cannot itemise never reads as empty.
      const named = v.slice(0, MAX_ITEMS).map(renderItem).filter((l): l is string => Boolean(l))
      const more = v.length > named.length ? `, and ${v.length - named.length} more` : ''
      rows.push(
        named.length > 0
          ? `    ${k} (${v.length}): ${named.join('; ')}${more}`
          : `    ${k}: ${v.length} item${v.length === 1 ? '' : 's'} (not itemised here)`,
      )
      continue
    }

    // ⚠ PRESENT, NOT SUMMARISED. See the header: descending is what makes a dump possible.
    rows.push(`    ${k}: present`)
  }
  if (dropped.length) {
    rows.push(`    (+${dropped.length} more field${dropped.length === 1 ? '' : 's'} not shown here: ${dropped.slice(0, 8).join(', ')}${dropped.length > 8 ? ', …' : ''} — ask the matching tool for them)`)
  }
  return rows
}

function isDecisionFact(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return typeof o.decisionType === 'string' && typeof o.whatHappened === 'string' && Array.isArray(o.verdicts)
}

/**
 * Render one decision as the four answers the Decision Contract guarantees.
 *
 * ⚠ THE FOUR ANSWERS ARE THE SUBSTANCE, not decoration around a score. `what_to_do` is the
 * recommendation itself, and dropping it to save tokens would leave the model to re-derive a
 * conclusion the deterministic engine already reached — which is the fabrication risk the whole
 * grounding design exists to remove.
 */
function renderDecision(o: Record<string, unknown>): string[] {
  const rows: string[] = []
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')

  rows.push(`    what happened: ${s('whatHappened')}`)
  rows.push(`    why it matters: ${s('whyItMatters')}`)
  rows.push(`    what to do: ${s('whatToDo')}`)
  rows.push(`    confidence: ${s('howConfident')}`)

  /*
   * 🛑 ILLEGAL VERDICTS ARE RENDERED FIRST AMONG THE VERDICTS AND ARE NEVER TRUNCATED AWAY. This
   * is the half of a decision that is not advice — it is what the league's rules permit — and a
   * model that does not see it can cheerfully recommend a move the rules forbid.
   */
  const verdicts = (o.verdicts as unknown[]).filter(
    (x): x is Record<string, unknown> => x != null && typeof x === 'object',
  )
  const illegal = verdicts.filter((v) => v.verdict === 'illegal')
  for (const v of illegal) rows.push(`    NOT ALLOWED — ${String(v.rule)}: ${String(v.message)}`)
  const others = verdicts.filter((v) => v.verdict !== 'illegal').slice(0, 3)
  for (const v of others) rows.push(`    rule ${String(v.rule)}: ${String(v.verdict)} — ${String(v.message)}`)

  const count = typeof o.actionCount === 'number' ? o.actionCount : 0
  const summary = Array.isArray(o.actionSummary) ? (o.actionSummary as unknown[]).filter((x) => typeof x === 'string') : []
  if (count > 0) {
    // ⚠ The COUNT is always stated even when nothing is described, so "3 recommended actions" is
    // never silently rendered as though there were none.
    rows.push(
      summary.length > 0
        ? `    ${count} recommended action${count === 1 ? '' : 's'}: ${summary.join('; ')}${count > summary.length ? `, and ${count - summary.length} more` : ''}`
        : `    ${count} recommended action${count === 1 ? '' : 's'} (not itemised here)`,
    )
  }

  // ⚠ The honesty fields go LAST but are never omitted: a decision resting on a weak input reads
  // identically to a strong one without them.
  const dc = typeof o.dataCompleteness === 'number' ? o.dataCompleteness : null
  if (dc != null && dc < 100) {
    rows.push(`    based on ${dc}% of the inputs it wants; weakest input "${String(o.weakestSource)}" (${String(o.weakestTrust)})`)
  }
  return rows
}

/**
 * One item of a collection.
 *
 * ⚠ STRUCTURAL DETECTION, NOT A TYPE TAG. `ValueLookup` and `ProjectionFact` have no discriminator
 * in common, and importing a runtime guard from either would give this pure module a dependency it
 * does not need. Each branch checks for a field only that shape has.
 */
function renderItem(item: unknown): string | null {
  if (item == null || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  if (typeof o.metricUnit === 'string' && typeof o.perGame === 'number') {
    return [
      `${String(o.playerName)} (#${String(o.rank)} overall, #${String(o.positionRank)} ${String(o.position)})`,
      `${o.perGame.toFixed(2)} ${o.metricUnit} per game`,
      typeof o.weekly === 'number' ? `${o.weekly.toFixed(2)} for week ${String(o.metricWeek)}` : null,
      typeof o.fullSeason === 'number' ? `${o.fullSeason.toFixed(2)} full season${o.fullSeasonBasis === 'standard_season' ? ' based on standard season length' : ''}` : null,
      typeof o.restOfSeason === 'number' ? `${o.restOfSeason.toFixed(2)} rest of season` : null,
      typeof o.tradeValue === 'number' ? `AF trade value ${o.tradeValue.toFixed(2)} ${String(o.tradeValueUnit ?? '')}`.trim() : null,
      typeof o.dynastyTradeValue === 'number' ? `AF dynasty trade value ${o.dynastyTradeValue.toFixed(2)}` : null,
    ].filter(Boolean).join(' · ')
  }

  /*
   * RosterLeagueProjection — the asker's roster under THIS league's scoring (`rosterLeagueProjections.ts`).
   * 🛑 MUST BE THE FIRST BRANCH: it also carries `playerName` and `points`, and that branch would label
   * the league's own number "canonical preset, NOT this league". A null is said in words, never printed as 0.
   */
  if (o.leagueScored === true && (o.slot === 'starter' || o.slot === 'bench')) {
    const who = typeof o.playerName === 'string' && o.playerName ? o.playerName : 'unidentified player'
    const pos = o.position ? ` (${String(o.position)})` : ''
    if (o.basis === 'season_rate') {
      // A per-game rate, and this week's total only when the games are known. A null is said in words, never 0.
      const rate = typeof o.perGame === 'number' ? `${fmt(o.perGame)} pts/game` : 'not on this league’s value board (NOT zero)'
      const week =
        typeof o.perGame !== 'number'
          ? ''
          : typeof o.points === 'number' && typeof o.weekGames === 'number'
            ? ` · ${String(o.weekGames)} game${o.weekGames === 1 ? '' : 's'} this week → ${fmt(o.points)} pts`
            : ' · this week’s games not known'
      return `${o.slot === 'starter' ? 'starter' : 'bench'}: ${who}${pos} ${rate}${week}`
    }
    const pts = typeof o.points === 'number' ? `${fmt(o.points)} pts` : 'no projection line this week (NOT zero)'
    return `${o.slot === 'starter' ? 'starter' : 'bench'}: ${who}${pos} ${pts}`
  }

  // ValueLookup — only `status: 'ok'` carries a number. The other three are honest absences and
  // are already reported as gaps; repeating them per-player would drown the real values.
  if (typeof o.status === 'string') {
    if (o.status !== 'ok') return null
    const v = o.value as Record<string, unknown> | undefined
    if (!v) return null
    // ⚠ Falls back to the id rather than dropping the row. A value we cannot name is still a value,
    // and an unnamed row is visible evidence that a producer is not carrying names yet.
    const who = (v.playerName as string) || (v.playerId as string) || 'unknown player'
    const pos = v.position ? ` (${v.position})` : ''
    const rank = v.overallRank != null ? `, rank ${v.overallRank as number}` : ''
    // ⚠ THE UNIT IS NEVER DROPPED. Devy points and market units are different currencies and
    // `sumCanonicalValues` refuses to mix them; a prompt that omits the unit invites the model to
    // do the addition the code refuses to do.
    return `${who}${pos} ${fmt(v.value as number)} ${String(v.unit)}${rank}`
  }

  /*
   * RosterPlayerLite — who is actually on the roster. The most basic fact in the packet, and it has
   * never reached a prompt.
   *
   * ⚠ `playerName` IS NULLABLE ON PURPOSE AND THE NULL MUST SURVIVE. `types.ts` records that this
   * was once a non-null `string`, satisfied with `?? playerId`, and a live dynasty league rendered
   * 27 of 27 players as their own ids — a player literally named "6804". Falling back to the id
   * here would rebuild exactly that. An unnamed player is dropped instead; the count still counts him.
   */
  /*
   * ⚠ `points` EXCLUDED, BECAUSE A ProjectionFact ALSO CARRIES playerName AND A PLAYER ID. Without
   * that clause this branch matches a projection first and renders it as a bare name — silently
   * dropping the points, which are the entire reason a projection is in the packet. An existing
   * test caught it; the branches are ordered least-specific-last for exactly this reason.
   */
  if (typeof o.playerId === 'string' && typeof o.points !== 'number' && ('playerName' in o || 'name' in o || 'position' in o)) {
    // `RosterPlayerLite` carries `name`, not `playerName` (2026-11-20): reading only `playerName` dropped every one.
    const who =
      typeof o.playerName === 'string' && o.playerName ? o.playerName : typeof o.name === 'string' && o.name ? o.name : null
    if (!who) return null
    return o.position ? `${who} (${String(o.position)})` : who
  }

  // Internal profiles cannot be rendered, even if a future caller puts one in a different slice.
  if (typeof o.managerId === 'string' && Array.isArray(o.labels) && o.scores) return null

  // ProjectionFact
  if (typeof o.playerName === 'string' && typeof o.points === 'number') {
    const pos = o.position ? ` (${String(o.position)})` : ''
    // `rescored` is surfaced because "under your league's rules" and "under our default" are
    // different claims, and a reader who cannot tell them apart will assume the first.
    const scored = o.rescored === true ? ' — rescored for this league' : ' — canonical preset, NOT this league'
    /*
     * 🛑 THE WEEK, ON EVERY ROW (Projection OS, 2026-11-16). A row printed "Name 14.2 pts" was read as "this
     * week" whatever it was: the week-less row is a per-game season baseline, and a weekly row is one specific
     * week. Say which, so a season number is never quoted as this week's.
     */
    const when = typeof o.week === 'number' && o.week > 0
      ? `, week ${o.week}${typeof o.season === 'number' ? ` ${o.season}` : ''}`
      : ', season baseline per game (no weekly projection on file — NOT a projection for this week)'
    return `${o.playerName}${pos} ${fmt(o.points)} pts${when}${scored}`
  }

  return null
}

/**
 * Normalise a player key so a roster entry and a value row match on the same string.
 *
 * Ids are compared as-is; names are lowercased and stripped of punctuation, because "T.J.
 * Hockenson" on a roster and "TJ Hockenson" in a value feed are the same person.
 */
function playerKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  return t.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Every player the ASKER rosters, as match keys — ids and normalised names.
 *
 * PURE, and exported for tests. Reads the packet's own `roster` slice; returns an empty set
 * when there is no roster, which makes every caller a no-op rather than a special case.
 */
export function rosterPlayerKeys(roster: GroundedSlice<unknown> | null | undefined): ReadonlySet<string> {
  const keys = new Set<string>()
  if (!roster?.present) return keys
  const v = roster.value as { starters?: unknown; bench?: unknown } | null
  const players = [
    ...(Array.isArray(v?.starters) ? (v as { starters: unknown[] }).starters : []),
    ...(Array.isArray(v?.bench) ? (v as { bench: unknown[] }).bench : []),
  ] as Array<{ playerId?: unknown; name?: unknown }>
  for (const pl of players) {
    const id = playerKey(pl?.playerId)
    if (id) keys.add(id)
    const nm = playerKey(pl?.name)
    if (nm) keys.add(nm)
  }
  return keys
}

/**
 * R1.4 — put the asker's own players first in a bounded list.
 *
 * 🛑 BOUNDING WAS SOLVED; ORDERING WAS NOT. §0.9 measured it on a live packet: the eight
 * rendered rows were `slice(0, 8)` — neither the user's roster nor the top-ranked players, just
 * whichever eight the producer happened to emit first. For "what is my WR worth" the right eight
 * are the asker's, and they were reaching the packet only by luck.
 *
 * ⚠ A STABLE PARTITION, NOT A SORT. Within each group the producer's original order is
 * preserved, so a feed that already emits by descending value keeps that ordering inside the
 * promoted rows — and the same packet always renders the same text, which a comparator on
 * floats would not guarantee.
 *
 * ⚠ IT NEVER DROPS OR DEDUPES. Every element survives; only the order changes. The caller's
 * `hidden` count is therefore still exact.
 *
 * ⚠ AND IT IS A NO-OP WITHOUT A ROSTER. No roster, an empty roster, or a list whose rows carry
 * no recognisable player key all return the input untouched with `promoted: 0` — so a slice this
 * cannot reason about renders exactly as it did before.
 *
 * PURE, and exported for tests.
 */
export function orderByRosterRelevance(
  rows: readonly unknown[],
  onRoster?: ReadonlySet<string>,
): { ordered: readonly unknown[]; promoted: number } {
  if (!onRoster || onRoster.size === 0) return { ordered: rows, promoted: 0 }

  const mine: unknown[] = []
  const rest: unknown[] = []
  for (const r of rows) {
    const o = r as { playerId?: unknown; playerName?: unknown; name?: unknown } | null
    const id = playerKey(o?.playerId)
    const nm = playerKey(o?.playerName) ?? playerKey(o?.name)
    if ((id && onRoster.has(id)) || (nm && onRoster.has(nm))) mine.push(r)
    else rest.push(r)
  }
  // Nothing matched: leave the caller's wording alone rather than claiming a promotion.
  if (mine.length === 0) return { ordered: rows, promoted: 0 }
  return { ordered: [...mine, ...rest], promoted: mine.length }
}

function sliceLine(
  name: string,
  s: GroundedSlice<unknown> | null | undefined,
  now: number,
  onRoster?: ReadonlySet<string>,
): string[] {
  /*
   * ⚠ TOLERATES A MISSING SLICE, and that is not defensive padding. This is the ONE function
   * standing between an assembled packet and the prompt, and it is called on a fixed list of
   * slice names — so the day a slice is added to the list before every producer of a packet
   * carries it, a bare `s.present` throws and the model gets NOTHING rather than the fifteen
   * slices that were fine. An absent slice is an absent slice; it is not an outage.
   *
   * Found exactly that way: adding `managerPsychology` to the list turned eight passing
   * serializer tests into TypeErrors, because their fixture predated the field.
   */
  if (!s || !s.present) return []
  const bits: string[] = []
  const age = ageLine(s.asOf, now)
  if (age) bits.push(age)
  if (s.servedFrom) bits.push(`served from ${s.servedFrom}`)
  if (s.confidence != null) bits.push(`confidence ${s.confidence.toFixed(2)}`)
  const meta = bits.length ? ` (${bits.join(', ')})` : ''
  // ⚠ A present-but-inconclusive slice STILL RENDERS ITS VALUE. Dropping true information to
  // punish a stale import is the failure `packet.ts`'s roster comment warns about; the caveat
  // travels with the number instead of replacing it.
  const blocked = !s.conclusive.ok ? ' — PRESENT BUT NOT SAFE TO ACT ON, see gaps below' : ''
  return [`- ${name}: available${meta}${blocked}`, ...renderValue(name, s.value, onRoster)]
}

/**
 * Collapse gaps that share ONE cause into a single line, naming every fact they block.
 *
 * 🛑 EIGHT IDENTICAL LINES, MEASURED. A live packet carried ten gap lines of which eight read
 * exactly `teams_rosters did not finish syncing` — one per context slice that depends on it.
 * Every line was correct; the repetition is the defect. A prompt that says the same sentence
 * eight times teaches a reader to skim the gap block, which is precisely how the one gap that
 * matters gets missed, and it spends context on redundancy the model cannot use.
 *
 * ⚠ GROUPED ON THE WHOLE CAUSE — reason, detail AND remedy — not on `detail` alone. Two slices
 * blocked for genuinely different reasons can phrase `detail` identically, and merging those
 * would attach one slice's remedy to another slice's problem: a confidently wrong fix, which is
 * worse than a repetitive right one.
 *
 * ⚠ NOTHING IS DROPPED. Every slice name survives into the collapsed line, because the model
 * needs to know WHICH facts it must decline on — that is the whole job of this block. This
 * shortens the prompt without removing anything from it.
 *
 * ⚠ AND IT COLLAPSES ONLY THE RENDERING. `packet.gaps` stays one entry per slice: it is a data
 * structure other consumers read (`groundingToEvidence` builds `missingInformation` from it),
 * and flattening it there would change what those callers see. Presentation is the right layer
 * for a presentation problem.
 *
 * First-occurrence order is preserved so the same packet always renders the same text.
 * PURE, and exported for tests.
 */
export function collapseGapsByCause(
  gaps: ReadonlyArray<{ slice: string; reason: string; detail: string; remedy: string }>,
): Array<{ slices: string[]; reason: string; detail: string; remedy: string }> {
  const byCause = new Map<string, { slices: string[]; reason: string; detail: string; remedy: string }>()
  const order: string[] = []
  for (const g of gaps) {
    /*
     * JSON.stringify rather than a joined string: a separator character can appear inside a
     * detail or remedy and silently merge two different causes into one line.
     */
    const key = JSON.stringify([g.reason, g.detail, g.remedy])
    const existing = byCause.get(key)
    if (existing) {
      // A slice appearing twice under one cause would be a packet bug, but printing it twice
      // would look like this function's bug — so keep the list distinct either way.
      if (!existing.slices.includes(g.slice)) existing.slices.push(g.slice)
      continue
    }
    byCause.set(key, { slices: [g.slice], reason: g.reason, detail: g.detail, remedy: g.remedy })
    order.push(key)
  }
  return order.map((k) => byCause.get(k) as { slices: string[]; reason: string; detail: string; remedy: string })
}

/**
 * THE FACTS THAT ANSWER EACH KIND OF QUESTION, by the slice names above (Decision OS hub, assembly, 2026-11-20).
 *
 * 🛑 THE PACKET WAS ASSEMBLED IN ONE FIXED ORDER WHATEVER WAS ASKED. A trade question's graded offers sat behind import
 * state, the rules, the market table and two projection blocks; a standings question found the table at the very end,
 * after nine other slices. Nothing was dropped — every slice still renders, whole — but the slice the router
 * requested FOR this question was buried in the slices every question gets. These lead now, in this order, under a
 * line naming them; everything else follows in the usual order.
 *
 * ⚠ ONLY SLICES THAT RENDERED ARE NAMED. An absent slice is a gap and stays in the gap block, so the line never claims
 * a fact the packet does not hold.
 */
export const ANSWERING_SLICES_BY_INTENT: Readonly<Record<string, readonly string[]>> = {
  start_sit: [MY_TEAM_LINEUP_SLICE, ROSTER_PROJECTIONS_SLICE, 'Matchup'],
  matchup: ['Matchup', ROSTER_PROJECTIONS_SLICE],
  trade: [PENDING_TRADES_SLICE, ROSTER_BOARD_VALUES_SLICE, 'Market player values'],
  waiver: ['Waiver decision'],
  draft: [DRAFT_BOARD_SLICE],
  player_value: ['Roster value grade', ROSTER_BOARD_VALUES_SLICE, 'Market player values'],
  commissioner: ['Commissioner health decision', 'Commissioner intelligence', 'League rules'],
  manager_psychology: [MANAGER_RECORDS_SLICE],
  league_strength: ['Standings', 'Rankings', 'League difficulty'],
}

export interface SerializeGroundingOptions {
  /** The turn's intent (`classifyChimmyTurn`), so the slices that answer it lead. Omitted = the usual order. */
  intent?: string | null
  /** That intent's label ("Trade analysis"), named on the lead line. */
  intentLabel?: string | null
}

export function serializeDecisionOsGroundingForPrompt(
  packet: DecisionOsGroundingPacket,
  now: number = Date.now(),
  options: SerializeGroundingOptions = {},
): string {
  const lines: string[] = []

  const slices: Array<[string, GroundedSlice<unknown>]> = [
    ['Import state', packet.importAssertions as GroundedSlice<unknown>],
    ['League rules', packet.leagueRules],
    ['Market player values', packet.marketValues as GroundedSlice<unknown>],
    ['Devy/college values', packet.devyValues as GroundedSlice<unknown>],
    ['Projections', packet.projections as GroundedSlice<unknown>],
    ...(packet.leaguePlayerMetrics?.present && packet.leaguePlayerMetrics.value
      ? [[
          'AF league player metrics',
          {
            ...packet.leaguePlayerMetrics,
            value: packet.leaguePlayerMetrics.value.rows.map((row) => ({
              ...row,
              metricUnit: packet.leaguePlayerMetrics?.value?.unit,
              metricWeek: packet.leaguePlayerMetrics?.value?.week,
            })),
          } as GroundedSlice<unknown>,
        ] as [string, GroundedSlice<unknown>]]
      : []),
    /*
     * The asker's roster under this league's scoring — the number My Team shows. Named so the model prefers it over
     * the canonical rows above for anyone on this roster.
     */
    [ROSTER_PROJECTIONS_SLICE, packet.rosterProjections as GroundedSlice<unknown>],
    // On lineup questions: the same best lineup the My Team screen and the lineup tool give (2026-11-20).
    [MY_TEAM_LINEUP_SLICE, packet.myTeamLineup as GroundedSlice<unknown>],
    // On trade questions: the offers waiting on the asker with the one engine's grade — the trade tool's text (2026-11-20).
    [PENDING_TRADES_SLICE, packet.pendingTrades as GroundedSlice<unknown>],
    // On draft questions: the board and Draft OS's pick — the draft board tool's text (2026-11-20).
    [DRAFT_BOARD_SLICE, packet.draftBoard as GroundedSlice<unknown>],
    // On manager questions, Competitive Edge only: every leaguemate's record, facts only (2026-11-20).
    [MANAGER_RECORDS_SLICE, packet.managerRecords as GroundedSlice<unknown>],
    // NBA/MLB/NHL: the roster priced on the league's own board, the trade grade's price (2026-11-20).
    [ROSTER_BOARD_VALUES_SLICE, packet.rosterBoardValues as GroundedSlice<unknown>],
    ['Commissioner intelligence', packet.commissionerIntelligence as GroundedSlice<unknown>],
    ['League intelligence', packet.leagueIntelligence as GroundedSlice<unknown>],
    ['Cross-league portfolio', packet.portfolio as GroundedSlice<unknown>],
    /*
     * R2 — decisions bridged from the live engines (waiver, commissioner health).
     *
     * ⚠ NAMED "DECISION" IN THE PROMPT ON PURPOSE. These are deterministic verdicts the engine
     * already reached, not facts for the model to reason from. Chimmy's job is to EXPLAIN one,
     * never to re-derive or overrule it — which is the A5/P3 invariant.
     *
     * The `as` cast is safe against a missing slice: `sliceLine` returns [] for null/undefined,
     * which is what an optional slice is when this build did not request a decision.
     */
    ['Waiver decision', packet.waiverDecision as GroundedSlice<unknown>],
    ['Commissioner health decision', packet.commissionerHealthDecision as GroundedSlice<unknown>],
    /*
     * 🛑 THREE SLICES ADDED TO THE PACKET AND NEVER TO THIS LIST — G11 REPRODUCED, ONE LEVEL
     * REMOVED. `idpKickerValues` (R3.1), `rosterValueGrade` (R3.3) and `psychologyConsistency`
     * (R4b.5) were each added to `DecisionOsGroundingPacket`, to `packet.ts`'s OWN separate
     * `slices` list that feeds `collectGaps()`, and to `flags.ts` — every wiring point this
     * session's own established checklist named, except THIS one. The two `slices` arrays share a
     * name and a shape and are otherwise unrelated: packet.ts's drives `packet.gaps` ("WHAT IS
     * MISSING"), this one drives "WHAT IS AVAILABLE" — so an ABSENT reading correctly appeared as
     * a gap while a PRESENT one, with real data, silently never rendered at all. The failure case
     * was visible; the success case was not — backwards, and unnoticed because every producer-level
     * test this session wrote (mutation-verified and all) exercised the producer in isolation, never
     * a full packet through this exact function.
     */
    ['IDP/kicker values', packet.idpKickerValues as GroundedSlice<unknown>],
    ['Roster value grade', packet.rosterValueGrade as GroundedSlice<unknown>],

    // R4b — manager behavioural profiles. Rendered like any other collection: bounded,
    // with the hidden count stated.

    // The eight graded context slices (4.3). Rendered alongside the rest because a reader should
    // not have to know which subsystem produced a fact to know whether it is safe to use.
    ...(packet.contextFacts
      ? ([
          ['Matchup', packet.contextFacts.matchup],
          ['Roster', packet.contextFacts.roster],
          ['Standings', packet.contextFacts.standings],
          ['Rankings', packet.contextFacts.rankings],
          ['League difficulty', packet.contextFacts.leagueDifficulty],
          ['Imported history', packet.contextFacts.importedHistory],
          ['Replay insights', packet.contextFacts.replayInsights],
          ['Devy board', packet.contextFacts.devy],
          ['League office', packet.contextFacts.leagueOffice],
        ] as Array<[string, GroundedSlice<unknown>]>)
      : []),
  ]

  /*
   * Computed ONCE for the whole packet rather than per slice: the roster does not change between
   * slices, and every array slice wants the same answer.
   *
   * The roster lives under `contextFacts`, which is nullable in its own right -- the whole block
   * becomes null when the context engine is killed or throws, and `rosterPlayerKeys` returns an
   * empty set for that, making the ordering a no-op rather than an error.
   */
  const onRoster = rosterPlayerKeys(packet.contextFacts?.roster)
  const rendered = slices.map(([n, s]) => [n, sliceLine(n, s, now, onRoster)] as const)
  const answering = (options.intent ? ANSWERING_SLICES_BY_INTENT[options.intent] ?? [] : []).filter((name) =>
    rendered.some(([n, l]) => n === name && l.length > 0),
  )
  const available =
    answering.length === 0
      ? rendered.flatMap(([, l]) => l)
      : [
          `  (${options.intentLabel ? `This question: ${options.intentLabel}. ` : ''}` +
            `What answers it is listed first: ${answering.join('; ')}.)`,
          ...answering.flatMap((name) => rendered.find(([n]) => n === name)?.[1] ?? []),
          ...rendered.filter(([n]) => !answering.includes(n)).flatMap(([, l]) => l),
        ]

  if (available.length > 0) {
    lines.push('WHAT IS AVAILABLE:')
    lines.push(...available)
  }

  if (packet.gaps.length > 0) {
    lines.push('')
    lines.push('WHAT IS MISSING, AND WHY:')
    for (const g of collapseGapsByCause(packet.gaps)) {
      lines.push(
        g.slices.length === 1
          ? `- ${g.slices[0]}: ${g.detail} Fix: ${g.remedy}`
          : `- ${g.detail} Affects ${g.slices.length} facts: ${g.slices.join(', ')}. Fix: ${g.remedy}`,
      )
    }
    lines.push('')
    /*
     * ⚠ PHRASED AS AN INSTRUCTION BECAUSE A DESCRIPTION GETS DROPPED. The route's own freshness
     * block says "Always include this warning when answering" for the same reason.
     *
     * ⚠ THIS COMPOSES WITH THE SYSTEM PROMPT'S EXISTING CONVENTION RATHER THAN REPLACING IT.
     * `chimmy_system_prompt.md` already carries a missing-data scheme — "Honest about uncertainty
     * — when data is missing or confidence is low, say so clearly and give a confidence score",
     * with explicit deductions (missing player data -20%, missing injury report -15%, missing
     * league settings -10%).
     *
     * A second, differently-worded rule for the same situation is how this codebase ends up with
     * three league-health scorers. So the instruction below tells the model to apply the scheme it
     * ALREADY has to these specific gaps, and adds only the part the prompt cannot know: the
     * REASON and the REMEDY, which come from the packet.
     */
    lines.push(
      'These are missing data for your confidence score — apply your usual deductions. When the ' +
        'user asks about any of them, say plainly that you do not have it, give the reason above, ' +
        'and offer the fix. Do not estimate it, and do not answer from general knowledge as ' +
        'though it were their league data.',
    )
  }

  if (available.length === 0 && packet.gaps.length === 0) {
    // Neither available nor missing: nothing was requested. Say so rather than emitting a header
    // with no body, which reads to a model as an empty-but-authoritative source.
    return ''
  }

  return lines.join('\n')
}
