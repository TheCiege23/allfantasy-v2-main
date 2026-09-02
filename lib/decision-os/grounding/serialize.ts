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

/** Trim a prose slice so one long saved analysis cannot crowd out every other fact. */
const MAX_PROSE = 1200

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
function renderValue(name: string, value: unknown): string[] {
  // The four `GroundedSlice<string>` slices are already prompt-ready prose. Reducing them to
  // "available" is what silenced three-brain's saved conclusion — the substance of plan item 6.2.
  if (typeof value === 'string') {
    const trimmed = value.length > MAX_PROSE ? `${value.slice(0, MAX_PROSE)}…` : value
    return trimmed.split('\n').map((l) => `    ${l}`)
  }

  if (!Array.isArray(value) || value.length === 0) return []

  const rows: string[] = []
  for (const item of value.slice(0, MAX_ITEMS)) {
    const line = renderItem(item)
    if (line) rows.push(`    · ${line}`)
  }
  const hidden = value.length - MAX_ITEMS
  if (hidden > 0) rows.push(`    · …and ${hidden} more not shown (${name} holds ${value.length})`)
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

  // ProjectionFact
  if (typeof o.playerName === 'string' && typeof o.points === 'number') {
    const pos = o.position ? ` (${String(o.position)})` : ''
    // `rescored` is surfaced because "under your league's rules" and "under our default" are
    // different claims, and a reader who cannot tell them apart will assume the first.
    const scored = o.rescored === true ? ' — rescored for this league' : ' — canonical preset, NOT this league'
    return `${o.playerName}${pos} ${fmt(o.points)} pts${scored}`
  }

  return null
}

function sliceLine(name: string, s: GroundedSlice<unknown>, now: number): string[] {
  if (!s.present) return []
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
  return [`- ${name}: available${meta}${blocked}`, ...renderValue(name, s.value)]
}

export function serializeDecisionOsGroundingForPrompt(
  packet: DecisionOsGroundingPacket,
  now: number = Date.now(),
): string {
  const lines: string[] = []

  const slices: Array<[string, GroundedSlice<unknown>]> = [
    ['Import state', packet.importAssertions as GroundedSlice<unknown>],
    ['League rules', packet.leagueRules],
    ['Market player values', packet.marketValues as GroundedSlice<unknown>],
    ['Devy/college values', packet.devyValues as GroundedSlice<unknown>],
    ['Projections', packet.projections as GroundedSlice<unknown>],
    ['Commissioner intelligence', packet.commissionerIntelligence as GroundedSlice<unknown>],
    ['League intelligence', packet.leagueIntelligence as GroundedSlice<unknown>],
    ['Cross-league portfolio', packet.portfolio as GroundedSlice<unknown>],
    // 6.2 — three-brain's saved conclusion, read not run. See packet.savedAnalysis.
    ['Saved analysis', packet.savedAnalysis as GroundedSlice<unknown>],
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
        ] as Array<[string, GroundedSlice<unknown>]>)
      : []),
  ]

  const available = slices.flatMap(([n, s]) => sliceLine(n, s, now))

  if (available.length > 0) {
    lines.push('WHAT IS AVAILABLE:')
    lines.push(...available)
  }

  if (packet.gaps.length > 0) {
    lines.push('')
    lines.push('WHAT IS MISSING, AND WHY:')
    for (const g of packet.gaps) {
      lines.push(`- ${g.slice}: ${g.detail} Fix: ${g.remedy}`)
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
