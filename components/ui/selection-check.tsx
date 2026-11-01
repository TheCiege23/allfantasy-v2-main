import { Check } from 'lucide-react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * The tick for a selectable card or chip.
 *
 * A card whose ONLY selected signal is a border or background tint fails anyone who cannot tell
 * those colours apart, and on a dark surface a tint change is easy to miss even for those who can.
 * This draws a shape as well: a violet disc with a white check when selected, an empty ring when
 * not (so the card does not shift when it toggles). It is purely visual (`aria-hidden`); the
 * card itself must still carry the state for assistive tech — `aria-pressed` on a toggle button,
 * `aria-checked`/a real radio for a single choice, or `aria-current` for "the one in use".
 *
 * `hideWhenOff` drops the empty ring for dense grids (e.g. crest pickers) where a ring on every
 * tile is noise; the selected tile still gets the tick.
 */
export function SelectionCheck({
  selected,
  hideWhenOff = false,
  size = 'md',
  className,
  testId,
}: {
  selected: boolean
  hideWhenOff?: boolean
  size?: 'sm' | 'md'
  className?: string
  testId?: string
}) {
  if (!selected && hideWhenOff) return null
  const box = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  return (
    <span
      aria-hidden="true"
      data-selection-check={selected ? 'on' : 'off'}
      data-testid={testId}
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-full border-2 transition-colors motion-reduce:transition-none',
        box,
        selected ? 'border-violet-600 bg-violet-600 text-[#ffffff]' : 'border-current bg-transparent opacity-40',
        className,
      )}
    >
      {selected ? <Check className={icon} strokeWidth={3.5} /> : null}
    </span>
  )
}

export default SelectionCheck
