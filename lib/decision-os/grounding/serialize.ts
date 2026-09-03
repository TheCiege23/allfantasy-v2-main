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

  /*
   * DecisionFact (R2.1) — a bridged decision from one of the four live engines.
   *
   * 🛑 THIS BRANCH MUST PRECEDE THE ARRAY CHECK BELOW, AND ITS ABSENCE WAS G11 IN MINIATURE. A
   * DecisionFact is a plain object, so without it `!Array.isArray(value)` returns [] and a decision
   * slice serialises to its header line and nothing else — "lineupDecision: available", which is
   * precisely the failure this file was rewritten to fix for values.
   */
  if (isDecisionFact(value)) return renderDecision(value)

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
  for (const [k, v] of Object.entries(o)) {
    if (rows.length >= MAX_ITEMS) break
    if (SKIP_KEYS.has(k) || v == null) continue

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
  if (typeof o.playerId === 'string' && typeof o.points !== 'number' && ('playerName' in o || 'position' in o)) {
    const who = typeof o.playerName === 'string' && o.playerName ? o.playerName : null
    if (!who) return null
    return o.position ? `${who} (${String(o.position)})` : who
  }

  // PsychologyProfileFact — labels plus only the scores that cleared their evidence floor.
  if (typeof o.managerId === 'string' && Array.isArray(o.labels) && o.scores && typeof o.scores === 'object') {
    const labels = (o.labels as unknown[]).filter((l): l is string => typeof l === 'string')
    const sc = o.scores as Record<string, unknown>
    // ⚠ ONLY NON-NULL SCORES ARE RENDERED. A null is "not enough evidence to say", and printing
    // it as 0 would hand the model a measured-looking number for an absence — the exact failure
    // `gateScores` nulls it to prevent.
    const measured = Object.entries(sc)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => `${k.replace(/Score$/, '')} ${fmt(v as number)}`)
    const bits: string[] = []
    if (labels.length) bits.push(labels.join(', '))
    if (measured.length) bits.push(measured.join(' · '))
    const unmeasured = Array.isArray(o.unmeasuredDimensions) ? (o.unmeasuredDimensions as string[]) : []
    // Naming what is unmeasured lets an answer decline one read without hedging the whole profile.
    if (unmeasured.length) bits.push(`no ${unmeasured.join('/')} read yet`)
    /*
     * R4b.5 — trajectory. Same rule as everything else in this branch: only render it when it says
     * something. `hasTrajectory: false` is `summariseTrajectory`'s own honest refusal (one season,
     * or nothing clears the evidence floor), and repeating that refusal here would just be noise —
     * the label/score bits above already carry the CURRENT read.
     */
    const trajectory = o.trajectory as Record<string, unknown> | undefined
    if (trajectory?.hasTrajectory === true && typeof trajectory.summary === 'string') {
      bits.push(`trajectory: ${trajectory.summary}`)
    }
    const n = typeof o.evidenceCount === 'number' ? ` [${o.evidenceCount} obs]` : ''
    return bits.length ? `manager ${o.managerId}${n}: ${bits.join(' — ')}` : null
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

function sliceLine(name: string, s: GroundedSlice<unknown> | null | undefined, now: number): string[] {
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
    /*
     * R2 — decisions bridged from the four live engines.
     *
     * ⚠ NAMED "DECISION" IN THE PROMPT ON PURPOSE. These are deterministic verdicts the engine
     * already reached, not facts for the model to reason from. Chimmy's job is to EXPLAIN one,
     * never to re-derive or overrule it — which is the A5/P3 invariant.
     *
     * The `as` cast is safe against a missing slice: `sliceLine` returns [] for null/undefined,
     * which is what an optional slice is when this build did not request a decision.
     */
    ['Lineup decision', packet.lineupDecision as GroundedSlice<unknown>],
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
    ['Psychology consistency (cross-league/cross-sport)', packet.psychologyConsistency as GroundedSlice<unknown>],
    // R4b — manager behavioural profiles. Rendered like any other collection: bounded,
    // with the hidden count stated.
    ['Manager psychology', packet.managerPsychology as GroundedSlice<unknown>],
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

  /*
   * R4b.7 (P4) — psychology frames a decision's explanation; it never changes the decision.
   *
   * ⚠ CONDITIONAL, NOT A STANDING RULE. Padding every prompt with an instruction about an
   * interaction that is not even in play is the same mistake the gaps block above already avoids
   * by checking `packet.gaps.length > 0` first. This only appears when BOTH a decision (from one
   * of the three live engines this packet can carry) AND manager psychology are actually present
   * — the one situation the rule exists to govern.
   *
   * ⚠ ONE GENERAL RULE, NOT ONE PER ENGINE. `decisionBridge.ts`'s own header already states why
   * the four live engines are never touched by this session's work: "if a change here appears to
   * need an engine change, that is the signal to stop and re-scope." Wiring framing into each
   * engine's own text would mean editing the engines, or hand-writing a rule per decision type
   * that needs updating every time one is added. A rule stated once, here, at the one place every
   * decision and every psychology fact are already combined into one prompt, covers all three
   * today and whatever is bridged next without touching any of them.
   */
  const hasDecision = [packet.lineupDecision, packet.waiverDecision, packet.commissionerHealthDecision].some(
    (d) => d?.present,
  )
  if (hasDecision && packet.managerPsychology.present) {
    lines.push('')
    lines.push(
      'Manager psychology may inform how you EXPLAIN a decision above — framing, not authority. ' +
        'A decision\'s four answers, grade, and legality are already final; a behavioural label or ' +
        'trajectory may motivate why a manager might make a move, never justify a different verdict ' +
        'than the decision itself gives.',
    )
  }

  if (available.length === 0 && packet.gaps.length === 0) {
    // Neither available nor missing: nothing was requested. Say so rather than emitting a header
    // with no body, which reads to a model as an empty-but-authoritative source.
    return ''
  }

  return lines.join('\n')
}
