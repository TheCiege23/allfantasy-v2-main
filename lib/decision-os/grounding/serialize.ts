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

function sliceLine(name: string, s: GroundedSlice<unknown>, now: number): string | null {
  if (!s.present) return null
  const bits: string[] = []
  const age = ageLine(s.asOf, now)
  if (age) bits.push(age)
  if (s.servedFrom) bits.push(`served from ${s.servedFrom}`)
  if (s.confidence != null) bits.push(`confidence ${s.confidence.toFixed(2)}`)
  const meta = bits.length ? ` (${bits.join(', ')})` : ''
  const blocked = !s.conclusive.ok ? ' — PRESENT BUT NOT SAFE TO ACT ON, see gaps below' : ''
  return `- ${name}: available${meta}${blocked}`
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

  const available = slices.map(([n, s]) => sliceLine(n, s, now)).filter((x): x is string => x !== null)

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
     * block says "Always include this warning when answering" for the same reason. Telling the
     * model a fact is missing invites it to fill the hole; telling it what to SAY does not.
     */
    lines.push(
      'If the user asks about anything listed as missing, say plainly that you do not have it, ' +
        'give the reason above, and offer the fix. Do not estimate it, and do not answer from ' +
        'general knowledge as though it were their league data.',
    )
  }

  if (available.length === 0 && packet.gaps.length === 0) {
    // Neither available nor missing: nothing was requested. Say so rather than emitting a header
    // with no body, which reads to a model as an empty-but-authoritative source.
    return ''
  }

  return lines.join('\n')
}
