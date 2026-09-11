/**
 * Scout → trade pitch: how to approach a manager, derived from how they actually play.
 *
 * `tradePitch.ts` already composes the pitch on a trade-window card, and every clause in it
 * comes from PRESENCE — when this manager moves, what they start, whether now is their window.
 * It knows nothing about how they behave. Meanwhile the psychological profile engine has known
 * for months that someone is a `trade-heavy` `win-now` manager or a `quiet strategist`, and
 * nothing that composes a pitch has ever read it.
 *
 * This is that seam, and it is deliberately the smaller half of it.
 *
 * ── 🛑 WHAT THIS REFUSES TO DO, AND WHY IT IS NOT A LIMITATION TO FIX LATER ──
 *
 * It says HOW to approach someone. It does NOT say WHAT to offer.
 *
 * "Send Pollard for Kincaid" needs their roster needs priced against yours, and pricing has one
 * authoritative path in this codebase — the market path — which this module does not read. A
 * behavioural label cannot substitute: `win-now` tells you they will pay for production this
 * season, not which of your players they want. Inventing the package from the label is exactly
 * the move that would make this feel smart and be wrong, on a screen whose entire value is that
 * it does not guess.
 *
 * ── ⚠ EVERY LINE IS DERIVED FROM A LABEL THE ENGINE ACTUALLY EMITS ──
 *
 * The vocabulary below is read from `ProfileLabelResolver`'s real output — `trade-heavy`,
 * `win-now`, `patient rebuilder`, `quiet strategist`, `value-first`, `chaos agent`,
 * `waiver-focused`, `conservative`, `aggressive`. Nothing here matches on a label the engine
 * cannot produce, because a rule keyed on an invented string is a rule that never fires and
 * never fails — it just quietly contributes nothing while looking like coverage.
 *
 * ⚠ AND THE SCORES ARE READ ONLY WHEN NON-NULL. `psychology-os` gates every score behind an
 * evidence floor and returns null below it. A null read as zero would describe an unobserved
 * manager as maximally passive, which is a claim about a real person made out of our own
 * missing data.
 */

/** The gated score set, exactly as `psychology-os` hands it over. */
export type AngleScores = {
  aggressionScore: number | null
  activityScore: number | null
  tradeFrequencyScore: number | null
  waiverFocusScore: number | null
  riskToleranceScore: number | null
}

export type ScoutAngle = {
  /**
   * One sentence on how to open with this manager. Null when nothing observed clears the bar —
   * an absent angle, never a hedged one.
   */
  approach: string | null
  /**
   * What NOT to do, when the profile supports saying so. Separate from `approach` because the
   * negative is often the more actionable half and should not be buried mid-sentence.
   */
  avoid: string | null
  /**
   * Which labels and scores produced the lines above, so the screen can show its working and a
   * reader can disagree with the reasoning rather than only with the conclusion.
   */
  basis: string[]
}

const EMPTY: ScoutAngle = { approach: null, avoid: null, basis: [] }

/** Case-insensitive membership, since labels arrive as the engine cased them. */
function has(labels: readonly string[], needle: string): boolean {
  const n = needle.toLowerCase()
  return labels.some((l) => l.toLowerCase() === n)
}

/**
 * Compose the approach.
 *
 * ⚠ PURE, AND THAT IS LOAD-BEARING RATHER THAN TIDY. What a screen tells a manager about
 * another named person should be assertable in a test without a database, a session or a
 * network call — so the exact sentence shown for a given profile can be pinned, and changing it
 * has to be deliberate.
 *
 * 🛑 THE CALLER MUST HAVE ALREADY PASSED THE ENTITLEMENT GATE. This takes facts, not a viewer,
 * and cannot tell a permitted read from a leaked one. Opponent psychology is premium
 * (`ProfileAccess`); handing this a locked profile's labels would launder them into prose that
 * the lock exists to withhold. `scout.ts` resolves access before it ever builds these.
 */
export function scoutAngle(input: {
  labels: readonly string[]
  scores: AngleScores
  /** False when nothing clears the evidence floor — no angle is drawn at all. */
  anySufficient: boolean
}): ScoutAngle {
  const { labels, scores, anySufficient } = input

  /*
   * ⚠ THE FLOOR IS CHECKED FIRST AND SHORT-CIRCUITS. A profile can carry labels while every
   * dimension sits below its evidence floor; drawing an angle from those would dress up a
   * reading the engine has explicitly declined to stand behind.
   */
  if (!anySufficient || labels.length === 0) return EMPTY

  const basis: string[] = []
  const approach: string[] = []
  const avoid: string[] = []

  if (has(labels, 'trade-heavy')) {
    basis.push('trade-heavy')
    approach.push('opens the door on most offers, so lead with the real one rather than an anchor')
  }

  if (has(labels, 'quiet strategist')) {
    basis.push('quiet strategist')
    approach.push('rarely initiates, so the first move has to be yours and it has to be specific')
    avoid.push('open-ended "anyone available?" messages — they go unanswered')
  }

  if (has(labels, 'win-now')) {
    basis.push('win-now')
    approach.push('pays for production this season; picks and youth read as a downgrade to them')
  }

  if (has(labels, 'patient rebuilder')) {
    basis.push('patient rebuilder')
    approach.push('wants picks and youth, and will take less production to get them')
    avoid.push('ageing production, however good the name')
  }

  if (has(labels, 'value-first')) {
    basis.push('value-first')
    approach.push('checks the numbers, so send something that already grades fair')
    avoid.push('a deliberately light first offer — it ends the conversation rather than starting it')
  }

  if (has(labels, 'chaos agent')) {
    basis.push('chaos agent')
    approach.push('unpredictable by record; expect a counter that ignores conventional value')
  }

  if (has(labels, 'waiver-focused')) {
    basis.push('waiver-focused')
    approach.push('builds through the wire more than the trade block, so the bar for a deal is high')
  }

  if (has(labels, 'conservative')) {
    basis.push('conservative')
    avoid.push('multi-player packages — the more moving parts, the likelier a no')
  }

  if (has(labels, 'aggressive')) {
    basis.push('aggressive')
    approach.push('will push back hard; expect a counter and leave yourself room for one')
  }

  /*
   * Scores refine what the labels already said; they never speak alone. A number without the
   * behaviour it came from is the kind of figure that reads as precision and carries none — and
   * `null` here means "below the floor", so it is skipped rather than treated as low.
   */
  const tf = scores.tradeFrequencyScore
  if (tf != null && tf <= 20 && !has(labels, 'trade-heavy')) {
    basis.push(`trade frequency ${tf}`)
    avoid.push('counting on a trade at all — they have barely made one')
  }

  const act = scores.activityScore
  if (act != null && act >= 75) {
    basis.push(`activity ${act}`)
    approach.push('is in the app often, so a message will be seen quickly')
  }

  /*
   * ⚠ NULL, NOT AN EMPTY STRING. A caller rendering `?? ''` gets nothing either way, but a
   * caller checking truthiness gets the right answer only from null — and this whole module
   * exists to make "we have nothing to say" a first-class outcome.
   */
  return {
    approach: approach.length > 0 ? `${approach.join('; ')}.` : null,
    avoid: avoid.length > 0 ? `Avoid: ${avoid.join('; ')}.` : null,
    basis,
  }
}
