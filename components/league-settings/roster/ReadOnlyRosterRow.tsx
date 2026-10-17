import { RosterSlotLabel } from './RosterRowControl'
import type { SlotDef } from './types'

/** A roster slot as a non-commissioner sees it: label and count, no controls. */
export function ReadOnlyRosterRow({
  def,
  count,
}: {
  def: SlotDef
  count: number
}) {
  return (
    <div className="af-ls-stepper-row" data-testid={`roster-row-${def.key}`}>
      <RosterSlotLabel def={def} />
      <span className="min-w-[28px] shrink-0 pr-2 text-right font-mono text-sm font-bold text-white">{count}</span>
    </div>
  )
}
