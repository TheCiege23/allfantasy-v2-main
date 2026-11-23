import { EvidenceLine } from '@/components/core-app/primitives/EvidenceLine'

/**
 * Why AF moved this projection — the learned factors (injury designation before the game, rest, form, opponent …),
 * verbatim from the learner (`lib/af-projections/factors/factorTables.ts` `factorReason`), e.g. "listed Questionable or
 * day-to-day before the game -15% (measured on 812 games)". One line, truncated, full text on hover/long-press.
 *
 * Only for viewers with AF Intelligence: the server strips `afFactors` for everyone else
 * (`lib/core-app/afIntelligenceWithhold.ts`), so a locked viewer passes no reasons and this renders nothing.
 */
export function ProjectionFactorLine({ reasons, testId }: { reasons: ReadonlyArray<string> | null | undefined; testId?: string }) {
  const lines = (reasons ?? []).filter((r) => typeof r === 'string' && r.trim() !== '')
  if (lines.length === 0) return null
  return (
    <span className="block truncate text-[10px] text-white/45" title={lines.join(' · ')} data-testid={testId}>
      <EvidenceLine inline label="AF" lines={lines} />
    </span>
  )
}
