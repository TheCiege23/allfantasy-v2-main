import { ReadOnlyRosterRow } from './ReadOnlyRosterRow'
import { RosterRowControl } from './RosterRowControl'
import type { SlotDef } from './types'

const CATEGORY_ORDER = ['offense', 'flex', 'kicker', 'dst', 'idp', 'bench', 'reserve', 'college']
const CATEGORY_LABELS: Record<string, string> = {
  offense: 'Offense',
  flex: 'Flex',
  kicker: 'Kicker',
  dst: 'Defense / Special Teams',
  idp: 'IDP',
  bench: 'Bench',
  reserve: 'Reserve',
  college: 'College (C2C)',
}

export function RosterSectionRenderer({
  title,
  slotDefs,
  pendingSlots,
  isCommissioner,
  slotKeyFilter,
  onAdjust,
}: {
  title?: string
  slotDefs: SlotDef[]
  pendingSlots: Record<string, number>
  isCommissioner: boolean
  slotKeyFilter?: Set<string>
  onAdjust: (key: string, delta: number) => void
}) {
  const grouped = new Map<string, SlotDef[]>()
  for (const def of slotDefs) {
    if (slotKeyFilter && !slotKeyFilter.has(def.key)) continue
    const list = grouped.get(def.category) ?? []
    list.push(def)
    grouped.set(def.category, list)
  }

  const renderCategory = (cat: string) => {
    const slots = grouped.get(cat)
    if (!slots || slots.length === 0) return null
    if (cat === 'college' && !slots.some((s) => (pendingSlots[s.key] ?? 0) > 0) && !isCommissioner) return null

    return (
      <div key={cat}>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/30">
          {CATEGORY_LABELS[cat] ?? cat}
        </p>
        <div className="space-y-1">
          {slots.map((def) => {
            const count = pendingSlots[def.key] ?? 0
            if (count === 0 && (def.category === 'idp' || def.category === 'college') && !isCommissioner) return null

            if (!isCommissioner) {
              return <ReadOnlyRosterRow key={def.key} def={def} count={count} />
            }

            return <RosterRowControl key={def.key} def={def} count={count} onAdjust={onAdjust} />
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {title && <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">{title}</p>}
      {CATEGORY_ORDER.map((cat) => renderCategory(cat))}
    </div>
  )
}
