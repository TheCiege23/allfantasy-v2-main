/**
 * Dashboard v2 section header — the 3px accent tab, the mono uppercase label,
 * and the right-aligned mono counter.
 *
 * Every module in the v2 handoff is introduced by this same header, so it is one
 * component rather than a shape re-typed per section. The counter is deliberately
 * a `string | null`: a section with nothing to count omits it, instead of
 * rendering "0 ITEMS", which reads as a measured zero rather than as an absence.
 */
export function SectionHeader({
  label,
  counter = null,
  id,
}: {
  label: string
  counter?: string | null
  id?: string
}) {
  return (
    <div className="af-d2-sec-head" id={id}>
      <span className="af-d2-sec-tab" aria-hidden />
      <h2 className="af-d2-sec-label af-num">{label}</h2>
      {counter ? <span className="af-d2-sec-count af-num">{counter}</span> : null}
    </div>
  )
}

export default SectionHeader
