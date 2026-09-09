/**
 * Serialize a league's resolved rules for the Chimmy prompt.
 *
 * 🛑 EVERY LINE THIS EMITS CARRIES ITS PROVENANCE, AND THAT IS THE POINT. A
 * model handed "max keepers: 3" cannot tell a commissioner's setting from a
 * template default from a guess, and will state all three in the same
 * confident voice. Marking them here is the only place the distinction can
 * survive into the answer.
 *
 * ⚠ WHAT IS NOT ON FILE IS PRINTED AS NOT ON FILE, never omitted. An omitted
 * rule reads to the model as "no such rule", which is a different and wrong
 * claim — and it is the one that produces an invented keeper policy.
 */

import { resolveLeagueRules, type LeagueRuleInput, type ResolvedLeagueRules } from '@/lib/league-rules'
import type { ResolvedRule } from '@/lib/league-rules'

/** How a resolved rule reads in the prompt, provenance included. */
function renderRule(label: string, rule: ResolvedRule<unknown>): string {
  if (rule.provenance === 'unknown') {
    return `- ${label}: NOT ON FILE (${rule.basis}). Say you do not know it; do not substitute a default.`
  }
  if (rule.provenance === 'schema_default') {
    /*
     * ⚠ THE VALUE IS PRINTED, AND SO IS THE FACT THAT NOBODY IS KNOWN TO HAVE
     * CHOSEN IT. Hiding the value would make Chimmy unable to answer at all;
     * printing it bare would make it state a keeper policy for every league in
     * the database, because that is what the column default guarantees.
     */
    return `- ${label}: ${String(rule.value)} — UNCONFIRMED DEFAULT (${rule.basis}). Offer it as the platform default and say it has not been confirmed for this league; never assert it as a league rule.`
  }
  const marker = rule.provenance === 'catalog_default' ? ' [format default, not this league’s setting]' : ''
  return `- ${label}: ${String(rule.value)}${marker}`
}

/**
 * The rules block for the system prompt.
 *
 * Returns null when there is nothing worth saying — an unclassifiable league
 * with no keeper data produces no block rather than an empty heading, because
 * a heading with nothing under it invites the model to fill it in.
 */
export function buildLeagueRulesGrounding(league: LeagueRuleInput): string | null {
  const resolved = resolveLeagueRules(league)
  return renderLeagueRulesGrounding(resolved)
}

/** Same, for a caller that already resolved (avoids resolving twice). */
export function renderLeagueRulesGrounding(resolved: ResolvedLeagueRules): string | null {
  const { concept, modifiers, formatRules } = resolved
  const lines: string[] = []

  lines.push(`LEAGUE RULES (catalog ${resolved.catalogVersion})`)

  if (concept) {
    lines.push(`Format: ${concept.label} (rule version ${concept.ruleVersion})`)
    /*
     * ⚠ BOTH NAMES, NEVER ONE. King of the Hill is STORED as redraft; saying
     * only "King of the Hill" hides why the roster looks like a redraft roster,
     * and saying only "redraft" is the bug this whole module exists to fix.
     */
    if (concept.flattenedOnto) {
      lines.push(
        `  Stored on a ${concept.flattenedOnto} shell, but the format IS ${concept.label} — the ${concept.flattenedOnto} label is the base it was flattened onto, not what this league is.`
      )
    }
    lines.push(`  ${concept.summary}`)
    if (concept.elimination) lines.push(`  Elimination: ${concept.elimination}`)
    if (concept.tiebreak) lines.push(`  Tiebreak: ${concept.tiebreak}`)
    if (concept.playoffs) lines.push(`  Playoffs: ${concept.playoffs}`)

    if (concept.phases.length > 0) {
      lines.push('  Phases:')
      for (const p of concept.phases) lines.push(`    - ${p.label}: ${p.summary}`)
    }

    /*
     * ⚠ ILLEGAL ACTIONS ARE LISTED LOUDLY AND LEGAL ONES QUIETLY. "This format
     * has no trades" is the fact that stops a wrong answer; "trades are legal"
     * only invites one, because format legality is a necessary condition and
     * the model must still not promise an action it has not had authorised.
     */
    const illegal = concept.actions.filter((a) => !a.legalInFormat)
    if (illegal.length > 0) {
      lines.push('  NOT POSSIBLE IN THIS FORMAT — never suggest these:')
      for (const a of illegal) lines.push(`    - ${a.label}: ${a.note ?? 'not available in this format.'}`)
    }
    const noted = concept.actions.filter((a) => a.legalInFormat && a.note)
    if (noted.length > 0) {
      lines.push('  Action notes:')
      for (const a of noted) lines.push(`    - ${a.label}: ${a.note}`)
    }

    if (resolved.sportSupported === false) {
      lines.push(
        `  ⚠ COVERAGE: this concept is implemented for ${concept.supportedSports.join(', ')}; this league is ${resolved.sport}. Do not assume the mechanics above are wired for this sport.`
      )
    }
  } else {
    /*
     * ⚠ AN HONEST BLANK. `readFormatRules` returned something the catalog does
     * not document — including `other`, which means classification itself was
     * inconclusive. Naming the raw concept lets the answer stay accurate
     * without the catalog pretending to explain a format it has no entry for.
     */
    lines.push(
      `Format: not documented in the catalog (classifier returned "${formatRules.concept}"). Do not describe format-specific mechanics for this league; answer from its stored settings only.`
    )
  }

  if (modifiers.length > 0) {
    lines.push('Scoring/roster modifiers ON TOP of the format above (they do not replace it):')
    for (const m of modifiers) lines.push(`  - ${m.label}: ${m.summary}`)
  }

  const keeperLines = [
    renderRule('Max keepers', resolved.keeper.maxKeepers),
    renderRule('Keeper cost system', resolved.keeper.costSystem),
    renderRule('Keeper round penalty', resolved.keeper.roundPenalty),
    renderRule('Future picks tradeable', resolved.keeper.futurePicksTradeable),
  ]
  /*
   * ⚠ A SCHEMA DEFAULT IS NOT A REASON TO PRINT THIS BLOCK. Every League row
   * carries keeperCount=3 and keeperCostSystem="round_based" from the column
   * defaults, so counting those as "known" would staple a keeper policy onto
   * every redraft league in the database — the exact invention the provenance
   * split exists to stop. Only a real league setting earns the block.
   *
   * The keeper-format branch is separate and deliberate: there, "we do not know
   * your keeper cost system" is the most important line on the page, because it
   * is the number that decides every trade in the format.
   */
  const anySet = [
    resolved.keeper.maxKeepers,
    resolved.keeper.costSystem,
    resolved.keeper.roundPenalty,
    resolved.keeper.futurePicksTradeable,
  ].some((r) => r.provenance === 'league_setting')
  if (anySet || formatRules.concept === 'keeper') {
    lines.push('Keeper / pick rules:')
    lines.push(...keeperLines.map((l) => `  ${l}`))
  }

  if (formatRules.notes.length > 0) {
    lines.push('Format notes:')
    for (const n of formatRules.notes) lines.push(`  - ${n}`)
  }

  lines.push(
    'Rule authority order: this league’s stored settings beat catalog defaults, and catalog defaults beat general fantasy knowledge. A rule marked NOT ON FILE stays unknown — if the user asserts it, treat that as their claim pending commissioner confirmation, not as an established league rule.'
  )

  return lines.length > 1 ? lines.join('\n') : null
}
