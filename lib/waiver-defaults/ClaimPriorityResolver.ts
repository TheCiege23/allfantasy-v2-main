/**
 * Resolves claim priority / tiebreak rules for waiver processing and UI.
 * Used by process engine and waiver wire UI to order claims and resolve ties.
 */
import type { TiebreakRule } from '@/lib/waiver-wire/types'

interface ClaimPriorityDescription {
  rule: TiebreakRule | string
  label: string
  description: string
}

const RULES: Record<string, ClaimPriorityDescription> = {
  faab_highest: {
    rule: 'faab_highest',
    label: 'FAAB (highest bid wins)',
    description: 'For FAAB leagues; ties by next priority or earliest claim.',
  },
  priority_lowest_first: {
    rule: 'priority_lowest_first',
    label: 'Waiver priority (lowest number first)',
    description: 'Standard waiver order; lower priority number gets the player.',
  },
  reverse_standings: {
    rule: 'reverse_standings',
    label: 'Reverse standings',
    description: 'Worst team gets first claim.',
  },
  earliest_claim: {
    rule: 'earliest_claim',
    label: 'Earliest claim',
    description: 'First submitted claim wins.',
  },
}

/**
 * Get claim priority / tiebreak rule description for UI and processor.
 */
export function getClaimPriorityRule(tiebreakRule: string | undefined | null): ClaimPriorityDescription {
  const key = (tiebreakRule ?? 'faab_highest').toString().toLowerCase().replace(/-/g, '_')
  return RULES[key] ?? RULES.faab_highest ?? { rule: key, label: tiebreakRule ?? 'FAAB', description: '' }
}

/**
 * Whether the league uses FAAB for claim priority (tiebreak faab_highest when waiver type is faab).
 */
export function isFaabPriority(waiverType: string, tiebreakRule: string | undefined | null): boolean {
  return waiverType === 'faab' && (tiebreakRule == null || tiebreakRule === 'faab_highest' || tiebreakRule === 'faab')
}
