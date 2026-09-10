/**
 * Evidence integrity, checked before anything is serialized.
 *
 * 🛑 THE FAILURE THIS PREVENTS IS A RECOMMENDATION THAT CITES SOMETHING WHICH IS
 * NOT THERE. A calculation naming an input key that got dropped, a conclusion
 * resting on a fact with no source, a number carried on a stale reading nobody
 * labelled — each reads as fully supported, because the missing half is missing.
 * Validation is the only point where the whole set is visible at once.
 *
 * ⚠ IT FAILS CLOSED. Every problem here downgrades or withholds; none of them
 * repairs. A validator that "fixes" a dangling reference by inventing a fact is
 * the bug it was written to catch.
 */

import { sanitizeUntrusted } from '@/lib/chimmy/sanitizeUntrusted'
import { scopedRefusal, type ScopedRefusal } from './refusalScope'
import type { EnvelopeCalculation, EnvelopeFact, EnvelopeGap } from './types'

export type ValidationResult = {
  facts: EnvelopeFact[]
  calculations: EnvelopeCalculation[]
  gaps: EnvelopeGap[]
  refusals: ScopedRefusal[]
  /** Fact keys a recommendation may legitimately rest on. */
  supportableKeys: string[]
}

/**
 * Facts a recommendation may rest on.
 *
 * 🛑 STALE AND UNCITED FACTS ARE EXCLUDED, AND STALE IS THE ONE PEOPLE ARGUE
 * ABOUT. A stale fact is still worth STATING — labelled — because the reader can
 * weigh it. It is not worth CONCLUDING from, because the conclusion carries no
 * label and outlives the caveat.
 */
export function supportableFacts(facts: readonly EnvelopeFact[]): EnvelopeFact[] {
  return facts.filter(
    (f) =>
      !f.stale &&
      typeof f.citation?.source === 'string' &&
      f.citation.source.trim().length > 0 &&
      f.citation.basis !== 'unavailable'
  )
}

/**
 * Validate the whole set.
 *
 * `now` is injected so staleness is reproducible in a test rather than a
 * function of when the suite happened to run.
 */
export function validateEvidence(input: {
  facts: readonly EnvelopeFact[]
  calculations: readonly EnvelopeCalculation[]
  recommendation: string | null
  /** Keys the recommendation claims to rest on. Empty is itself a finding. */
  recommendationSupportKeys?: readonly string[]
}): ValidationResult {
  const gaps: EnvelopeGap[] = []
  const refusals: ScopedRefusal[] = []

  /*
   * 🛑 DUPLICATE OR CONTRADICTORY KEYS FAIL CLOSED. Two facts under one key
   * means one of them is wrong and nothing here can tell which — so BOTH are
   * dropped. Keeping "the first" or "the newest" picks a winner on an ordering
   * accident, and the reader is never told a choice was made.
   */
  const byKey = new Map<string, EnvelopeFact[]>()
  for (const f of input.facts) {
    byKey.set(f.key, [...(byKey.get(f.key) ?? []), f])
  }
  const facts: EnvelopeFact[] = []
  for (const [key, group] of byKey) {
    if (group.length === 1) {
      facts.push(group[0])
      continue
    }
    const values = new Set(group.map((g) => JSON.stringify(g.value)))
    gaps.push({
      reason: 'not_computed',
      detail:
        values.size === 1
          ? `${sanitizeUntrusted(key)} was reported ${group.length} times; the duplicate was dropped rather than picked between.`
          : `${sanitizeUntrusted(key)} was reported with ${values.size} different values. Nothing here can tell which is right, so none is stated.`,
      remedy: 'Resolve the producers so one authority reports this key.',
      factKey: key,
    })
  }

  /* Facts with no usable source are gaps, and their values are not carried. */
  const cited: EnvelopeFact[] = []
  for (const f of facts) {
    const ok =
      typeof f.citation?.source === 'string' &&
      f.citation.source.trim().length > 0 &&
      f.citation.basis !== 'unavailable'
    if (ok) cited.push(f)
    else {
      gaps.push({
        reason: 'not_computed',
        detail: `${sanitizeUntrusted(f.label)} has no source on file, so it is not stated.`,
        remedy: 'It appears once the producing feed reports it.',
        factKey: f.key,
      })
    }
  }

  const surviving = new Set(cited.map((f) => f.key))

  /*
   * 🛑 A CALCULATION WHOSE INPUTS DID NOT SURVIVE IS DROPPED, NOT REPAIRED. It
   * was computed from something we are no longer willing to state, so its output
   * inherits that. Keeping the number and dropping the provenance is how an
   * unsupported figure acquires the authority of a calculated one.
   */
  const calculations: EnvelopeCalculation[] = []
  for (const c of input.calculations) {
    const missing = c.inputFactKeys.filter((k) => !surviving.has(k))
    if (missing.length === 0) {
      calculations.push(c)
      continue
    }
    gaps.push({
      reason: 'not_computed',
      detail: `${sanitizeUntrusted(c.label)} was computed from evidence that did not survive validation (${missing.map(sanitizeUntrusted).join(', ')}), so it is not stated.`,
      remedy: 'It returns when its inputs are available and current.',
      factKey: c.key,
    })
    refusals.push(
      scopedRefusal(
        {
          code: 'insufficient_evidence',
          message: `I could not stand behind the ${sanitizeUntrusted(c.label)} number here, so I am not giving you one.`,
          remedy: 'Ask again once this league’s data is current.',
        },
        'league_recommendation'
      )
    )
  }

  /*
   * A recommendation must name what holds it up, and those keys must be facts
   * that survived. An empty support set is treated the same as a dangling one:
   * "trust me" is not a citation.
   */
  const supportable = supportableFacts(cited).map((f) => f.key)
  if (input.recommendation) {
    const claimed = input.recommendationSupportKeys ?? []
    const unsupported = claimed.filter((k) => !supportable.includes(k))
    if (claimed.length === 0 || unsupported.length > 0) {
      refusals.push(
        scopedRefusal(
          {
            code: 'insufficient_evidence',
            message:
              claimed.length === 0
                ? 'I do not have evidence I can point to for that recommendation, so I will not make it.'
                : 'The evidence behind that recommendation did not hold up, so I will not make it.',
            remedy: 'Ask again once this league’s data is current.',
          },
          'league_recommendation'
        )
      )
      gaps.push({
        reason: 'not_computed',
        detail:
          claimed.length === 0
            ? 'The recommendation named no supporting evidence.'
            : `The recommendation rested on ${unsupported.map(sanitizeUntrusted).join(', ')}, which did not survive validation.`,
        remedy: 'The recommendation returns when its evidence does.',
      })
    }
  }

  return { facts: cited, calculations, gaps, refusals, supportableKeys: supportable }
}
