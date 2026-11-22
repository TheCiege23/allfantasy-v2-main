'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { pickChipLabel, pickChipViaRosterId, type TradePickChip } from '@/lib/dynasty-core/dynastyDetails'
import './dynasty-details.css'

/**
 * A pick as the Dynasty Era draws it: `2027 R1` in condensed caps, a gold outline for a first, a
 * line outline for a later round, and "via <team>" when it came from a team other than the one
 * sending it. `teamName` resolves a roster id; a "via" it cannot name is left off.
 */
export function DynastyPickChip({
  pick,
  teamName,
}: {
  pick: TradePickChip
  teamName?: (rosterId: string) => string | null | undefined
}) {
  const { tInterpolate } = useOptionalLanguage()
  const label = pickChipLabel(pick)
  const viaId = pickChipViaRosterId(pick)
  const via = viaId ? teamName?.(viaId)?.trim() || null : null
  return (
    <span className="dyd-pick-chip" data-round={pick.round} data-testid="dynasty-pick-chip">
      <span className="sr-only">{tInterpolate('dynasty.pickChip.aria', { pick: label })}</span>
      <span aria-hidden="true">{label}</span>
      {via ? <span className="dyd-pick-chip-via">{tInterpolate('dynasty.pickChip.via', { team: via })}</span> : null}
    </span>
  )
}
