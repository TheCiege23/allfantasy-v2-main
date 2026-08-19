/**
 * Decision OS core — generic validator parity (domain-agnostic).
 *
 * Compares TWO validators (composed behind a Rule Framework) on a NORMALIZED category vocabulary.
 * Validators may be COMPLEMENTARY — share some categories and each cover some the other doesn't — so
 * "parity" means "do they agree where they overlap", and retiring one is only safe when neither has
 * unique coverage. The category vocabulary is supplied per-slice via ValidatorParityConfig; this
 * engine knows nothing about lineups/waivers/etc. Pure; no I/O.
 */
import type { RuleVerdict } from '@/lib/decision-os/core/decision'

export interface ValidatorParity {
  /** Do the validators agree on the categories they BOTH cover? */
  agreeOnSharedScope: boolean
  /** Shared categories where the two validators disagree (a real parity concern). */
  sharedDisagreements: string[]
  /** Categories only one validator covers (expected — they are complementary). */
  coverageDifferences: string[]
  diffs: string[]
  /** Safe to retire one validator only if there are no disagreements AND no unique coverage. */
  retirementSafe: boolean
  reason: 'equivalent' | 'complementary_coverage' | 'shared_disagreement' | 'canonical_validator_error'
  canonicalError?: string
}

export interface ValidatorParityConfig {
  /** Normalize an ILLEGAL verdict into a comparison category. Return null to ignore the verdict. */
  categoryFor: (verdict: RuleVerdict) => string | null
  /** Categories both validators are expected to cover (the parity scope). */
  sharedCategories: Set<string>
}

function illegalCategories(verdicts: RuleVerdict[], config: ValidatorParityConfig): Set<string> {
  const out = new Set<string>()
  for (const v of verdicts) {
    if (v.verdict !== 'illegal') continue
    const cat = config.categoryFor(v)
    if (cat) out.add(cat)
  }
  return out
}

export function compareValidatorParity(
  primary: RuleVerdict[],
  canonical: RuleVerdict[],
  config: ValidatorParityConfig,
  canonicalError?: string,
): ValidatorParity {
  const p = illegalCategories(primary, config)
  const c = illegalCategories(canonical, config)

  const sharedDisagreements: string[] = []
  for (const cat of config.sharedCategories) {
    if (p.has(cat) !== c.has(cat)) sharedDisagreements.push(cat)
  }
  const coverageDifferences: string[] = []
  for (const cat of new Set([...p, ...c])) {
    if (config.sharedCategories.has(cat)) continue
    if (p.has(cat) !== c.has(cat)) coverageDifferences.push(cat)
  }

  const diffs = [
    ...sharedDisagreements.map((cat) => `shared category '${cat}' differs (primary=${p.has(cat)}, canonical=${c.has(cat)})`),
    ...coverageDifferences.map((cat) => `category '${cat}' covered by only one validator`),
  ]

  const agreeOnSharedScope = sharedDisagreements.length === 0
  const retirementSafe = agreeOnSharedScope && coverageDifferences.length === 0 && !canonicalError
  const reason: ValidatorParity['reason'] = canonicalError
    ? 'canonical_validator_error'
    : !agreeOnSharedScope
      ? 'shared_disagreement'
      : coverageDifferences.length
        ? 'complementary_coverage'
        : 'equivalent'

  return { agreeOnSharedScope, sharedDisagreements, coverageDifferences, diffs, retirementSafe, reason, canonicalError }
}
