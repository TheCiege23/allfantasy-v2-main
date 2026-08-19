/**
 * Decision OS Phase 6.2 — LLM prompt-text formatter for ManagerDnaProfile.
 *
 * Prerequisite for Phase 2C of the Manager DNA de-duplication
 * (docs/DECISION_OS_MANAGER_DNA_DEDUP_AUDIT.md §6): the legacy
 * `lib/manager-dna.ts` exposes `formatDNAForPrompt()`, which AI Coach, Trade
 * Analyzer, and Trade Proposal Generator all consume as raw LLM context text.
 * Phase 6 DNA had no equivalent — only a UI view-model adapter
 * (`lib/decision-os/manager-dna.ts`'s `buildManagerDnaViewModel`). This file
 * is that missing piece, built purely additively: it does not change
 * `ManagerDnaProfile`'s shape or any existing Phase 6 DNA behavior.
 *
 * Deliberately does NOT expose `derivation` (internal classifier scoring
 * audit trail) — that's implementation detail, not context an LLM needs, and
 * leaking it would violate the same "no backend internals in user-facing
 * surfaces" convention the UI adapter already follows (see
 * __tests__/manager-dna-decision-os.test.tsx's backend-word masking checks).
 * `warnings` ARE included when present — they're genuine data-quality signals
 * an LLM should know about, consistent with Decision OS's honest-degradation
 * principle (never fabricate, always disclose uncertainty).
 *
 * This module is not wired into AI Coach, Trade Analyzer, or Trade Proposal
 * Generator yet — that migration is explicitly out of scope for Phase 2C.
 */

import type { ManagerDnaProfile } from './types'

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

/**
 * Renders a `ManagerDnaProfile` as an LLM prompt-context block, mirroring the
 * structure of legacy `formatDNAForPrompt()` (header, identity + confidence,
 * behavioral summary, closing tailoring instruction) using Phase 6's
 * categorical dimensions and traits instead of legacy's numeric 0–1 dials —
 * Phase 6 has no equivalent to those fine-grained metrics and this formatter
 * does not fabricate them.
 *
 * Returns '' when the profile has no confident identity (`primaryIdentity
 * === 'unknown'`), matching legacy's behavior of staying silent when there
 * isn't enough signal to say anything useful.
 */
export function formatManagerDnaForPrompt(profile: ManagerDnaProfile): string {
  if (profile.primaryIdentity === 'unknown') return ''

  const lines: string[] = [
    '',
    '## MANAGER DNA PROFILE',
    `Identity: ${titleCase(profile.primaryIdentity)}`,
    `Confidence: ${Math.round(profile.confidence * 100)}% (data completeness: ${profile.completeness}%)`,
    '',
    '### Behavioral Dimensions:',
    `- Decision Style: ${titleCase(profile.decisionStyle)}`,
    `- Transaction Style: ${titleCase(profile.transactionStyle)}`,
    `- Risk Tendency: ${titleCase(profile.riskTendency)}`,
    `- Engagement Reliability: ${titleCase(profile.engagementReliability)}`,
  ]

  if (profile.traits.length > 0) {
    lines.push('')
    lines.push('### Behavioral Traits:')
    for (const trait of profile.traits) {
      const evidence = trait.evidence.length > 0 ? ` — ${trait.evidence.join('; ')}` : ''
      lines.push(`- ${titleCase(trait.trait)} (${trait.strength})${evidence}`)
    }
  }

  if (profile.warnings.length > 0) {
    lines.push('')
    lines.push('### Data Notes:')
    for (const warning of profile.warnings) {
      lines.push(`- ${warning}`)
    }
  }

  lines.push('')
  lines.push(
    "IMPORTANT: Tailor your analysis tone and advice to this manager's profile. Reference their tendencies when relevant.",
  )

  return lines.join('\n')
}
